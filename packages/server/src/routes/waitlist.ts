// Лист ожидания с лендинга: публичный приём заявок + админ-управление и выгрузка.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';

export async function waitlistRoutes(app: FastifyInstance) {
  async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return false;
    }
    const me = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (me?.role !== 'ADMIN') {
      reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  // ── Публичный приём заявки (с лендинга, кросс-домен). ──
  // Принимаем и JSON, и form-urlencoded (см. парсер в index.ts).
  const intake = z.object({
    email: z.string().email(),
    name: z.string().trim().max(120).optional(),
    source: z.string().trim().max(40).optional(),
  });
  app.post('/api/waitlist', async (req, reply) => {
    const raw = (req.body || {}) as Record<string, unknown>;
    const parsed = intake.safeParse({ email: raw.email, name: raw.name, source: raw.source });
    if (!parsed.success) return reply.code(400).send({ error: 'invalid email' });
    const email = parsed.data.email.toLowerCase();
    // upsert — повторная заявка не плодит дублей.
    await db.waitlistEntry.upsert({
      where: { email },
      create: { email, name: parsed.data.name || null, source: parsed.data.source || 'landing' },
      update: { name: parsed.data.name || undefined },
    });
    return { ok: true };
  });

  // ── Админ: список заявок. ──
  app.get('/api/admin/waitlist', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const entries = await db.waitlistEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 });
    return entries;
  });

  // ── Админ: смена статуса заявки. ──
  app.patch('/api/admin/waitlist/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = (req.params as any).id as string;
    const parsed = z.object({ status: z.enum(['new', 'invited', 'converted']) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    await db.waitlistEntry.update({ where: { id }, data: { status: parsed.data.status } });
    return { ok: true };
  });

  // ── Админ: удалить заявку. ──
  app.delete('/api/admin/waitlist/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = (req.params as any).id as string;
    await db.waitlistEntry.delete({ where: { id } });
    return { ok: true };
  });

  // ── Админ: выгрузка CSV. ──
  app.get('/api/admin/waitlist.csv', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const entries = await db.waitlistEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 5000 });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['email', 'name', 'source', 'status', 'createdAt'].join(',');
    const rows = entries.map((e) => [e.email, e.name, e.source, e.status, e.createdAt.toISOString()].map(esc).join(','));
    const csv = [head, ...rows].join('\n');
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="waitlist.csv"`)
      .send('﻿' + csv); // BOM — чтобы Excel корректно читал кириллицу
  });
}
