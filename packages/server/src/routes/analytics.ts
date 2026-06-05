// Аналитика: сводка по всем поискам (overview) и детальная по одному поиску.
// Тяжёлых SQL-агрегаций избегаем (кросс-БД) — тянем нужные поля и считаем в JS.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';

const DAY = 86_400_000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Раскладка лидов по дням за последние n дней: [{ date, label, total, replied }].
function buildSeries(leads: { createdAt: Date; status: string }[], days: number) {
  const today = startOfDay(new Date());
  const buckets = Array.from({ length: days }, (_, i) => {
    const date = new Date(today.getTime() - (days - 1 - i) * DAY);
    return {
      date: date.toISOString().slice(0, 10),
      label: `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`,
      total: 0,
      replied: 0,
    };
  });
  const index = new Map(buckets.map((b, i) => [b.date, i]));
  for (const l of leads) {
    const key = startOfDay(l.createdAt).toISOString().slice(0, 10);
    const i = index.get(key);
    if (i === undefined) continue;
    buckets[i].total++;
    if (l.status === 'REPLIED') buckets[i].replied++;
  }
  return buckets;
}

function sectionCounts(leads: { section: string | null }[]) {
  const out = { requests: 0, hidden: 0, main: 0, unknown: 0 };
  for (const l of leads) {
    if (l.section === 'requests') out.requests++;
    else if (l.section === 'hidden') out.hidden++;
    else if (l.section === 'main') out.main++;
    else out.unknown++;
  }
  return out;
}

