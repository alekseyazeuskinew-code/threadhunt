// Подключения Threads-аккаунта + спаривание расширения (device-token).
//
// Постинг: на MVP даём ручной ввод долгоживущего токена (whoami → шифруем → храним).
// OAuth-флоу Meta добавится позже тем же интерфейсом (меняется только способ
// получения токена, хранение и использование — те же).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';
import { encrypt, hashToken } from '../crypto.js';
import { whoami } from '../threads/publisher.js';
import { seatLimit } from '../seats.js';

export async function connectionRoutes(app: FastifyInstance) {
  const requireUser = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return userId;
  };

  // Официальные Threads-подключения (для автопостинга).
  app.get('/api/connections', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const conns = await db.threadsConnection.findMany({
      where: { userId },
      include: { _count: { select: { searches: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return conns.map((c) => ({
      id: c.id,
      username: c.username,
      threadsUserId: c.threadsUserId,
      tokenExpiresAt: c.tokenExpiresAt,
      searches: c._count.searches,
    }));
  });

  // Браузеры (расширения), подключённые к аккаунту — для отбивки в директе.
  app.get('/api/devices', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const devices = await db.device.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const now = Date.now();
    return devices.map((d) => ({
      id: d.id,
      label: d.label,
      version: d.version,
      threadsLoggedIn: d.threadsLoggedIn,
      online: !!d.lastHeartbeat && now - d.lastHeartbeat.getTime() < 120_000,
      lastHeartbeat: d.lastHeartbeat,
    }));
  });

  // Подключить аккаунт по токену Threads API (ручной ввод, MVP).
  const tokenInput = z.object({ accessToken: z.string().min(20) });
  app.post('/api/connections', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const parsed = tokenInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Вставьте корректный токен' });
    let me: any;
    try {
      me = await whoami(parsed.data.accessToken);
    } catch (e: any) {
      return reply.code(400).send({ error: 'Токен не принят Threads: ' + (e?.message || 'ошибка') });
    }
    const conn = await db.threadsConnection.upsert({
      where: { userId_threadsUserId: { userId, threadsUserId: me.id } },
      create: {
        userId,
        threadsUserId: me.id,
        username: me.username || '',
        accessTokenEnc: encrypt(parsed.data.accessToken),
      },
      update: { username: me.username || '', accessTokenEnc: encrypt(parsed.data.accessToken) },
    });
    return { id: conn.id, username: conn.username };
  });

  app.delete('/api/connections/:id', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const conn = await db.threadsConnection.findFirst({ where: { id, userId } });
    if (!conn) return reply.code(404).send({ error: 'not found' });
    await db.threadsConnection.delete({ where: { id } });
    return { ok: true };
  });

  // ── Подключение рекламного кабинета Meta (для авто-кампаний) ──
  // Реальная авторизация (OAuth) ждёт App Review Meta — пока ручной ввод, статус «pending».
  app.get('/api/meta/connection', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const m = await db.metaConnection.findUnique({ where: { userId } });
    if (!m) return { connected: false };
    return { connected: true, adAccountId: m.adAccountId, businessName: m.businessName, status: m.status };
  });

  const metaInput = z.object({
    adAccountId: z.string().min(2),
    businessName: z.string().default(''),
    accessToken: z.string().optional(),
  });
  app.post('/api/meta/connection', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const parsed = metaInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажите ID рекламного аккаунта (act_…)' });
    const { adAccountId, businessName, accessToken } = parsed.data;
    const m = await db.metaConnection.upsert({
      where: { userId },
      create: { userId, adAccountId, businessName, accessTokenEnc: accessToken ? encrypt(accessToken) : null, status: 'pending' },
      update: { adAccountId, businessName, ...(accessToken ? { accessTokenEnc: encrypt(accessToken) } : {}) },
    });
    return { connected: true, adAccountId: m.adAccountId, businessName: m.businessName, status: m.status };
  });

  app.delete('/api/meta/connection', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    await db.metaConnection.deleteMany({ where: { userId } });
    return { ok: true };
  });

  // Создать device-token для расширения (привязан к аккаунту, не к Threads-подключению).
  const deviceInput = z.object({ label: z.string().optional() });
  app.post('/api/devices', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    // Лимит «мест» (аккаунтов) по тарифу + докупленные доп-места. Превышение —
    // апселл: предложить апгрейд/доп-место (оплата через Stripe позже).
    const [user, used] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { plan: true, extraSeats: true } }),
      db.device.count({ where: { userId } }),
    ]);
    const limit = seatLimit(user?.plan || 'FREE', user?.extraSeats || 0);
    if (used >= limit) {
      return reply.code(403).send({
        error: `Достигнут лимит подключённых аккаунтов (${used}/${limit}). Подключите доп-место или перейдите на тариф выше.`,
        code: 'seat_limit',
        used,
        limit,
      });
    }
    const parsed = deviceInput.safeParse(req.body ?? {});
    const token = 'thd_' + randomBytes(24).toString('hex');
    await db.device.create({
      data: { userId, tokenHash: hashToken(token), label: parsed.success ? parsed.data.label || 'Браузер' : 'Браузер' },
    });
    // token отдаём ОДИН раз — расширение получит его автоматически или вставишь вручную
    return { token };
  });

  // Квота мест (аккаунтов): сколько занято и сколько доступно по тарифу + доп-места.
  app.get('/api/account/quota', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const [user, used] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { plan: true, extraSeats: true } }),
      db.device.count({ where: { userId } }),
    ]);
    const plan = user?.plan || 'FREE';
    const extraSeats = user?.extraSeats || 0;
    return { plan, extraSeats, used, limit: seatLimit(plan, extraSeats) };
  });

  app.delete('/api/devices/:id', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const device = await db.device.findFirst({ where: { id, userId } });
    if (!device) return reply.code(404).send({ error: 'not found' });
    await db.device.delete({ where: { id } });
    return { ok: true };
  });
}
