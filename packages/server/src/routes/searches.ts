// Маршруты дашборда: CRUD гибких «поисков сотрудников» + шаблоны + расписание + ИИ.
// Заменяет захардкоженный config.js — теперь поиски создаёт сам клиент.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { resolveCtx, canManageLeads } from './workspace.js';
import { generatePosts, generateReplies, generateChain, type BrandVoice } from '../ai/generate.js';
import { aiLimitFor, today } from '../ai/limits.js';
import { decrypt } from '../crypto.js';
import { whoami } from '../threads/publisher.js';
import { parseSegments } from '../threads/segments.js';
import { resolveConnection } from '../threads/resolve.js';
import { publishForSearch } from '../scheduler.js';

export async function searchRoutes(app: FastifyInstance) {
  // Командный доступ: данные всегда в пространстве ВЛАДЕЛЬЦА (ctx.ownerId), кто бы
  // ни делал запрос — сам владелец или приглашённый ассистент. requireUser отдаёт
  // ownerId для чтения; requireManage дополнительно требует право записи (OWNER или
  // MANAGER/ассистент) — VIEWER получает только чтение.
  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return ctx.ownerId;
  };
  // Запись (любой не-GET) в пространстве — только для OWNER и MANAGER (ассистента).
  // VIEWER получает 403 на изменения, но GET-чтение ему разрешено. Хук
  // инкапсулирован в плагине поисков, так что покрывает только эти роуты.
  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'GET') return;
    const ctx = await resolveCtx(app, req);
    if (ctx && !canManageLeads(ctx.role)) {
      return reply.code(403).send({ error: 'Только просмотр: недостаточно прав для изменения' });
    }
  });
  // Проверка принадлежности поиска пространству владельца.
  const own = async (ownerId: string, id: string) => db.search.findFirst({ where: { id, userId: ownerId } });

  // ── Список поисков со сводкой ──
  app.get('/api/searches', async (req, reply) => {
    const userId = await requireUser(req, reply);
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
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { title, description, connectionId, keywords } = parsed.data;
    // Новый поиск создаётся ЧЕРНОВИКОМ (PAUSED): клиент сначала всё настраивает,
    // потом сам жмёт «Запустить сбор». Так отбивка не уходит на неполной настройке.
    return db.search.create({
      data: { userId, title, description, connectionId, status: 'PAUSED', keywords: { create: keywords }, publishConfig: { create: {} } },
      include: { keywords: true, publishConfig: true },
    });
  });

  // ── Удалить поиск ── (каскадом унесёт слова/ответы/посты/лиды/онбординг через onDelete: Cascade)
  app.delete('/api/searches/:id', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    await db.search.delete({ where: { id } });
    return { ok: true };
  });

  // ── Деталь поиска ──
  app.get('/api/searches/:id', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({
      where: { id, userId },
      include: {
        keywords: true,
        replyTemplates: { orderBy: { order: 'asc' } },
        postTemplates: { orderBy: { order: 'asc' } },
        publishConfig: true,
        commentRules: { take: 1 },
        connection: { select: { id: true, username: true } },
        _count: { select: { leads: true, publishedPosts: true } },
      },
    });
    if (!search) return reply.code(404).send({ error: 'not found' });
    // Отдаём правило комментариев одним объектом (в UI — одно правило на поиск).
    const { commentRules, ...rest } = search as any;
    return { ...rest, commentRule: commentRules?.[0] ?? null };
  });

  // ── Правило отбивки в комментариях (через Threads API) ──
  const commentInput = z.object({
    enabled: z.boolean().optional(),
    mode: z.enum(['keyword', 'all']).optional(),
    replyText: z.string().max(500).optional(),
  });
  app.put('/api/searches/:id/comment-rule', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = commentInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    // Одно правило на поиск — на уровне приложения (без DB @unique).
    const existing = await db.commentRule.findFirst({ where: { searchId: id } });
    const row = existing
      ? await db.commentRule.update({
          where: { id: existing.id },
          data: { ...(d.enabled !== undefined ? { enabled: d.enabled } : {}), ...(d.mode ? { mode: d.mode } : {}), ...(d.replyText !== undefined ? { replyText: d.replyText } : {}) },
        })
      : await db.commentRule.create({ data: { searchId: id, enabled: d.enabled ?? false, mode: d.mode ?? 'keyword', replyText: d.replyText ?? '' } });
    return row;
  });

  // ── Обновить базовые поля ──
  const patchInput = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    connectionId: z.string().nullable().optional(),
  });
  app.patch('/api/searches/:id', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = patchInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return db.search.update({ where: { id }, data: parsed.data });
  });

  // ── Вкл/выкл (один тумблер) ──
  app.post('/api/searches/:id/toggle', async (req, reply) => {
    const userId = await requireUser(req, reply);
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
    const userId = await requireUser(req, reply);
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
    const userId = await requireUser(req, reply);
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

  // ── Заменить шаблоны постов (медиа + карусель + цепочки веток) ──
  // Каждый шаблон = цепочка сегментов. segment[0] — корневой пост, остальные —
  // ветки-ответы. media длиной >1 → карусель. Легаси-поля (text/mediaUrl/mediaType)
  // зеркалят первый сегмент для обратной совместимости.
  const mediaItem = z.object({ url: z.string().url(), type: z.enum(['image', 'video']) });
  const segment = z.object({ text: z.string().default(''), media: z.array(mediaItem).max(20).default([]) });
  const postInput = z.object({
    templates: z.array(
      z.object({
        // Новый формат: цепочка сегментов.
        segments: z.array(segment).max(10).optional(),
        // Легаси-поля (если segments не передали).
        text: z.string().default(''),
        mediaUrl: z.string().url().optional().or(z.literal('')),
        mediaType: z.enum(['image', 'video']).optional(),
      }),
    ),
  });
  app.put('/api/searches/:id/post-templates', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = postInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    // Сохраняем шаблоны через пересоздание — но переносим отметку публикации по позиции
    // (иначе lastPublishedAt терялся бы при каждом автосейве).
    const prev = await db.postTemplate.findMany({ where: { searchId: id }, orderBy: { order: 'asc' }, select: { order: true, lastPublishedAt: true } });
    const pubByOrder = new Map(prev.map((p) => [p.order, p.lastPublishedAt]));
    await db.postTemplate.deleteMany({ where: { searchId: id } });
    await db.postTemplate.createMany({
      data: parsed.data.templates.map((t, i) => {
        // Нормализуем в массив сегментов (из segments либо из легаси-полей).
        const segs =
          t.segments && t.segments.length
            ? t.segments.filter((s) => (s.text && s.text.trim()) || s.media.length)
            : [{ text: t.text, media: t.mediaUrl && t.mediaType ? [{ url: t.mediaUrl, type: t.mediaType }] : [] }];
        const root = segs[0] ?? { text: '', media: [] };
        const hasChain = segs.length > 1 || root.media.length > 1;
        return {
          searchId: id,
          text: root.text || '',
          mediaUrl: root.media[0]?.url || null,
          mediaType: root.media[0]?.type || null,
          // segmentsJson храним только если есть что хранить сверх одного простого медиа.
          segmentsJson: hasChain ? JSON.stringify(segs) : null,
          order: i,
          lastPublishedAt: pubByOrder.get(i) ?? null,
        };
      }),
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
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const parsed = cfgInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return db.publishConfig.update({ where: { searchId: id }, data: parsed.data });
  });

  // ── Лиды поиска ──
  app.get('/api/searches/:id/leads', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    return db.lead.findMany({ where: { searchId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
  });

  // ── Статистика отбивки в директе (для карточки) ──
  // lastPass — последний проход (глобальный по аккаунту). byKeyword — всего ответов
  // по кодовым словам этого поиска (как «дизайн 96 / монтаж 65» на эталоне).
  app.get('/api/searches/:id/dm-stats', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });

    const [lastPass, grouped, device, limits] = await Promise.all([
      // Последний проход ЛЮБОГО режима (включая безопасный/тест) — чтобы статус «сухого»
      // прохода оставался виден постфактум. Режим отдаём флагом dryRun для подписи.
      db.agentPass.findFirst({ where: { userId }, orderBy: { at: 'desc' } }),
      db.lead.groupBy({ by: ['matchedKeyword'], where: { searchId: id, status: 'REPLIED' }, _count: { _all: true } }),
      db.device.findFirst({ where: { userId }, orderBy: { lastHeartbeat: 'desc' } }),
      db.limits.findUnique({ where: { userId } }),
    ]);
    const byKeyword = grouped
      .map((g) => ({ keyword: g.matchedKeyword, count: g._count._all }))
      .sort((a, b) => b.count - a.count);
    const online = !!device?.lastHeartbeat && Date.now() - new Date(device.lastHeartbeat).getTime() < 3 * 60_000;
    return {
      lastPass: lastPass ? { scanned: lastPass.scanned, sent: lastPass.sent, matched: lastPass.matched, sections: lastPass.sections, at: lastPass.at, dryRun: lastPass.dryRun } : null,
      byKeyword,
      agent: { online, threadsLoggedIn: !!device?.threadsLoggedIn, lastHeartbeat: device?.lastHeartbeat ?? null },
      runNowAt: limits?.runNowAt ?? null,
    };
  });

  // ── Хронология «что происходит на бэке» ──
  // Единая лента: публикации постов + лиды отбивки + проходы агента, по времени.
  app.get('/api/searches/:id/activity', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });

    const [posts, leads, passes] = await Promise.all([
      db.publishedPost.findMany({ where: { searchId: id }, orderBy: { createdAt: 'desc' }, take: 25 }),
      db.lead.findMany({ where: { searchId: id }, orderBy: { createdAt: 'desc' }, take: 25 }),
      db.agentPass.findMany({ where: { userId }, orderBy: { at: 'desc' }, take: 15 }),
    ]);
    type Item = { kind: 'post' | 'lead' | 'pass'; at: Date; ok: boolean; title: string; detail?: string; permalink?: string | null };
    const items: Item[] = [];
    for (const p of posts)
      items.push({
        kind: 'post',
        at: p.createdAt,
        ok: p.ok,
        title: p.ok ? 'Опубликован пост' : 'Ошибка публикации',
        detail: p.ok ? p.text.slice(0, 120) : p.error || p.text.slice(0, 120),
        permalink: p.permalink,
      });
    for (const l of leads)
      items.push({
        kind: 'lead',
        at: l.createdAt,
        ok: l.status === 'REPLIED',
        title: l.status === 'REPLIED' ? `Ответили лиду${l.fromUsername ? ' @' + l.fromUsername : ''}` : `Лид без ответа${l.fromUsername ? ' @' + l.fromUsername : ''}`,
        detail: `слово «${l.matchedKeyword}»${l.section ? ' · ' + l.section : ''}`,
      });
    for (const pass of passes)
      items.push({
        kind: 'pass',
        at: pass.at,
        ok: true,
        title: pass.dryRun ? 'Проход (тест/безопасный)' : 'Проход отбивки',
        detail: `проверено ${pass.scanned} · найдено ${pass.matched} · отправлено ${pass.sent}`,
      });
    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return items.slice(0, 40);
  });

  // ── Очистить хронологию «что происходит на бэке» ──
  // Удаляем шум: записи об ОШИБКАХ публикации + логи проходов агента. Лиды (кандидаты)
  // и успешные публикации НЕ трогаем — их история важна.
  app.post('/api/searches/:id/activity/clear', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const [posts, passes] = await Promise.all([
      db.publishedPost.deleteMany({ where: { searchId: id, ok: false } }),
      db.agentPass.deleteMany({ where: { userId } }),
    ]);
    return { ok: true, removed: posts.count + passes.count };
  });

  // ── Research: топовые вакансии-ветки (собраны расширением). Окно: week|month|all ──
  app.get('/api/searches/:id/research', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    const window = String((req.query as any)?.window || 'month');
    // «Лучшее за …» — окно по дате ПУБЛИКАЦИИ поста (postedAt). all = последние полгода
    // (быстро, без древних веток). Посты без распознанной даты показываем только в «all».
    const days = window === 'week' ? 7 : window === 'all' ? 180 : 30;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const rows = await db.researchPost.findMany({
      where: {
        userId,
        searchId: id,
        OR: [{ postedAt: { gte: cutoff } }, ...(window === 'all' ? [{ postedAt: null }] : [])],
      },
      orderBy: { fetchedAt: 'desc' },
      take: 300,
    });
    // Сортируем по вовлечённости (ответы и репосты весомее лайков).
    const posts = rows
      .map((r) => ({ ...r, score: r.likes + r.replies * 2 + r.reposts * 3 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        text: r.text,
        author: r.author,
        permalink: r.permalink,
        likes: r.likes,
        replies: r.replies,
        reposts: r.reposts,
        score: r.score,
        postedAt: r.postedAt,
      }));
    // Статус: идёт ли сбор сейчас, когда последний раз нашли посты и когда был последний проход.
    const lim = await db.limits.findUnique({ where: { userId }, select: { researchRunAt: true, researchLastRunAt: true, researchDiag: true } });
    const lastRow = await db.researchPost.findFirst({ where: { userId, searchId: id }, orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } });
    let diag: any = null;
    try { diag = lim?.researchDiag ? JSON.parse(lim.researchDiag) : null; } catch { diag = null; }
    // «Идёт сбор» — метка стоит и поставлена не более 4 минут назад (авто-истечение, чтобы
    // индикатор не завис, если расширение не прислало сигнал завершения).
    const running = !!lim?.researchRunAt && Date.now() - new Date(lim.researchRunAt).getTime() < 4 * 60_000;
    return {
      posts,
      running,
      lastAt: lastRow?.fetchedAt ? lastRow.fetchedAt.toISOString() : null,
      lastRunAt: lim?.researchLastRunAt ? lim.researchLastRunAt.toISOString() : null,
      diag,
    };
  });

  // ── ИИ-генерация постов / ответов / цепочек веток ──
  const genSchema = z.object({
    kind: z.enum(['posts', 'replies', 'chain']).default('posts'),
    count: z.number().min(1).max(10).default(5),
    brief: z.string().max(2000).optional(),
    formats: z.array(z.string().max(40)).max(12).optional(),
    segments: z.number().min(2).max(3).optional(), // для kind=chain: длина цепочки
    seed: z.string().max(2000).optional(), // базовый текст: сделать варианты «в духе этого»
  });
  // Генерация выполняется СРАЗУ (inline). Защита бюджета: дневной лимит по тарифу +
  // учёт расхода. Персонализация: подставляем «Голос бренда». Graceful: при сбое ИИ
  // отдаём демо-вариации (generate*() не бросают исключений).
  app.post('/api/searches/:id/generate', async (req, reply) => {
    const userId = await requireUser(req, reply);
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

    const { kind, count, brief, formats, segments, seed } = genSchema.parse(req.body ?? {});
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

    const keyword = search.keywords[0]?.text || search.title;
    const out =
      kind === 'replies'
        ? await generateReplies({ title: search.title, description: search.description, redirectTarget: brand?.signature || '', count, brand: voice, brief, seed })
        : kind === 'chain'
          ? await generateChain({ title: search.title, description: search.description, keyword, count, brand: voice, brief, formats, segments })
          : await generatePosts({
              title: search.title,
              description: search.description,
              keyword,
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
    const userId = await requireUser(req, reply);
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
    const userId = await requireUser(req, reply);
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
    const userId = await requireUser(req, reply);
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

    // что вышло бы следующим постом (с учётом карусели и цепочки веток)
    let wouldPost:
      | { index: number; text: string; mediaUrl: string | null; mediaType: string | null; rotation: string; segmentCount: number; mediaCount: number }
      | null = null;
    if (hasTpl) {
      const idx = (cfg?.nextIndex || 0) % search.postTemplates.length;
      const tpl = search.postTemplates[idx];
      const segs = parseSegments(tpl);
      const root = segs[0];
      wouldPost = {
        index: idx,
        text: root?.text || tpl.text,
        mediaUrl: root?.media?.[0]?.url ?? tpl.mediaUrl ?? null,
        mediaType: root?.media?.[0]?.type ?? tpl.mediaType ?? null,
        segmentCount: segs.length, // 1 = обычный пост, >1 = цепочка веток
        mediaCount: root?.media?.length ?? 0, // >1 = карусель в корневом посте
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
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({ where: { id, userId }, select: { id: true } });
    if (!search) return reply.code(404).send({ error: 'not found' });
    try {
      const result = await publishForSearch(id);
      if (!result.ok) return reply.code(400).send({ error: result.error || 'Не удалось опубликовать' });
      return result; // { ok: true, permalink }
    } catch (e: any) {
      app.log.error({ err: e }, 'publish-now failed');
      return reply.code(400).send({ error: 'Сбой публикации: ' + (e?.message || 'неизвестная ошибка') });
    }
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
    const userId = await requireUser(req, reply);
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
    const userId = await requireUser(req, reply);
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
    const userId = await requireUser(req, reply);
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
