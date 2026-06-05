// Лиды (кандидаты) + канбан-пайплайн: стадии, рейтинг, комментарии.
// Данные привязаны к рабочему пространству (ownerId): владелец и приглашённые
// участники видят одни и те же лиды; VIEWER — только чтение, MANAGER/OWNER — управление.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { resolveCtx, canManageLeads } from './workspace.js';

const STAGES = ['NEW', 'CONTACTED', 'SCREENING', 'HIRED', 'BENCH', 'REJECTED'] as const;

export async function leadRoutes(app: FastifyInstance) {
  const own = (ownerId: string, id: string) => db.lead.findFirst({ where: { id, userId: ownerId } });

  // Все лиды пространства (для пайплайна и списка).
  app.get('/api/leads', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
    return db.lead.findMany({
      where: { userId: ctx.ownerId },
      include: { search: { select: { title: true } }, _count: { select: { comments: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  });

  // Экспорт лидов в CSV (для Excel/Sheets). Те же данные, что в списке.
  app.get('/api/leads.csv', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
    const leads = await db.lead.findMany({
      where: { userId: ctx.ownerId },
      include: { search: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ['Дата', 'Поиск', 'Username', 'Кодовое слово', 'Раздел', 'Стадия', 'Рейтинг', 'Статус', 'Контакт', 'Кандидат', 'Контакт кандидата'];
    const rows = leads.map((l) =>
      [
        new Date(l.createdAt).toISOString(),
        l.search?.title ?? '',
        l.fromUsername ?? '',
        l.matchedKeyword,
        l.section ?? '',
        l.stage,
        l.rating,
        l.status,
        l.contact ?? '',
        l.candidateName ?? '',
        l.candidateContact ?? '',
      ].map(esc).join(','),
    );
    const csv = '﻿' + [headers.join(','), ...rows].join('\n'); // BOM — чтобы Excel понял UTF-8
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="threadhunt-leads.csv"');
    return reply.send(csv);
  });

  // Деталь лида + комментарии.
  app.get('/api/leads/:id', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
    const id = (req.params as any).id as string;
    const lead = await db.lead.findFirst({
      where: { id, userId: ctx.ownerId },
      include: { search: { select: { title: true } }, comments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!lead) return reply.code(404).send({ error: 'not found' });
    return lead;
  });

  const STAGE_LABELS: Record<string, string> = {
    NEW: 'Новый', CONTACTED: 'На связи', SCREENING: 'Тест/собес', HIRED: 'В команде', BENCH: 'Резерв', REJECTED: 'Отказ',
  };
  const dateField = z.string().datetime().nullable().optional();

  // Сменить стадию/рейтинг + поля жизненного цикла. Авто-логируем ключевые шаги в таймлайн.
  const patchSchema = z.object({
    stage: z.enum(STAGES).optional(),
    rating: z.number().min(0).max(5).optional(),
    contact: z.string().max(200).nullable().optional(),
    conditionsSentAt: dateField,
    testSentAt: dateField,
    testDeadlineAt: dateField,
    testSubmittedUrl: z.string().max(500).nullable().optional(),
    testSubmittedAt: dateField,
    decisionReason: z.string().max(200).nullable().optional(),
    role: z.string().max(120).nullable().optional(),
    rate: z.string().max(120).nullable().optional(),
    startedAt: dateField,
    nextTouchAt: dateField,
  });

  app.patch('/api/leads/:id', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
    if (!canManageLeads(ctx.role)) return reply.code(403).send({ error: 'Только просмотр: нет прав менять кандидатов' });
    const id = (req.params as any).id as string;
    const existing = await own(ctx.ownerId, id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });

    // строки-даты → Date
    const data: any = { ...parsed.data };
    for (const k of ['conditionsSentAt', 'testSentAt', 'testDeadlineAt', 'testSubmittedAt', 'startedAt', 'nextTouchAt'] as const) {
      if (k in data) data[k] = data[k] ? new Date(data[k]) : null;
    }
    // авто-старт работы при переходе в «В команде»
    if (data.stage === 'HIRED' && !existing.startedAt && !('startedAt' in data)) data.startedAt = new Date();

    const updated = await db.lead.update({ where: { id }, data });

    // авто-события в таймлайн (системные комментарии)
    const events: string[] = [];
    if (data.stage && data.stage !== existing.stage) events.push(`Стадия → ${STAGE_LABELS[data.stage] || data.stage}`);
    if (data.conditionsSentAt && !existing.conditionsSentAt) events.push('Отправлены условия');
    if (data.testSentAt && !existing.testSentAt) events.push('Выдано тестовое задание');
    if (data.testSubmittedAt && !existing.testSubmittedAt) events.push('Кандидат сдал тестовое');
    if (data.decisionReason && data.decisionReason !== existing.decisionReason) events.push(`Решение: ${data.decisionReason}`);
    for (const body of events) {
      await db.leadComment.create({ data: { leadId: id, body, author: 'система' } });
    }
    return updated;
  });

  // Добавить комментарий.
  const commentSchema = z.object({ body: z.string().min(1).max(2000) });
  app.post('/api/leads/:id/comments', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
    if (!canManageLeads(ctx.role)) return reply.code(403).send({ error: 'Только просмотр' });
    const id = (req.params as any).id as string;
    if (!(await own(ctx.ownerId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Пустой комментарий' });
    return db.leadComment.create({ data: { leadId: id, body: parsed.data.body } });
  });
}
