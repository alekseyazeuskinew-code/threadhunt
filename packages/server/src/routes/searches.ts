// Маршруты дашборда: CRUD гибких «поисков сотрудников» + шаблоны + расписание + ИИ.
// Заменяет захардкоженный config.js — теперь поиски создаёт сам клиент.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';
import { generatePosts, generateReplies, type BrandVoice } from '../ai/generate.js';
import { aiLimitFor, today } from '../ai/limits.js';
import { decrypt } from '../crypto.js';
import { whoami } from '../threads/publisher.js';
import { resolveConnection } from '../threads/resolve.js';
import { publishForSearch } from '../scheduler.js';

export async function searchRoutes(app: FastifyInstance) {
  // Хелпер: вернуть userId или null (и сразу ответить 401 при null — через requireUser).
  const requireUser = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return userId;
  };
  // Проверка владения поиском.
  const own = async (userId: string, id: string) => db.search.findFirst({ where: { id, userId } });

  // ── Список поисков со сводкой ──
  app.get('/api/searches', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    return db.search.findMany({
      where: { userId },
      include: {
        keywords: true,
        publishConfig: true,
        connection: { select: { username: true } },
        _count: { select: { leads: true, publishedPosts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  // ── Создать поиск ──
  const createInput = z.object({
    title: z.string().min(1),
    description: z.string().default(''),
    connectionId: z.string().optional(),
    keywords: z.array(z.object({ text: z.string().min(1), mode: z.string().default('root'), replyText: z.string().optional() })).default([]),
  });
  app.post('/api/searches', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { title, description, connectionId, keywords } = parsed.data;
    return db.search.create({
      data: { userId, title, description, connectionId, keywords: { create: keywords }, publishConfig: { create: {} } },
      include: { keywords: true, publishConfig: true },
    });
  });

  // ── Деталь поиска ──
  app.get('/api/searches/:id', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({
      where: { id, userId },
      include: {
        keywords: true,
        replyTemplates: { orderBy: { order: 'asc' } },
        postTemplates: { orderBy: { order: 'asc' } },
        publishConfig: true,
        commentRule: true,
        connection: { select: { id: true, username: true } },
        _count: { select: { leads: true, publishedPosts: true } },
      },
    });
    if (!search) return reply.code(404).send({ error: 'not found' });
    return search;
  });

  // ── Правило отбивки в комментариях (через Threads API) ──
  const commentInput = z.object({
    enabled: z.boolean().optional(),
    mode: z.enum(['keyword', 'all']).optional(),
    replyText: z.string().max(500).optional(),
  });
  app.put('/api/searches/:id/comment-rule', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = commentInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    const row = await db.commentRule.upsert({
      where: { searchId: id },
      create: { searchId: id, enabled: d.enabled ?? false, mode: d.mode ?? 'keyword', replyText: d.replyText ?? '' },
      update: { ...(d.enabled !== undefined ? { enabled: d.enabled } : {}), ...(d.mode ? { mode: d.mode } : {}), ...(d.replyText !== undefined ? { replyText: d.replyText } : {}) },
    });
    return row;
  });

  // ── Обновить базовые поля ──
  const patchInput = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    connectionId: z.string().nullable().optional(),
  });
  app.patch('/api/searches/:id', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = patchInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return db.search.update({ where: { id }, data: parsed.data });
  });

  // ── Вкл/выкл (один тумблер) ──
  app.post('/api/searches/:id/toggle', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await own(userId, id);
    if (!search) return reply.code(404).send({ error: 'not found' });
    const updated = await db.search.update({
      where: { id },
      data: { status: search.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' },
    });
    return { status: updated.status };
  });

  // ── Заменить кодовые слова ──
  const kwInput = z.object({
    keywords: z.array(z.object({ text: z.string().min(1), mode: z.string().default('root'), replyText: z.string().optional() })),
  });
  app.put('/api/searches/:id/keywords', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = kwInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await db.keyword.deleteMany({ where: { searchId: id } });
    await db.keyword.createMany({ data: parsed.data.keywords.map((k) => ({ ...k, searchId: id })) });
    return db.keyword.findMany({ where: { searchId: id } });
  });

  // ── Заменить шаблоны отбивки ──
  const replyInput = z.object({
    templates: z.array(z.object({ text: z.string().min(1), redirectTarget: z.string().default('') })),
  });
  app.put('/api/searches/:id/reply-templates', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = replyInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await db.replyTemplate.deleteMany({ where: { searchId: id } });
    await db.replyTemplate.createMany({
      data: parsed.data.templates.map((t, i) => ({ ...t, searchId: id, order: i })),
    });
    return db.replyTemplate.findMany({ where: { searchId: id }, orderBy: { order: 'asc' } });
  });

  // ── Заменить шаблоны постов (с медиа) ──
  const postInput = z.object({
    templates: z.array(
      z.object({
        text: z.string().default(''),
        mediaUrl: z.string().url().optional().or(z.literal('')),
        mediaType: z.enum(['image', 'video']).optional(),
      }),
    ),
  });
  app.put('/api/searches/:id/post-templates', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = postInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await db.postTemplate.deleteMany({ where: { searchId: id } });
    await db.postTemplate.createMany({
      data: parsed.data.templates.map((t, i) => ({
        searchId: id,
        text: t.text,
        mediaUrl: t.mediaUrl || null,
        mediaType: t.mediaType || null,
        order: i,
      })),
    });
    return db.postTemplate.findMany({ where: { searchId: id }, orderBy: { order: 'asc' } });
  });

  // ── Настройки автопостинга ──
  // Анти-бан потолки: не чаще раза в 30 мин и не больше 25 постов/день на аккаунт —
  // даже если клиент попросит агрессивнее. Это защита его же Threads-аккаунта.
  const cfgInput = z.object({
    enabled: z.boolean().optional(),
    intervalMinutes: z.number().min(30, 'Минимальный интервал — 30 минут').optional(),
    maxPerDay: z.number().min(0).max(25, 'Не больше 25 постов в день — это бережёт аккаунт').optional(),
    rotation: z.enum(['sequential', 'random']).optional(),
  });
  app.patch('/api/searches/:id/publish-config', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = cfgInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return db.publishConfig.update({ where: { searchId: id }, data: parsed.data });
  });

  // ── Лиды поиска ──
  app.get('/api/searches/:id/leads', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    return db.lead.findMany({ where: { searchId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
  });

  // ── ИИ-генерация постов / ответов ──
  const genSchema = z.object({
    kind: z.enum(['posts', 'replies']).default('posts'),
    count: z.number().min(1).max(10).default(5),
    brief: z.string().max(2000).optional(),
    formats: z.array(z.string().max(40)).max(12).optional(),
  });
  // Генерация выполняется СРАЗУ (inline). Защита бюджета: дневной лимит по тарифу +
  // учёт расхода. Персонализация: подставляем «Голос бренда». Graceful: при сбое ИИ
  // отдаём демо-вариации (generate*() не бросают исключений).
  app.post('/api/searches/:id/generate', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const [search, user, brand] = await Promise.all([
      db.search.findFirst({ where: { id, userId }, include: { keywords: true } }),
      db.user.findUnique({ where: { id: userId }, select: { plan: true } }),
      db.brandProfile.findUnique({ where: { userId } }),
    ]);
    if (!search) return reply.code(404).send({ error: 'not found' });

    // ── лимит по тарифу ──
    const limit = aiLimitFor(user?.plan);
    if (limit === 0) return reply.code(403).send({ error: 'ИИ-генерация доступна на тарифах Pro и VIP' });
    const day = today();
    const usage = await db.aiUsage.findUnique({ where: { userId_day: { userId, day } } });
    const used = usage?.count || 0;
    if (used >= limit) {
      return reply.code(429).send({ error: `Дневной лимит ИИ исчерпан (${limit}/день). Обнови тариф или вернись завтра.` });
    }

    const { kind, count, brief, formats } = genSchema.parse(req.body ?? {});
    const voice: BrandVoice | undefined = brand
      ? {
          companyName: brand.companyName,
          niche: brand.niche,
          tone: brand.tone,
          audience: brand.audience,
          perks: brand.perks,
          signature: brand.signature,
          sample: brand.sample,
          avoid: brand.avoid,
        }
      : undefined;

    const out =
      kind === 'replies'
        ? await generateReplies({ title: search.title, description: search.description, redirectTarget: '', count, brand: voice })
        : await generatePosts({
            title: search.title,
            description: search.description,
            keyword: search.keywords[0]?.text || search.title,
            count,
            brand: voice,
            brief,
            formats,
          });

    // учёт расхода (+1 за вызов) и журнал
    await db.aiUsage.upsert({
      where: { userId_day: { userId, day } },
      create: { userId, day, count: 1 },
      update: { count: { increment: 1 } },
    });
    await db.aiJob.create({ data: { searchId: id, kind, status: 'done', result: JSON.stringify(out.items) } });

    return { result: out.items, source: out.source, remaining: Math.max(0, limit - used - 1) };
  });

  app.get('/api/ai-jobs/:id', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const job = await db.aiJob.findUnique({ where: { id } });
    if (!job) return reply.code(404).send({ error: 'not found' });
    // result хранится JSON-строкой (SQLite) — отдаём уже распарсенным массивом
    return { ...job, result: job.result ? JSON.parse(job.result) : null };
  });

  // ── История публикаций (с превью и ссылкой на пост) ──
  // Хронология нужна, чтобы видеть, что уже выходило, и не повторять тексты.
  app.get('/api/posts', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const searchId = (req.query as any)?.searchId as string | undefined;
    const mine = await db.search.findMany({ where: { userId }, select: { id: true } });
    const ids = mine.map((s) => s.id);
    const posts = await db.publishedPost.findMany({
      where: { searchId: searchId && ids.includes(searchId) ? searchId : { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: { search: { select: { title: true } } },
    });
    return posts.map((p) => ({
      id: p.id,
      searchTitle: p.search.title,
      text: p.text,
      mediaType: p.mediaType,
      mediaUrl: p.mediaUrl,
      permalink: p.permalink,
      threadsPostId: p.threadsPostId,
      ok: p.ok,
      error: p.error,
      createdAt: p.createdAt,
    }));
  });

  // ── Тест публикации (dry-run) ──
  // Прогоняет ВСЮ подготовку публикации, но НИЧЕГО не постит и не пишет в базу:
  // проверяет подключение/токен/шаблоны/лимиты и показывает, что бы вышло следующим.
  app.post('/api/searches/:id/test-publish', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({
      where: { id, userId },
      include: { postTemplates: { orderBy: { order: 'asc' } }, publishConfig: true, connection: true },
    });
    if (!search) return reply.code(404).send({ error: 'not found' });

    const cfg = search.publishConfig;
    const checks: { label: string; ok: boolean; detail?: string }[] = [];

    // Подключение: явно привязанное к поиску или аккаунт пользователя по умолчанию.
    const conn = await resolveConnection(search);
    const hasConn = !!conn?.accessTokenEnc;
    checks.push({ label: 'Threads-аккаунт подключён', ok: hasConn, detail: conn?.username ? `@${conn.username}` : 'нет подключения' });

    const hasTpl = search.postTemplates.length > 0;
    checks.push({ label: 'Есть шаблоны постов', ok: hasTpl, detail: `${search.postTemplates.length} шт.` });

    checks.push({ label: 'Автопостинг включён', ok: !!cfg?.enabled, detail: cfg?.enabled ? `каждые ${cfg.intervalMinutes} мин, до ${cfg.maxPerDay}/день` : 'выключен' });

    // дневной лимит и интервал (как в планировщике) — для информации
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const todayCount = await db.publishedPost.count({ where: { searchId: id, ok: true, createdAt: { gte: since } } });
    const underDaily = !cfg || todayCount < cfg.maxPerDay;
    checks.push({ label: 'Дневной лимит не исчерпан', ok: underDaily, detail: cfg ? `${todayCount}/${cfg.maxPerDay} сегодня` : '—' });

    // живость токена — безопасный read-only вызов /me (ничего не публикует)
    let tokenOk = false;
    let tokenDetail = 'не проверялся';
    if (hasConn) {
      try {
        const me = await whoami(decrypt(conn!.accessTokenEnc!));
        tokenOk = true;
        tokenDetail = me?.username ? `токен валиден · @${me.username}` : 'токен валиден';
      } catch (e: any) {
        tokenOk = false;
        tokenDetail = 'токен недействителен: ' + String(e?.message || e).slice(0, 140);
      }
      checks.push({ label: 'Токен рабочий (проверка /me)', ok: tokenOk, detail: tokenDetail });
    }

    // что вышло бы следующим постом
    let wouldPost: { index: number; text: string; mediaUrl: string | null; mediaType: string | null; rotation: string } | null = null;
    if (hasTpl) {
      const idx = (cfg?.nextIndex || 0) % search.postTemplates.length;
      const tpl = search.postTemplates[idx];
      wouldPost = {
        index: idx,
        text: tpl.text,
        mediaUrl: tpl.mediaUrl ?? null,
        mediaType: tpl.mediaType ?? null,
        rotation: cfg?.rotation === 'random' ? 'случайный (один из шаблонов)' : 'по очереди',
      };
    }

    const ready = hasConn && hasTpl && tokenOk;
    return { ready, dryRun: true, connection: conn?.username ?? null, checks, wouldPost };
  });

  // ── Реальная публикация по кнопке («Опубликовать сейчас») ──
  // В отличие от test-publish, реально постит один пост (следующий по ротации)
  // через ту же логику, что и планировщик. Удобно для проверки и скринкаста.
  app.post('/api/searches/:id/publish-now', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({ where: { id, userId }, select: { id: true } });
    if (!search) return reply.code(404).send({ error: 'not found' });
    const result = await publishForSearch(id);
    if (!result.ok) return reply.code(400).send({ error: result.error || 'Не удалось опубликовать' });
    return result; // { ok: true, permalink }
  });

  // ── Автопланировщик целей найма ──
  // Из цели (нанять N) и ожидаемой конверсии считаем, сколько нужно лидов, и отслеживаем
  // прогресс. Если приток лидов встал, а цель не достигнута — флаг «пересмотреть текстовки».
  async function goalState(search: {
    id: string;
    createdAt: Date;
    goalEnabled: boolean;
    goalHires: number;
    goalConversion: number;
    goalDueAt: Date | null;
    goalStartedAt: Date | null;
  }) {
    const start = search.goalStartedAt ?? search.createdAt;
    const now = Date.now();
    const d3 = new Date(now - 3 * 86400_000);

    const [leads, hires, leadsLast3d, lastLead] = await Promise.all([
      db.lead.count({ where: { searchId: search.id, createdAt: { gte: start } } }),
      db.lead.count({ where: { searchId: search.id, stage: 'HIRED', createdAt: { gte: start } } }),
      db.lead.count({ where: { searchId: search.id, createdAt: { gte: d3 } } }),
      db.lead.findFirst({ where: { searchId: search.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);

    const requiredLeads = search.goalConversion > 0 ? Math.ceil(search.goalHires / (search.goalConversion / 100)) : 0;
    const lastLeadAt = lastLead?.createdAt ?? null;
    const lastLeadAgeDays = lastLeadAt ? Math.floor((now - lastLeadAt.getTime()) / 86400_000) : null;

    // дни до дедлайна и ожидаемый темп
    let daysLeft: number | null = null;
    let expectedLeads: number | null = null;
    let onPace: boolean | null = null;
    if (search.goalDueAt) {
      const totalMs = search.goalDueAt.getTime() - start.getTime();
      const elapsed = now - start.getTime();
      daysLeft = Math.ceil((search.goalDueAt.getTime() - now) / 86400_000);
      if (totalMs > 0) {
        expectedLeads = Math.round(requiredLeads * Math.min(1, Math.max(0, elapsed / totalMs)));
        onPace = leads >= expectedLeads;
      }
    }

    // приток встал: цель активна, ещё не достигнута, новых лидов нет 3+ дня
    const stale = search.goalEnabled && hires < search.goalHires && leadsLast3d === 0 && leads < requiredLeads;

    return { requiredLeads, leads, hires, leadsLast3d, lastLeadAt, lastLeadAgeDays, daysLeft, expectedLeads, onPace, stale };
  }

  app.get('/api/searches/:id/goal', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await own(userId, id);
    if (!search) return reply.code(404).send({ error: 'not found' });
    const config = {
      goalEnabled: search.goalEnabled,
      goalHires: search.goalHires,
      goalConversion: search.goalConversion,
      goalDueAt: search.goalDueAt,
      goalStartedAt: search.goalStartedAt,
    };
    return { config, ...(await goalState(search)) };
  });

  const goalInput = z.object({
    goalEnabled: z.boolean(),
    goalHires: z.number().int().min(0).max(1000),
    goalConversion: z.number().int().min(1).max(100),
    goalDueAt: z.string().datetime().nullable().optional(),
  });
  app.put('/api/searches/:id/goal', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await own(userId, id);
    if (!search) return reply.code(404).send({ error: 'not found' });
    const parsed = goalInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { goalEnabled, goalHires, goalConversion, goalDueAt } = parsed.data;
    // ставим точку отсчёта при первом включении
    const goalStartedAt = goalEnabled ? search.goalStartedAt ?? new Date() : null;
    const updated = await db.search.update({
      where: { id },
      data: { goalEnabled, goalHires, goalConversion, goalDueAt: goalDueAt ? new Date(goalDueAt) : null, goalStartedAt },
    });
    return {
      config: { goalEnabled: updated.goalEnabled, goalHires: updated.goalHires, goalConversion: updated.goalConversion, goalDueAt: updated.goalDueAt, goalStartedAt: updated.goalStartedAt },
      ...(await goalState(updated)),
    };
  });

  // Сводка целей по всем поискам — для блока на Обзоре.
  app.get('/api/analytics/goals', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const searches = await db.search.findMany({ where: { userId, goalEnabled: true } });
    const rows = await Promise.all(
      searches.map(async (s) => ({
        id: s.id,
        title: s.title,
        goalHires: s.goalHires,
        goalDueAt: s.goalDueAt,
        ...(await goalState(s)),
      })),
    );
    return rows;
  });
}
