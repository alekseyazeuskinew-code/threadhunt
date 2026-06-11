// Протокол «расширение ↔ сервер». Расширение аутентифицируется device-token
// (Bearer), сервер отдаёт правила активных поисков и принимает события отбивки.
// Дедуп (кому уже отвечали) и журнал лидов — источник правды здесь, на сервере.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { hashToken } from '../crypto.js';
import { getUserLimits } from './limits.js';
import { fireWebhook } from '../webhook.js';
import { applyDmWatermark } from '../branding.js';
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
        limits: {
          minDelayMs: 8000,
          maxRepliesPerDay: 0,
          repliesRemainingToday: 0,
          maxDialogs: 0,
          workingHours: { enabled: false, from: '09:00', to: '21:00' },
          sweepIntervalMinutes: 180,
          safeMode: false,
          sections: { main: true, requests: true, hidden: true },
          runNowAt: null,
        },
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

    const plan = device.user?.plan; // FREE → вотермарк в авто-ответах
    const rules: AgentSearchRule[] = searches.map((s) => ({
      searchId: s.id,
      title: s.title,
      keywords: s.keywords.map((k) => ({ text: k.text, mode: k.mode as any, replyText: k.replyText ? applyDmWatermark(k.replyText, plan) : undefined })),
      replyTemplates: s.replyTemplates.map((t) => ({ id: t.id, text: applyDmWatermark(t.text, plan) })),
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
        sweepIntervalMinutes: lim.sweepIntervalMinutes,
        safeMode: lim.safeMode,
        sections: { main: lim.sweepMain, requests: lim.sweepRequests, hidden: lim.sweepHidden },
        runNowAt: lim.runNowAt ? new Date(lim.runNowAt).toISOString() : null,
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
      // Новый ли лид? (для исходящего вебхука — шлём только на свежие.)
      const existed = await db.lead.findUnique({
        where: { searchId_fromUserKey: { searchId: e.searchId, fromUserKey: e.fromUserKey } },
        select: { id: true },
      });
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
      if (!existed) {
        // фоновый исходящий вебхук на новый лид (не блокирует ответ агенту)
        void fireWebhook(userId, 'lead.created', {
          searchId: e.searchId,
          username: e.fromUsername,
          matchedKeyword: e.matchedKeyword,
          section: e.section,
          at: e.at,
        });
      }
    }
    return { ok: true };
  });

  // Сводка прохода отбивки → журнал AgentPass (статистика для карточки и хронологии).
  // Реальный (не dry-run) проход «съедает» метку «Прогон сейчас», чтобы не повторять.
  const passSchema = z.object({
    scanned: z.number().int().min(0).default(0),
    sent: z.number().int().min(0).default(0),
    matched: z.number().int().min(0).default(0),
    sections: z.string().optional(),
    dryRun: z.boolean().optional(),
  });
  app.post('/api/agent/pass', async (req, reply) => {
    const device = await authDevice(req.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = passSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const p = parsed.data;
    await db.agentPass.create({
      data: { userId: device.userId, scanned: p.scanned, sent: p.sent, matched: p.matched, sections: p.sections, dryRun: p.dryRun ?? false },
    });
    if (!p.dryRun) {
      // обход выполнен — сбрасываем триггер «Прогон сейчас»
      await db.limits.updateMany({ where: { userId: device.userId }, data: { runNowAt: null } });
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
