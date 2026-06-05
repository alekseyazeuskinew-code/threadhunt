// Протокол «расширение ↔ сервер». Расширение аутентифицируется device-token
// (Bearer), сервер отдаёт правила активных поисков и принимает события отбивки.
// Дедуп (кому уже отвечали) и журнал лидов — источник правды здесь, на сервере.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { hashToken } from '../crypto.js';
import { getUserLimits } from './limits.js';
import type { AgentTasksResponse, AgentSearchRule } from '@threadhunt/shared';

const POLL_INTERVAL_SEC = 20;

// По Bearer device-token находим Device + владельца (User).
async function authDevice(authHeader?: string) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const device = await db.device.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  return device;
}

export async function agentRoutes(app: FastifyInstance) {
  // Расширение опрашивает задачи (по всем активным поискам пользователя).
  app.get('/api/agent/tasks', async (req, reply) => {
    const device = await authDevice(req.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });

    // На MVP активны все планы. Здесь же позже — проверка подписки/лимитов.
    const active = !!device.user;
    if (!active) {
      const res: AgentTasksResponse = {
        active: false,
        searches: [],
        limits: { minDelayMs: 8000, maxRepliesPerDay: 0, repliesRemainingToday: 0, maxDialogs: 0, workingHours: { enabled: false, from: '09:00', to: '21:00' } },
        pollIntervalSec: 60,
      };
      return res;
    }

    const searches = await db.search.findMany({
      where: { userId: device.userId, status: 'ACTIVE' },
      include: {
        keywords: true,
        replyTemplates: { orderBy: { order: 'asc' } },
        publishConfig: true,
        leads: { select: { fromUserKey: true } },
      },
    });

    // Лимиты аккаунта + сколько ответов ещё осталось сегодня.
    const lim = await getUserLimits(device.userId);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const repliedToday = await db.lead.count({ where: { userId: device.userId, status: 'REPLIED', createdAt: { gte: since } } });
    const repliesRemainingToday = Math.max(0, lim.maxRepliesPerDay - repliedToday);

    const rules: AgentSearchRule[] = searches.map((s) => ({
      searchId: s.id,
      title: s.title,
      keywords: s.keywords.map((k) => ({ text: k.text, mode: k.mode as any })),
      replyTemplates: s.replyTemplates.map((t) => ({ id: t.id, text: t.text })),
      rotation: (s.publishConfig?.rotation as 'sequential' | 'random') ?? 'sequential',
      alreadyReplied: s.leads.map((l) => l.fromUserKey),
      minDelayMs: lim.replyDelaySec * 1000,
      maxRepliesPerDay: lim.maxRepliesPerDay,
    }));

    const res: AgentTasksResponse = {
      active: true,
      searches: rules,
      limits: {
        minDelayMs: lim.replyDelaySec * 1000,
        maxRepliesPerDay: lim.maxRepliesPerDay,
        repliesRemainingToday,
        maxDialogs: lim.maxDialogsPerSweep,
        workingHours: { enabled: lim.workingHoursEnabled, from: lim.activeFrom, to: lim.activeTo },
      },
      pollIntervalSec: POLL_INTERVAL_SEC,
    };
    return res;
  });

  // Расширение присылает результаты отбивки → создаём лиды (с дедупом).
  const eventsSchema = z.object({
    events: z.array(
      z.object({
        searchId: z.string(),
        fromUserKey: z.string(),
        fromUsername: z.string().optional(),
        matchedKeyword: z.string(),
        templateId: z.string().optional(),
        sent: z.boolean(),
        section: z.string().optional(),
        error: z.string().optional(),
        at: z.string(),
      }),
    ),
  });

  app.post('/api/agent/events', async (req, reply) => {
    const device = await authDevice(req.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = eventsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });

    const userId = device.userId;
    for (const e of parsed.data.events) {
      // upsert по (searchId, fromUserKey) — дедуп по человеку в рамках поиска.
      await db.lead.upsert({
        where: { searchId_fromUserKey: { searchId: e.searchId, fromUserKey: e.fromUserKey } },
        create: {
          userId,
          searchId: e.searchId,
          fromUserKey: e.fromUserKey,
          fromUsername: e.fromUsername,
          matchedKeyword: e.matchedKeyword,
          section: e.section,
          replyTemplateId: e.templateId,
          status: e.sent ? 'REPLIED' : 'FAILED',
        },
        update: {}, // уже отвечали — не трогаем
      });
    }
    return { ok: true };
  });

  // Heartbeat — «агент онлайн» в дашборде.
  const hbSchema = z.object({ version: z.string(), threadsLoggedIn: z.boolean() });
  app.post('/api/agent/heartbeat', async (req, reply) => {
    const device = await authDevice(req.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = hbSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    await db.device.update({
      where: { id: device.id },
      data: {
        version: parsed.data.version,
        threadsLoggedIn: parsed.data.threadsLoggedIn,
        lastHeartbeat: new Date(),
      },
    });
    return { ok: true };
  });
}
