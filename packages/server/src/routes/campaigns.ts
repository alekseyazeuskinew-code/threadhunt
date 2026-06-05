// Рекламные кампании Meta: предсобранные «связки» лидгена на директ под роли.
// Цепочка: объявление → клик в директ → кодовое слово ловит расширение → автоответ → онбординг.
//
// ВАЖНО: реальный запуск через Marketing API требует App Review Meta (как и постинг),
// поэтому кампании пока живут как ЧЕРНОВИКИ. «Отправить на запуск» переводит в
// pending_review — реальная отгрузка в Ads Manager включится после одобрения Meta.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';

export async function campaignRoutes(app: FastifyInstance) {
  const requireUser = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return userId;
  };
  const own = async (userId: string, id: string) => db.adCampaign.findFirst({ where: { id, userId } });

  // Нормализация для сопоставления кодового слова с matchedKeyword лида.
  const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();

  // ── Список кампаний (опц. по поиску) + атрибуция лидов по кодовому слову ──
  // Лид относим к связке, если он пришёл в её поиск и совпал по кодовому слову.
  app.get('/api/campaigns', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const searchId = (req.query as any)?.searchId as string | undefined;
    const list = await db.adCampaign.findMany({
      where: { userId, ...(searchId ? { searchId } : {}) },
      include: { search: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // лиды по каждому задействованному поиску — одним запросом на поиск
    const searchIds = [...new Set(list.map((c) => c.searchId))];
    const leadsBySearch: Record<string, { matchedKeyword: string; stage: string }[]> = {};
    await Promise.all(
      searchIds.map(async (sid) => {
        leadsBySearch[sid] = await db.lead.findMany({ where: { searchId: sid }, select: { matchedKeyword: true, stage: true } });
      }),
    );

    return list.map((c) => {
      const cw = norm(c.codeWord);
      const ls = leadsBySearch[c.searchId] || [];
      const matched = cw ? ls.filter((l) => norm(l.matchedKeyword).includes(cw)) : [];
      return { ...c, leads: matched.length, hires: matched.filter((l) => l.stage === 'HIRED').length };
    });
  });

  app.get('/api/campaigns/:id', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const c = await db.adCampaign.findFirst({ where: { id, userId }, include: { search: { select: { title: true } } } });
    if (!c) return reply.code(404).send({ error: 'not found' });
    return c;
  });

  // ── Создать кампанию (из связки или с нуля) ──
  const createInput = z.object({
    searchId: z.string().min(1),
    name: z.string().min(1),
    bundleKey: z.string().default(''),
    objective: z.string().default('messages'),
    dailyBudget: z.number().int().min(1).default(500),
    currency: z.string().default('RUB'),
    geo: z.string().default(''),
    ageMin: z.number().int().min(13).max(65).default(18),
    ageMax: z.number().int().min(13).max(65).default(45),
    interests: z.string().default(''),
    creativeHeadline: z.string().default(''),
    creativeText: z.string().default(''),
    mediaUrl: z.string().optional(),
    mediaType: z.string().optional(),
    codeWord: z.string().default(''),
    ctaLabel: z.string().default('Написать в директ'),
  });
  app.post('/api/campaigns', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    const search = await db.search.findFirst({ where: { id: d.searchId, userId } });
    if (!search) return reply.code(404).send({ error: 'Поиск не найден' });

    const campaign = await db.adCampaign.create({ data: { userId, ...d } });
    // Связываем хвост воронки: кодовое слово кампании должно ловиться отбивкой в директе.
    await ensureKeyword(d.searchId, d.codeWord);
    return campaign;
  });

  // ── Обновить ──
  const patchInput = createInput.partial().omit({ searchId: true });
  app.patch('/api/campaigns/:id', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const c = await own(userId, id);
    if (!c) return reply.code(404).send({ error: 'not found' });
    const parsed = patchInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const updated = await db.adCampaign.update({ where: { id }, data: parsed.data });
    if (parsed.data.codeWord) await ensureKeyword(c.searchId, parsed.data.codeWord);
    return updated;
  });

  app.delete('/api/campaigns/:id', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    if (!(await own(userId, id))) return reply.code(404).send({ error: 'not found' });
    await db.adCampaign.delete({ where: { id } });
    return { ok: true };
  });

  // ── Отправить на запуск (gated: пока только статус pending_review) ──
  app.post('/api/campaigns/:id/submit', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const c = await own(userId, id);
    if (!c) return reply.code(404).send({ error: 'not found' });
    // Минимальная готовность связки
    const missing: string[] = [];
    if (!c.creativeText.trim()) missing.push('текст объявления');
    if (!c.codeWord.trim()) missing.push('кодовое слово');
    if (c.dailyBudget < 1) missing.push('бюджет');
    if (missing.length) return reply.code(400).send({ error: 'Заполните: ' + missing.join(', ') });

    const meta = await db.metaConnection.findUnique({ where: { userId } });
    const updated = await db.adCampaign.update({ where: { id }, data: { status: 'pending_review' } });
    return {
      campaign: updated,
      gated: true,
      metaConnected: !!meta,
      note: 'Связка готова и поставлена в очередь. Реальный запуск в Ads Manager включится после одобрения приложения в Meta — мы на модерации. Кодовое слово уже ловится отбивкой в директе.',
    };
  });

  // Гарантируем, что кодовое слово есть среди ключевых слов поиска (иначе автоответ не сработает).
  async function ensureKeyword(searchId: string, word: string) {
    const w = word.trim();
    if (!w) return;
    const exists = await db.keyword.findFirst({ where: { searchId, text: { equals: w } } });
    if (!exists) await db.keyword.create({ data: { searchId, text: w, mode: 'root' } });
  }
}