export async function analyticsRoutes(app: FastifyInstance) {
  const requireUser = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return userId;
  };

  // ── Сводка по всему аккаунту ──
  app.get('/api/analytics/overview', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const now = Date.now();
    const since7 = new Date(now - 7 * DAY);
    const today0 = startOfDay(new Date());

    const [searches, leads, postsTotal, posts7, connections, devicesOnline] = await Promise.all([
      db.search.findMany({ where: { userId }, select: { id: true, title: true, status: true } }),
      db.lead.findMany({ where: { userId }, select: { createdAt: true, status: true, section: true, searchId: true, stage: true } }),
      db.publishedPost.count({ where: { ok: true, search: { userId } } }),
      db.publishedPost.count({ where: { ok: true, search: { userId }, createdAt: { gte: since7 } } }),
      db.threadsConnection.count({ where: { userId } }),
      db.device.count({ where: { connection: { userId }, lastHeartbeat: { gte: new Date(now - 120_000) } } }),
    ]);

    const totalLeads = leads.length;
    const replied = leads.filter((l) => l.status === 'REPLIED').length;
    const leadsToday = leads.filter((l) => l.createdAt >= today0).length;
    const leads7 = leads.filter((l) => l.createdAt >= since7).length;

    // топ поисков по лидам
    const bySearchMap = new Map<string, number>();
    for (const l of leads) bySearchMap.set(l.searchId, (bySearchMap.get(l.searchId) || 0) + 1);
    const titleById = new Map(searches.map((s) => [s.id, s.title]));
    const topSearches = [...bySearchMap.entries()]
      .map(([id, count]) => ({ id, title: titleById.get(id) || '—', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Запас команды (механика удержания): по каждой роли — сколько в команде (HIRED)
    // и сколько в резерве (BENCH). Рекомендуем держать ≥2 тёплых про запас.
    const RESERVE_TARGET = 2;
    const hiredBy = new Map<string, number>();
    const benchBy = new Map<string, number>();
    for (const l of leads) {
      if (l.stage === 'HIRED') hiredBy.set(l.searchId, (hiredBy.get(l.searchId) || 0) + 1);
      if (l.stage === 'BENCH') benchBy.set(l.searchId, (benchBy.get(l.searchId) || 0) + 1);
    }
    const teamHealth = searches
      .map((s) => ({
        id: s.id,
        title: s.title,
        hired: hiredBy.get(s.id) || 0,
        bench: benchBy.get(s.id) || 0,
        reserveTarget: RESERVE_TARGET,
      }))
      .filter((r) => r.hired > 0 || r.bench > 0)
      .sort((a, b) => b.hired - a.hired);
    const rolesAtRisk = teamHealth.filter((r) => r.hired > 0 && r.bench === 0).length;

    return {
      kpi: {
        leadsTotal: totalLeads,
        leadsToday,
        leads7,
        replyRate: totalLeads ? Math.round((replied / totalLeads) * 100) : 0,
        postsTotal,
        posts7,
        searchesActive: searches.filter((s) => s.status === 'ACTIVE').length,
        searchesTotal: searches.length,
        connections,
        devicesOnline,
        rolesAtRisk,
      },
      series: buildSeries(leads, 14),
      sections: sectionCounts(leads),
      topSearches,
      teamHealth,
    };
  });

  // ── Лента активности (хронология событий автоматизаций) ──
  app.get('/api/analytics/activity', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const [posts, leads] = await Promise.all([
      db.publishedPost.findMany({ where: { search: { userId } }, orderBy: { createdAt: 'desc' }, take: 12, include: { search: { select: { title: true } } } }),
      db.lead.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 12, include: { search: { select: { title: true } } } }),
    ]);
    const events = [
      ...posts.map((p) => ({ type: 'post' as const, at: p.createdAt, search: p.search.title, ok: p.ok })),
      ...leads.map((l) => ({ type: 'lead' as const, at: l.createdAt, search: l.search.title, who: l.fromUsername, keyword: l.matchedKeyword })),
    ];
    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    return events.slice(0, 15);
  });

  // ── «Требует действия»: задачи по кандидатам на сегодня ──
  // Просроченные/скоро истекающие тесты, сданные работы на оценку, резерв к касанию.
  app.get('/api/analytics/todo', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const now = Date.now();
    const soon = now + 6 * 3600_000;
    const leads = await db.lead.findMany({
      where: {
        userId,
        OR: [
          { stage: 'SCREENING' },
          { stage: 'BENCH', nextTouchAt: { not: null } },
        ],
      },
      include: { search: { select: { title: true } } },
    });

    type Item = { type: string; priority: number; leadId: string; name: string; searchId: string; searchTitle: string; detail: string; at: Date | null };
    const items: Item[] = [];
    for (const l of leads) {
      const name = l.candidateName || l.fromUsername || 'кандидат';
      const base = { leadId: l.id, name, searchId: l.searchId, searchTitle: l.search.title };
      if (l.stage === 'SCREENING' && l.testSubmittedAt) {
        items.push({ ...base, type: 'review', priority: 1, detail: 'сдал работу — оцени и прими решение', at: l.testSubmittedAt });
      } else if (l.stage === 'SCREENING' && l.testDeadlineAt) {
        const t = l.testDeadlineAt.getTime();
        if (t < now) items.push({ ...base, type: 'test_overdue', priority: 0, detail: 'дедлайн теста просрочен', at: l.testDeadlineAt });
        else if (t < soon) items.push({ ...base, type: 'test_soon', priority: 2, detail: 'дедлайн теста скоро истекает', at: l.testDeadlineAt });
      } else if (l.stage === 'BENCH' && l.nextTouchAt && l.nextTouchAt.getTime() <= now) {
        items.push({ ...base, type: 'bench_touch', priority: 3, detail: 'резерв — пора напомнить о себе', at: l.nextTouchAt });
      }
    }
    items.sort((a, b) => a.priority - b.priority || (a.at?.getTime() || 0) - (b.at?.getTime() || 0));
    return items;
  });

  // ── Сводка онбординга по всем ролям аккаунта (для главной) ──
  app.get('/api/analytics/onboarding', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const searches = await db.search.findMany({
      where: { userId, obEnabled: true },
      select: { id: true, title: true, obFlow: true, obConditions: true, obTestTask: true, obNda: true },
    });
    const rows = [];
    for (const s of searches) {
      let pageCount = 1;
      if (s.obFlow) {
        try {
          const f = JSON.parse(s.obFlow);
          if (Array.isArray(f.pages) && f.pages.length) pageCount = f.pages.length;
        } catch {}
      } else {
        pageCount = 1 + (s.obConditions || s.obTestTask ? 1 : 0) + (s.obNda ? 1 : 0) + (s.obTestTask ? 1 : 0);
      }
      const leads = await db.lead.findMany({ where: { searchId: s.id, onboardToken: { not: null } }, select: { obStep: true } });
      const issued = leads.length;
      const finished = leads.filter((l) => l.obStep >= pageCount).length;
      rows.push({ id: s.id, title: s.title, issued, finished });
    }
    rows.sort((a, b) => b.issued - a.issued);
    return rows;
  });

  // ── Детальная статистика по одному поиску ──
  app.get('/api/analytics/search/:id', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const id = (req.params as any).id as string;
    const search = await db.search.findFirst({ where: { id, userId }, select: { id: true } });
    if (!search) return reply.code(404).send({ error: 'not found' });

    const now = Date.now();
    const since7 = new Date(now - 7 * DAY);
    const today0 = startOfDay(new Date());
    const [leads, postsTotal] = await Promise.all([
      db.lead.findMany({ where: { searchId: id }, select: { createdAt: true, status: true, section: true } }),
      db.publishedPost.count({ where: { searchId: id, ok: true } }),
    ]);
    const replied = leads.filter((l) => l.status === 'REPLIED').length;

    return {
      kpi: {
        leadsTotal: leads.length,
        leadsToday: leads.filter((l) => l.createdAt >= today0).length,
        leads7: leads.filter((l) => l.createdAt >= since7).length,
        replyRate: leads.length ? Math.round((replied / leads.length) * 100) : 0,
        postsTotal,
      },
      series: buildSeries(leads, 14),
      sections: sectionCounts(leads),
    };
  });
}
