// Лист ожидания с лендинга: публичный приём заявок + админ-управление и выгрузка.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';
import { sendEmail, renderWaitlistWelcomeHtml } from '../email.js';

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
    source: z.string().trim().max(60).optional(),
    utm_source: z.string().max(120).optional(),
    utm_medium: z.string().max(120).optional(),
    utm_campaign: z.string().max(200).optional(),
    utm_content: z.string().max(200).optional(),
    utm_term: z.string().max(200).optional(),
    fbclid: z.string().max(400).optional(),
  });
  app.post('/api/waitlist', async (req, reply) => {
    const raw = (req.body || {}) as Record<string, unknown>;
    const parsed = intake.safeParse({
      email: raw.email,
      name: raw.name,
      source: raw.source,
      utm_source: raw.utm_source,
      utm_medium: raw.utm_medium,
      utm_campaign: raw.utm_campaign,
      utm_content: raw.utm_content,
      utm_term: raw.utm_term,
      fbclid: raw.fbclid,
    });
    if (!parsed.success) return reply.code(400).send({ error: 'invalid email' });
    const d = parsed.data;
    const email = d.email.toLowerCase();
    // Собираем UTM-метки рекламы в JSON; source = utm_source (fb/ig/…) или 'landing'.
    const utmObj: Record<string, string> = {};
    for (const [k, v] of Object.entries({ source: d.utm_source, medium: d.utm_medium, campaign: d.utm_campaign, content: d.utm_content, term: d.utm_term, fbclid: d.fbclid })) {
      if (v) utmObj[k] = v;
    }
    const utm = Object.keys(utmObj).length ? JSON.stringify(utmObj) : null;
    const source = d.utm_source || d.source || 'landing';
    // Новая заявка или повтор? (чтобы слать приветствие только один раз)
    const existing = await db.waitlistEntry.findUnique({ where: { email }, select: { id: true } });
    // upsert — повторная заявка не плодит дублей; UTM обновляем, если пришли.
    await db.waitlistEntry.upsert({
      where: { email },
      create: { email, name: d.name || null, source, utm },
      update: { name: d.name || undefined, ...(utm ? { utm, source } : {}) },
    });
    // Приветствие — только НОВЫМ. Если настроена включённая drip-цепочка для листа
    // ожидания (audience=waitlist) — отдаём приветствие ей (не дублируем). Иначе
    // шлём дефолтное тёплое письмо сразу. Fire-and-forget: не задерживаем ответ.
    if (!existing) {
      void (async () => {
        try {
          const hasSeq = await db.emailSequence.count({ where: { enabled: true, audience: 'waitlist' } });
          if (hasSeq > 0) return; // welcome возьмёт на себя drip-цепочка
          await sendEmail({ to: email, subject: 'Ты в списке Threadhunt 🎉', html: renderWaitlistWelcomeHtml(d.name || null) });
        } catch {
          /* приветствие не критично */
        }
      })();
    }
    return { ok: true };
  });

  // ── Админ: синхронизировать durable-заявки из Netlify Blobs (страховка на случай
  // простоя сервера, когда заявка не долетела до БД напрямую). Идемпотентно (upsert). ──
  app.post('/api/admin/waitlist/sync', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const secret = process.env.LEADS_SYNC_SECRET;
    if (!secret) return reply.code(400).send({ error: 'LEADS_SYNC_SECRET не задан на сервере' });
    const base = process.env.LANDING_URL || 'https://thread-hunt.com';
    let leads: any[] = [];
    try {
      const res = await fetch(`${base}/.netlify/functions/leads-export?token=${encodeURIComponent(secret)}`);
      if (!res.ok) return reply.code(502).send({ error: `Сайт вернул ${res.status}` });
      const json = (await res.json()) as { leads?: any[] };
      leads = Array.isArray(json.leads) ? json.leads : [];
    } catch (e: any) {
      return reply.code(502).send({ error: 'Не удалось получить заявки с сайта: ' + String(e?.message || e) });
    }
    let created = 0;
    let total = 0;
    for (const l of leads) {
      const email = String(l?.email || '').toLowerCase();
      if (!email.includes('@')) continue;
      total++;
      // UTM из сохранённого url (если есть).
      let utm: string | null = null;
      let source = l.source || 'landing';
      try {
        if (l.url) {
          const u = new URL(l.url);
          const o: Record<string, string> = {};
          for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid']) {
            const v = u.searchParams.get(k);
            if (v) o[k.replace('utm_', '')] = v;
          }
          if (Object.keys(o).length) {
            utm = JSON.stringify(o);
            source = o.source || source;
          }
        }
      } catch {
        /* битый url — пропускаем utm */
      }
      const existing = await db.waitlistEntry.findUnique({ where: { email }, select: { id: true } });
      await db.waitlistEntry.upsert({
        where: { email },
        create: { email, name: l.name || null, source, utm },
        update: { name: l.name || undefined, ...(utm ? { utm, source } : {}) },
      });
      if (!existing) created++;
    }
    return { ok: true, total, created };
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
    const head = ['email', 'name', 'source', 'utm', 'status', 'createdAt'].join(',');
    const rows = entries.map((e) => [e.email, e.name, e.source, e.utm, e.status, e.createdAt.toISOString()].map(esc).join(','));
    const csv = [head, ...rows].join('\n');
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="waitlist.csv"`)
      .send('﻿' + csv); // BOM — чтобы Excel корректно читал кириллицу
  });
}
