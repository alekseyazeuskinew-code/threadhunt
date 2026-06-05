// Админская часть: управление всеми аккаунтами + сводная аналитика.
// Доступ только для пользователей с role === 'ADMIN'.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';
import { today } from '../ai/limits.js';

export async function adminRoutes(app: FastifyInstance) {
  // Гард: вернуть userId, только если это админ.
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

  // Сводная аналитика по всему сервису.
  app.get('/api/admin/stats', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const [users, new7, searches, leads, posts, byPlanRaw, aiToday, subsRaw] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: since7 } } }),
      db.search.count(),
      db.lead.count(),
      db.publishedPost.count({ where: { ok: true } }),
      db.user.groupBy({ by: ['plan'], _count: true }),
      db.aiUsage.aggregate({ where: { day: today() }, _sum: { count: true } }),
      db.subscription.groupBy({ by: ['status'], _count: true }),
    ]);
    const byPlan: Record<string, number> = { FREE: 0, PRO: 0, VIP: 0 };
    for (const r of byPlanRaw) byPlan[r.plan] = r._count;
    const subs: Record<string, number> = {};
    for (const r of subsRaw) subs[r.status] = r._count;

    // Оценка выручки по тарифам (₽/мес). Реальные суммы появятся со Stripe.
    const PRICE_RUB: Record<string, number> = { PRO: 1490, VIP: 4900 };
    const mrr = byPlan.PRO * PRICE_RUB.PRO + byPlan.VIP * PRICE_RUB.VIP;
    const payingUsers = byPlan.PRO + byPlan.VIP;

    return { users, new7, searches, leads, posts, byPlan, aiToday: aiToday._sum.count || 0, subs, mrr, payingUsers };
  });

  // Аналитика найма по всему сервису: воронка стадий, конверсии по профессиям
  // (= названию поиска), откуда приходят лиды и грубая отдача постов. Источник —
  // обезличенные агрегаты (без персональных данных кандидатов).
  app.get('/api/admin/analytics', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const [funnelRaw, sectionRaw, leadsBySearch, hiredBySearch, searches, totalLeads, totalHired, totalPosts] = await Promise.all([
      db.lead.groupBy({ by: ['stage'], _count: true }),
      db.lead.groupBy({ by: ['section'], _count: true }),
      db.lead.groupBy({ by: ['searchId'], _count: true }),
      db.lead.groupBy({ by: ['searchId'], where: { stage: 'HIRED' }, _count: true }),
      db.search.findMany({ select: { id: true, title: true } }),
      db.lead.count(),
      db.lead.count({ where: { stage: 'HIRED' } }),
      db.publishedPost.count({ where: { ok: true } }),
    ]);

    const funnel: Record<string, number> = { NEW: 0, CONTACTED: 0, SCREENING: 0, HIRED: 0, BENCH: 0, REJECTED: 0 };
    for (const r of funnelRaw) funnel[r.stage] = (funnel[r.stage] || 0) + r._count;

    const bySection: Record<string, number> = {};
    for (const r of sectionRaw) {
      const k = r.section || 'main';
      bySection[k] = (bySection[k] || 0) + r._count;
    }

    const titleById = new Map(searches.map((s) => [s.id, (s.title || '—').trim() || '—']));
    const leadsByTitle: Record<string, number> = {};
    const hiredByTitle: Record<string, number> = {};
    for (const r of leadsBySearch) {
      const t = titleById.get(r.searchId) || '—';
      leadsByTitle[t] = (leadsByTitle[t] || 0) + r._count;
    }
    for (const r of hiredBySearch) {
      const t = titleById.get(r.searchId) || '—';
      hiredByTitle[t] = (hiredByTitle[t] || 0) + r._count;
    }
    const byProfession = Object.entries(leadsByTitle)
      .map(([title, leads]) => ({ title, leads, hired: hiredByTitle[title] || 0, conv: leads ? Math.round(((hiredByTitle[title] || 0) / leads) * 100) : 0 }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 12);

    return {
      totalLeads,
      totalHired,
      convToHire: totalLeads ? Math.round((totalHired / totalLeads) * 100) : 0,
      totalPosts,
      leadsPerPost: totalPosts ? Math.round((totalLeads / totalPosts) * 10) / 10 : 0,
      funnel,
      bySection,
      byProfession,
    };
  });

  // Все зарегистрированные аккаунты со статистикой.
  app.get('/api/admin/users', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const users = await db.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        role: true,
        createdAt: true,
        _count: { select: { searches: true, leads: true, connections: true, devices: true } },
        subscription: { select: { status: true, currentPeriodEnd: true } },
      },
      take: 500,
    });
    return users;
  });

  // Управление аккаунтом: тариф / роль / статус подписки.
  const patchSchema = z.object({
    plan: z.enum(['FREE', 'PRO', 'VIP']).optional(),
    role: z.enum(['USER', 'ADMIN']).optional(),
    subStatus: z.enum(['active', 'past_due', 'canceled', 'paused', 'inactive']).optional(),
  });
  app.patch('/api/admin/users/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = (req.params as any).id as string;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const { plan, role, subStatus } = parsed.data;
    if (plan || role) await db.user.update({ where: { id }, data: { ...(plan ? { plan } : {}), ...(role ? { role } : {}) } });
    if (subStatus) {
      await db.subscription.upsert({
        where: { userId: id },
        create: { userId: id, status: subStatus, plan: plan || 'FREE' },
        update: { status: subStatus },
      });
    }
    return { ok: true };
  });
}
