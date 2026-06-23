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
import { env } from '../env.js';
import { notifyOwner, esc } from './telegram.js';
import { calibrateSelectors, type ControlEl } from '../ai/calibrate.js';
import type { AgentTasksResponse, AgentSearchRule, CalibrationConfig } from '@threadhunt/shared';

const POLL_INTERVAL_SEC = 20;

// Безопасный разбор сохранённой калибровки (JSON в Limits.calibration).
function parseCalibration(s: string | null | undefined): CalibrationConfig | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as CalibrationConfig;
  } catch {
    return null;
  }
}

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
          stopAt: null,
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
        // В «уже отвечали» — только УСПЕШНО отвеченные (REPLIED). Лиды со статусом FAILED
        // (не прошёл приём/отправка) НЕ исключаем — расширение попробует ответить им снова.
        leads: { where: { status: 'REPLIED' }, select: { fromUserKey: true } },
      },
    });

    // Для research берём ВСЕ поиски пользователя (даже на паузе — это сбор для
    // вдохновения, а не отбивка), чтобы запросы не оказались пустыми из-за статуса.
    const researchSearches = await db.search.findMany({ where: { userId: device.userId }, select: { id: true, title: true, keywords: { select: { text: true } } } });

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
      // Персональная ссылка онбординга в ответ (если включено в настройках поиска).
      obLink: s.obEnabled && s.obLinkInReply ? `${env.WEB_ORIGIN}/api/c/by/${s.id}/` : undefined,
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
        stopAt: lim.stopAt ? new Date(lim.stopAt).toISOString() : null,
      },
      research: {
        enabled: !!lim.researchEnabled,
        // Запросы: по кодовым словам ИЛИ по названию роли (настройка researchByKeywords).
        // В режиме слов при их отсутствии у поиска — берём роль, чтобы не было пусто.
        queries: (lim.researchByKeywords
          ? researchSearches.flatMap((s) => (s.keywords.length ? s.keywords.map((k) => ({ searchId: s.id, query: k.text })) : [{ searchId: s.id, query: s.title }]))
          : researchSearches.map((s) => ({ searchId: s.id, query: s.title }))
        )
          .filter((q) => q.query && q.query.trim())
          .slice(0, 12),
        intervalMinutes: 720, // раз в ~12 часов
        maxPerQuery: 15,
        runAt: lim.researchRunAt ? new Date(lim.researchRunAt).toISOString() : null,
      },
      dmTestAt: lim.dmTestAt ? new Date(lim.dmTestAt).toISOString() : null,
      calibrateAt: lim.calibrateAt ? new Date(lim.calibrateAt).toISOString() : null,
      calibration: parseCalibration(lim.calibration),
      pollIntervalSec: POLL_INTERVAL_SEC,
    };
    return res;
  });

  // Результат холостого теста отбивки → сохраняем + снимаем запрос.
  const testSchema = z.object({ scanned: z.number().int().min(0).default(0), matched: z.number().int().min(0).default(0) });
  app.post('/api/agent/test-result', async (req, reply) => {
    const device = await authDevice(req.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    await db.limits.updateMany({
      where: { userId: device.userId },
      data: { dmTestAt: null, lastTestAt: new Date(), lastTestScanned: parsed.data.scanned, lastTestMatched: parsed.data.matched },
    });
    // Дублируем тест в журнал проходов — чтобы он остался в хронологии «Что происходит
    // на бэке» (видно постфактум, даже после закрытия вкладки: прошёл тест или нет).
    await db.agentPass.create({
      data: { userId: device.userId, scanned: parsed.data.scanned, matched: parsed.data.matched, sent: 0, sections: null, dryRun: true },
    });
    return { ok: true };
  });

  // Расширение присылает собранные research-постом (топовые вакансии-ветки) → upsert.
  const researchSchema = z.object({
    posts: z.array(
      z.object({
        searchId: z.string().optional(),
        query: z.string().max(200),
        threadsPostId: z.string().max(120),
        author: z.string().max(120).optional(),
        text: z.string().max(4000),
        permalink: z.string().max(500).optional(),
        likes: z.number().int().min(0).optional(),
        replies: z.number().int().min(0).optional(),
        reposts: z.number().int().min(0).optional(),
        postedAt: z.string().optional(),
      }),
    ).max(200),
    diag: z.any().optional(), // диагностика вёрстки выдачи (для отладки селекторов)
    done: z.boolean().optional(), // true — весь проход завершён (гасим «идёт сбор»)
  });
  app.post('/api/agent/research', async (req, reply) => {
    const device = await authDevice(req.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = researchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const userId = device.userId;
    for (const p of parsed.data.posts) {
      if (!p.threadsPostId || !p.text.trim()) continue;
      const data = {
        searchId: p.searchId || null,
        query: p.query,
        author: p.author || null,
        text: p.text.slice(0, 4000),
        permalink: p.permalink || null,
        likes: p.likes ?? 0,
        replies: p.replies ?? 0,
        reposts: p.reposts ?? 0,
        postedAt: p.postedAt ? new Date(p.postedAt) : null,
        fetchedAt: new Date(),
      };
      await db.researchPost.upsert({
        where: { userId_threadsPostId: { userId, threadsPostId: p.threadsPostId } },
        create: { userId, threadsPostId: p.threadsPostId, ...data },
        update: data, // обновляем метрики/текст при повторном сборе
      }).catch(() => {});
    }
    // Метку «идёт сбор» (researchRunAt) гасим ТОЛЬКО когда весь проход завершён (done),
    // иначе индикатор пропадал бы после первого из нескольких запросов. Время последнего
    // прохода и диагностику сохраняем всегда.
    const diagStr = parsed.data.diag ? JSON.stringify(parsed.data.diag).slice(0, 8000) : undefined;
    await db.limits
      .updateMany({
        where: { userId },
        data: { researchLastRunAt: new Date(), ...(parsed.data.done ? { researchRunAt: null } : {}), ...(diagStr ? { researchDiag: diagStr } : {}) },
      })
      .catch(() => {});
    return { ok: true };
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
        // Повторная попытка: успех → переводим лид в REPLIED (фикс «висел FAILED навсегда»).
        // Неуспех по уже существующему лиду — не трогаем (останется FAILED, попробуем ещё раз).
        update: e.sent ? { status: 'REPLIED', replyTemplateId: e.templateId } : {},
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
        // Telegram-уведомление владельцу — только если ответ реально отправлен (не FAILED).
        if (e.sent) void notifyOwner(userId, 'lead', `🆕 <b>Новый кандидат</b> @${esc(e.fromUsername || '—')}\nКодовое слово: <b>${esc(e.matchedKeyword)}</b>`);
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
    // Проход завершился (в т.ч. после «Стоп») — гасим метки stopAt/tabClosedAt.
    await db.limits.updateMany({ where: { userId: device.userId }, data: { stopAt: null, tabClosedAt: null } });
    return { ok: true };
  });

  // Живой журнал: строка о текущем действии бота (заходит в раздел, ответил и т.п.).
  // Кольцевой буфер — после вставки оставляем последние 100 строк на юзера.
  const logSchema = z.object({ level: z.enum(['info', 'reply', 'warn']).default('info'), text: z.string().min(1).max(300) });
  app.post('/api/agent/log', async (req, reply) => {
    const device = await authDevice(req.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = logSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    await db.agentLog.create({ data: { userId: device.userId, level: parsed.data.level, text: parsed.data.text } });
    // Кольцевой буфер: оставляем только последние 100 строк юзера.
    const keep = await db.agentLog.findMany({ where: { userId: device.userId }, orderBy: { at: 'desc' }, take: 100, select: { id: true } });
    await db.agentLog.deleteMany({ where: { userId: device.userId, id: { notIn: keep.map((k) => k.id) } } });
    return { ok: true };
  });

  // Расширение сообщает, что ФОНОВАЯ рабочая вкладка закрылась до завершения прохода
  // (юзер случайно закрыл) — ставим метку, дашборд покажет предупреждение.
  app.post('/api/agent/tab-closed', async (req, reply) => {
    const device = await authDevice(req.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    await db.limits.updateMany({ where: { userId: device.userId }, data: { tabClosedAt: new Date() } });
    await db.agentLog.create({ data: { userId: device.userId, level: 'warn', text: 'Рабочая вкладка закрыта — проход прерван. Не закрывайте вкладку Threads до конца прохода.' } });
    return { ok: true };
  });

  // ИИ-калибровка разметки: расширение прислало ВИДИМЫЕ кнопки экрана запроса (без текста
  // переписки) + браузер/язык → Claude определяет, какие из них «Принять/Показать/OK/Отклонить».
  // Результат кладём в Limits.calibration, рантайм расширения матчит кнопки по нему.
  const calibSchema = z.object({
    browser: z.string().max(60).optional(),
    lang: z.string().max(20).optional(),
    controls: z
      .array(z.object({ text: z.string().optional(), aria: z.string().optional(), role: z.string().optional(), filled: z.boolean().optional() }))
      .max(60)
      .default([]),
  });
  app.post('/api/agent/calibrate', async (req, reply) => {
    const device = await authDevice(req.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = calibSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const { browser, lang, controls } = parsed.data;
    const config = await calibrateSelectors(controls as ControlEl[], lang);
    if (!config) {
      // ИИ недоступен/не распознал — снимаем триггер, чтобы не зацикливать; рантайм на эвристиках.
      await db.limits.updateMany({ where: { userId: device.userId }, data: { calibrateAt: null } });
      await db.agentLog.create({ data: { userId: device.userId, level: 'warn', text: 'Калибровка: ИИ не дал результат — работаю на встроенных правилах кнопок.' } });
      return { ok: false };
    }
    await db.limits.updateMany({
      where: { userId: device.userId },
      data: { calibration: JSON.stringify(config), calibratedAt: new Date(), calibrationInfo: [browser, lang].filter(Boolean).join(' · '), calibrateAt: null },
    });
    await db.agentLog.create({
      data: { userId: device.userId, level: 'info', text: `🎯 Калибровка готова (${[browser, config.lang || lang].filter(Boolean).join(' · ')}): «Принять» = ${config.acceptLabels.slice(0, 3).join(', ') || '—'}` },
    });
    return { ok: true, calibration: config };
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
