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
