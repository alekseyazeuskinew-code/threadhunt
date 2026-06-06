// Промокоды запуска: генерация уникальных кодов, выдача листу ожидания, применение
// аккаунтом. Защита от повторного применения и от «100% скидки стэкингом»:
//   • каждый код применяется не больше maxRedemptions раз (по умолчанию 1);
//   • один аккаунт может применить НЕ БОЛЕЕ ОДНОГО промокода за всё время
//     (нельзя сложить два кода и обнулить цену);
//   • применение привязано к аккаунту (PromoRedemption, уникальность codeId+userId).
// Stripe позже станет финальным валидатором (Promotion Code, max_redemptions=1) —
// эта таблица остаётся нашим источником правды и работает до подключения Stripe.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';

// Алфавит без двусмысленных символов (нет O/0, I/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(prefix = 'TH'): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}-${s}`;
}

// Создать гарантированно уникальный код в БД (с ретраями на коллизии).
async function createUniqueCode(opts: { percentOff: number; durationMonths: number; campaign: string; issuedToEmail?: string | null; expiresAt?: Date | null }): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    try {
      await db.promoCode.create({
        data: {
          code,
          percentOff: opts.percentOff,
          durationMonths: opts.durationMonths,
          maxRedemptions: 1,
          campaign: opts.campaign,
          issuedToEmail: opts.issuedToEmail ?? null,
          expiresAt: opts.expiresAt ?? null,
        },
      });
      return code;
    } catch {
      // коллизия по unique(code) — пробуем ещё раз
    }
  }
  throw new Error('Не удалось сгенерировать уникальный код');
}

export async function promoRoutes(app: FastifyInstance) {
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

  // ── Публично/в кабинете: проверить код без применения (для экрана оплаты). ──
  app.get('/api/promo/validate', async (req) => {
    const code = String((req.query as any)?.code || '').trim().toUpperCase();
    if (!code) return { valid: false, reason: 'empty' };
    const pc = await db.promoCode.findUnique({ where: { code } });
    if (!pc) return { valid: false, reason: 'not_found' };
    if (pc.expiresAt && pc.expiresAt < new Date()) return { valid: false, reason: 'expired' };
    if (pc.redeemedCount >= pc.maxRedemptions) return { valid: false, reason: 'used' };
    return { valid: true, percentOff: pc.percentOff, durationMonths: pc.durationMonths };
  });

  // ── В кабинете: применить код к своему аккаунту (требует входа). ──
  app.post('/api/promo/redeem', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'Войди в аккаунт, чтобы применить промокод' });
    const parsed = z.object({ code: z.string().trim().min(3).max(40) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Введи промокод' });
    const code = parsed.data.code.toUpperCase();

    const pc = await db.promoCode.findUnique({ where: { code } });
    if (!pc) return reply.code(404).send({ error: 'Такого промокода нет' });
    if (pc.expiresAt && pc.expiresAt < new Date()) return reply.code(400).send({ error: 'Срок действия промокода истёк' });

    // Один аккаунт — не более одного промокода за всё время (запрет стэкинга на 100%).
    const already = await db.promoRedemption.findFirst({ where: { userId } });
    if (already) {
      if (already.codeId === pc.id) return reply.code(409).send({ error: 'Этот промокод уже применён к твоему аккаунту' });
      return reply.code(409).send({ error: 'К аккаунту уже применён промокод — второй применить нельзя' });
    }

    // Атомарно «занимаем» одно применение (защита от гонки и превышения лимита).
    const upd = await db.promoCode.updateMany({
      where: { id: pc.id, redeemedCount: { lt: pc.maxRedemptions } },
      data: { redeemedCount: { increment: 1 } },
    });
    if (upd.count === 0) return reply.code(409).send({ error: 'Промокод уже использован' });

    try {
      await db.promoRedemption.create({ data: { codeId: pc.id, userId } });
    } catch {
      // не удалось зафиксировать применение — откатываем счётчик
      await db.promoCode.update({ where: { id: pc.id }, data: { redeemedCount: { decrement: 1 } } });
      return reply.code(409).send({ error: 'Промокод уже использован' });
    }

    // Привязка статуса заявки листа ожидания (если код был выдан под этот email).
    if (pc.issuedToEmail) {
      await db.waitlistEntry.updateMany({ where: { email: pc.issuedToEmail }, data: { status: 'converted' } }).catch(() => {});
    }

    // Entitlement зафиксирован. Реальная скидка применится при оплате (Stripe).
    return { ok: true, percentOff: pc.percentOff, durationMonths: pc.durationMonths };
  });

  // ── Админ: список кодов. ──
  app.get('/api/admin/promo', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const rows = await db.promoCode.findMany({ orderBy: { createdAt: 'desc' }, take: 2000 });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      percentOff: r.percentOff,
      durationMonths: r.durationMonths,
      maxRedemptions: r.maxRedemptions,
      redeemedCount: r.redeemedCount,
      issuedToEmail: r.issuedToEmail,
      campaign: r.campaign,
      used: r.redeemedCount >= r.maxRedemptions,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  });

  // ── Админ: сгенерировать пачку свободных уникальных кодов. ──
  const genSchema = z.object({
    count: z.number().int().min(1).max(500).default(20),
    percentOff: z.number().int().min(1).max(100).default(50),
    durationMonths: z.number().int().min(1).max(24).default(2),
    campaign: z.string().trim().max(40).default('early'),
  });
  app.post('/api/admin/promo/generate', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = genSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const { count, percentOff, durationMonths, campaign } = parsed.data;
    const codes: string[] = [];
    for (let i = 0; i < count; i++) codes.push(await createUniqueCode({ percentOff, durationMonths, campaign }));
    return { ok: true, created: codes.length, codes };
  });

  // ── Админ: выдать уникальные коды листу ожидания (тем, у кого ещё нет). ──
  const issueSchema = z.object({
    status: z.enum(['new', 'invited', 'converted']).optional(),
    percentOff: z.number().int().min(1).max(100).default(50),
    durationMonths: z.number().int().min(1).max(24).default(2),
    campaign: z.string().trim().max(40).default('waitlist'),
  });
  app.post('/api/admin/promo/issue-waitlist', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = issueSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const { status, percentOff, durationMonths, campaign } = parsed.data;
    const where: any = { promoCode: null };
    if (status) where.status = status;
    const entries = await db.waitlistEntry.findMany({ where, take: 2000 });
    let issued = 0;
    for (const e of entries) {
      const code = await createUniqueCode({ percentOff, durationMonths, campaign, issuedToEmail: e.email });
      await db.waitlistEntry.update({ where: { id: e.id }, data: { promoCode: code } });
      issued++;
    }
    return { ok: true, issued };
  });

  // ── Админ: выгрузка email→code для рассылки (mail merge). ──
  app.get('/api/admin/promo.csv', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const rows = await db.promoCode.findMany({ where: { issuedToEmail: { not: null } }, orderBy: { createdAt: 'desc' }, take: 5000 });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['email', 'code', 'percentOff', 'durationMonths', 'used'].join(',');
    const body = rows.map((r) => [r.issuedToEmail, r.code, r.percentOff, r.durationMonths, r.redeemedCount >= r.maxRedemptions].map(esc).join(','));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="promo-codes.csv"')
      .send('﻿' + [head, ...body].join('\n'));
  });

  // ── Админ: удалить код. ──
  app.delete('/api/admin/promo/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    await db.promoCode.delete({ where: { id: (req.params as any).id as string } });
    return { ok: true };
  });
}
