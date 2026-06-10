// Онбординг кандидата по уникальной ссылке.
//  • Кабинет (авторизация): настроить шаги поиска, выдать ссылку лиду.
//  • ПУБЛИЧНО (по токену, без логина): кандидат проходит шаги — согласие+контакты,
//    условия+тест, NDA, сдача. Прогресс пишется в лид (аналитика воронки).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { env } from '../env.js';
import { generateDoc, generateFlow, generateBlockText, type DocKind, type BrandVoice } from '../ai/generate.js';
import { consumeAi } from './limits.js';
import { resolveCtx, canManageLeads } from './workspace.js';
import { fireWebhook } from '../webhook.js';

export async function onboardingRoutes(app: FastifyInstance) {
  // Кабинетные роуты работают в пространстве владельца (ownerId), чтобы ассистент
  // мог настраивать онбординг чужого аккаунта. Чтение — всем, запись — OWNER/MANAGER.
  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return ctx.ownerId;
  };
  // Запись (не-GET) по кабинетным роутам — только OWNER/MANAGER (ассистент). VIEWER — 403.
  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'GET') return;
    const p = req.url.split('?')[0];
    if (!p.startsWith('/api/searches/') && !p.startsWith('/api/flow-templates')) return; // публичные онбординг-роуты не трогаем
    const ctx = await resolveCtx(app, req);
    if (ctx && !canManageLeads(ctx.role)) {
      return reply.code(403).send({ error: 'Только просмотр: недостаточно прав для изменения' });
    }
  });

  // ── Кабинет: настройка онбординга поиска ──
  const cfg = z.object({
    obEnabled: z.boolean().optional(),
    obConditions: z.string().max(4000).optional(),
    obTestTask: z.string().max(8000).optional(),
    obNda: z.string().max(8000).optional(),
    obFlow: z.string().max(40000).nullable().optional(), // JSON конструктора
    obDeadlineMode: z.enum(['none', 'relative', 'fixed']).optional(),
    obDeadlineHours: z.number().int().min(1).max(720).optional(),
    obDeadlineAt: z.string().datetime().nullable().optional(),
    obTimezone: z.string().max(64).optional(),
    obRemindersEnabled: z.boolean().optional(),
  });
  app.put('/api/searches/:id/onboarding', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const own = await db.search.findFirst({ where: { id, userId } });
    if (!own) return reply.code(404).send({ error: 'not found' });
    const parsed = cfg.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const data: any = { ...parsed.data };
    if ('obDeadlineAt' in data) data.obDeadlineAt = data.obDeadlineAt ? new Date(data.obDeadlineAt) : null;
    return db.search.update({ where: { id }, data });
  });

  // ── Кабинет: воронка онбординга (отвалы по шагам) ──
  app.get('/api/searches/:id/onboarding-funnel', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({ where: { id, userId } });
    if (!search) return reply.code(404).send({ error: 'not found' });
    const flow = flowOf(search);
    const n = flow.pages.length;
    const leads = await db.lead.findMany({ where: { searchId: id, onboardToken: { not: null } }, select: { obStep: true } });
    const issued = leads.length;
    const steps = flow.pages.map((p: any, i: number) => ({
      title: p.title || `Шаг ${i + 1}`,
      reached: leads.filter((l) => l.obStep >= i + 1).length,
    }));
    const finished = leads.filter((l) => l.obStep >= n).length;
    return { issued, steps, finished };
  });

  // ── Кабинет: ИИ-генерация документа онбординга (тест / условия / NDA) ──
  app.post('/api/searches/:id/generate-doc', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({ where: { id, userId } });
    if (!search) return reply.code(404).send({ error: 'not found' });
    const parsed = z.object({ kind: z.enum(['test', 'conditions', 'nda']) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });

    const gate = await consumeAi(userId);
    if (!gate.ok) return reply.code(gate.status || 429).send({ error: gate.error });

    const brand = await db.brandProfile.findUnique({ where: { userId } });
    const voice: BrandVoice | undefined = brand
      ? { companyName: brand.companyName, niche: brand.niche, tone: brand.tone, audience: brand.audience, perks: brand.perks }
      : undefined;
    const out = await generateDoc(parsed.data.kind as DocKind, { title: search.title, description: search.description, brand: voice });
    return out;
  });

  // ── Кабинет: ИИ собирает ВЕСЬ онбординг-флоу (страницы + блоки) ──
  app.post('/api/searches/:id/generate-onboarding', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({ where: { id, userId } });
    if (!search) return reply.code(404).send({ error: 'not found' });
    const parsed = z.object({ brief: z.string().max(2000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });

    const gate = await consumeAi(userId);
    if (!gate.ok) return reply.code(gate.status || 429).send({ error: gate.error });

    const brand = await db.brandProfile.findUnique({ where: { userId } });
    const voice: BrandVoice | undefined = brand
      ? { companyName: brand.companyName, niche: brand.niche, tone: brand.tone, audience: brand.audience, perks: brand.perks, sample: brand.sample, avoid: brand.avoid }
      : undefined;
    return generateFlow({ title: search.title, description: search.description, brief: parsed.data.brief, brand: voice });
  });

  // ── Кабинет: ИИ генерирует/улучшает текст ОДНОГО блока ──
  app.post('/api/searches/:id/generate-block', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({ where: { id, userId } });
    if (!search) return reply.code(404).send({ error: 'not found' });
    const parsed = z.object({ purpose: z.string().max(200).default('текст'), current: z.string().max(4000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });

    const gate = await consumeAi(userId);
    if (!gate.ok) return reply.code(gate.status || 429).send({ error: gate.error });

    const brand = await db.brandProfile.findUnique({ where: { userId } });
    const voice: BrandVoice | undefined = brand
      ? { companyName: brand.companyName, niche: brand.niche, tone: brand.tone, audience: brand.audience, perks: brand.perks }
      : undefined;
    return generateBlockText({ title: search.title, description: search.description, purpose: parsed.data.purpose, current: parsed.data.current, brand: voice });
  });

  // ── Кабинет: выдать ссылку кандидату (ленивая генерация токена) ──
  app.post('/api/leads/:id/onboard-link', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
    if (!canManageLeads(ctx.role)) return reply.code(403).send({ error: 'нет прав' });
    const id = (req.params as any).id as string;
    const lead = await db.lead.findFirst({ where: { id, userId: ctx.ownerId } });
    if (!lead) return reply.code(404).send({ error: 'not found' });
    let token = lead.onboardToken;
    if (!token) {
      token = 'ob_' + randomBytes(18).toString('hex');
      await db.lead.update({ where: { id }, data: { onboardToken: token } });
    }
    return { token, url: `${env.WEB_ORIGIN}/c/${token}` };
  });

  // Собрать flow: конструктор (obFlow) приоритетнее; иначе строим из legacy-полей.
  function flowOf(s: { obFlow: string | null; obConditions: string; obTestTask: string; obNda: string }) {
    if (s.obFlow) {
      try {
        const f = JSON.parse(s.obFlow);
        if (f && Array.isArray(f.pages) && f.pages.length) return f;
      } catch {}
    }
    const pages: any[] = [
      {
        id: 'p1',
        title: 'О себе',
        blocks: [
          { id: 'b1', type: 'heading', text: 'Оставь контакты' },
          { id: 'b2', type: 'field', key: 'name', label: 'Как тебя зовут', input: 'text', required: true },
          { id: 'b3', type: 'field', key: 'contact', label: 'Telegram или email', input: 'text', required: true },
          { id: 'b4', type: 'consent', text: 'Согласен(на) на обработку моих данных для участия в отборе.' },
        ],
      },
    ];
    if (s.obConditions || s.obTestTask)
      pages.push({
        id: 'p2',
        title: 'Условия и тест',
        blocks: [
          ...(s.obConditions ? [{ id: 'c1', type: 'text', text: s.obConditions }] : []),
          ...(s.obTestTask ? [{ id: 'c2', type: 'heading', text: 'Тестовое задание' }, { id: 'c3', type: 'text', text: s.obTestTask }] : []),
        ],
      });
    if (s.obNda) pages.push({ id: 'p3', title: 'Соглашение', blocks: [{ id: 'n1', type: 'consent', text: s.obNda }] });
    if (s.obTestTask)
      pages.push({ id: 'p4', title: 'Сдача', blocks: [{ id: 's1', type: 'heading', text: 'Пришли ссылку на работу' }, { id: 's2', type: 'submit', key: 'work_url', label: 'Ссылка на тестовое' }] });
    return { pages };
  }

  // ── ПУБЛИЧНО: получить флоу по токену ──
  app.get('/api/c/:token', async (req, reply) => {
    const token = (req.params as any).token as string;
    const lead = await db.lead.findUnique({
      where: { onboardToken: token },
      include: { search: true, user: { include: { brandProfile: true } } },
    });
    if (!lead || !lead.search) return reply.code(404).send({ error: 'not found' });
    const s = lead.search;

    // Дедлайн: relative — отсчёт от первого открытия (фиксируем testSentAt); fixed — заданный момент.
    let deadline: Date | null = lead.testDeadlineAt;
    const patch: any = {};
    if (s.obDeadlineMode === 'relative') {
      if (!lead.testSentAt) patch.testSentAt = new Date();
      const start = lead.testSentAt || patch.testSentAt;
      deadline = new Date(start.getTime() + s.obDeadlineHours * 3600_000);
      if (!lead.testDeadlineAt || lead.testDeadlineAt.getTime() !== deadline.getTime()) patch.testDeadlineAt = deadline;
    } else if (s.obDeadlineMode === 'fixed' && s.obDeadlineAt) {
      deadline = s.obDeadlineAt;
      if (!lead.testDeadlineAt) patch.testDeadlineAt = deadline;
    } else {
      deadline = null;
    }
    if (Object.keys(patch).length) await db.lead.update({ where: { id: lead.id }, data: patch });

    return {
      company: lead.user.brandProfile?.companyName || '',
      role: s.title,
      flow: flowOf(s),
      deadline: deadline ? deadline.toISOString() : null,
      timezone: s.obTimezone || '',
      progress: { obStep: lead.obStep, responses: lead.candidateResponses ? JSON.parse(lead.candidateResponses) : {} },
    };
  });

  // ── ПУБЛИЧНО: отправить страницу (значения блоков) ──
  const stepInput = z.object({
    index: z.number().int().min(0),
    values: z.record(z.string()).default({}),
    consent: z.boolean().optional(),
    workUrl: z.string().max(500).optional(),
    last: z.boolean().optional(),
  });
  app.post('/api/c/:token/step', async (req, reply) => {
    const token = (req.params as any).token as string;
    const lead = await db.lead.findUnique({ where: { onboardToken: token } });
    if (!lead) return reply.code(404).send({ error: 'not found' });
    const parsed = stepInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const b = parsed.data;

    const responses = { ...(lead.candidateResponses ? JSON.parse(lead.candidateResponses) : {}), ...b.values };
    const data: any = { candidateResponses: JSON.stringify(responses), obStep: Math.max(lead.obStep, b.index + 1) };
    if (b.values.name) data.candidateName = b.values.name;
    if (b.values.contact) data.candidateContact = b.values.contact;
    if (b.consent && !lead.consentAt) data.consentAt = new Date();
    if (b.workUrl) {
      data.testSubmittedUrl = b.workUrl;
      data.testSubmittedAt = new Date();
    }
    if (b.last && (lead.stage === 'NEW' || lead.stage === 'CONTACTED')) data.stage = 'SCREENING';

    await db.lead.update({ where: { id: lead.id }, data });
    if (b.index === 0 && data.consentAt) await db.leadComment.create({ data: { leadId: lead.id, body: 'Кандидат оставил контакты и согласие (онбординг)', author: 'система' } });
    if (b.last) await db.leadComment.create({ data: { leadId: lead.id, body: 'Кандидат прошёл онбординг до конца', author: 'система' } });
    // Исходящий вебхук на ответы анкеты (фоном): шлём шаг, на финале — полную анкету.
    void fireWebhook(lead.userId, b.last ? 'candidate.completed' : 'candidate.response', {
      leadId: lead.id,
      searchId: lead.searchId,
      name: data.candidateName ?? lead.candidateName ?? null,
      contact: data.candidateContact ?? lead.candidateContact ?? null,
      stepIndex: b.index,
      completed: !!b.last,
      responses,
    });
    return { ok: true };
  });

  // ── Шаблоны флоу (библиотека под роли) ──
  app.get('/api/flow-templates', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    return db.flowTemplate.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  });
  app.post('/api/flow-templates', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const parsed = z.object({ name: z.string().min(1).max(80), flow: z.string().max(40000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    return db.flowTemplate.create({ data: { userId, name: parsed.data.name, flow: parsed.data.flow } });
  });
  app.delete('/api/flow-templates/:id', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const t = await db.flowTemplate.findFirst({ where: { id, userId } });
    if (!t) return reply.code(404).send({ error: 'not found' });
    await db.flowTemplate.delete({ where: { id } });
    return { ok: true };
  });
}
