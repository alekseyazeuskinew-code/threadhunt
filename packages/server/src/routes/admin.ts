// Админская часть: управление всеми аккаунтами + сводная аналитика.
// Доступ только для пользователей с role === 'ADMIN'.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';
import { today } from '../ai/limits.js';
import { sendEmail, renderEmailHtml } from '../email.js';

const safeParse = (s: string): unknown[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

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

  // Расходники и баланс: реальный расход ИИ (генерации) + грубая оценка стоимости.
  // Балансы внешних провайдеров по API не читаем — на фронте показываем чек-лист
  // сервисов со ссылками на биллинг (пополнять вручную).
  app.get('/api/admin/costs', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const COST_PER_GEN_USD = 0.01; // грубая оценка средней стоимости одной ИИ-генерации
    const dayStr = (d: Date) => d.toISOString().slice(0, 10);
    const since14 = dayStr(new Date(Date.now() - 13 * 86_400_000));
    const since30 = dayStr(new Date(Date.now() - 29 * 86_400_000));

    const [aiTodayAgg, monthRows, allAgg, recentRows] = await Promise.all([
      db.aiUsage.aggregate({ where: { day: today() }, _sum: { count: true } }),
      db.aiUsage.findMany({ where: { day: { gte: since30 } }, select: { count: true } }),
      db.aiUsage.aggregate({ _sum: { count: true } }),
      db.aiUsage.findMany({ where: { day: { gte: since14 } }, select: { day: true, count: true } }),
    ]);

    const aiToday = aiTodayAgg._sum.count || 0;
    const aiMonth = monthRows.reduce((s, r) => s + r.count, 0);
    const aiAll = allAgg._sum.count || 0;

    // серия за 14 дней
    const byDay: Record<string, number> = {};
    for (const r of recentRows) byDay[r.day] = (byDay[r.day] || 0) + r.count;
    const series: { day: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = dayStr(new Date(Date.now() - i * 86_400_000));
      series.push({ day: d.slice(5), count: byDay[d] || 0 });
    }

    return {
      ai: { today: aiToday, month: aiMonth, all: aiAll, estMonthUsd: Math.round(aiMonth * COST_PER_GEN_USD * 100) / 100, costPerGenUsd: COST_PER_GEN_USD },
      series,
    };
  });

  // Рост и здоровье SaaS (актуальный набор: PLG-воронка активации — ведущий
  // индикатор удержания, рост регистраций, активные пользователи, выручка и
  // adoption фич). Всё — обезличенные агрегаты по всему сервису.
  app.get('/api/admin/growth', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const now = Date.now();
    const ago = (days: number) => new Date(now - days * 86_400_000);
    const since8w = ago(56);

    const distinctUsers = async (model: 'device' | 'threadsConnection' | 'search' | 'lead', where: any = {}) =>
      ((await (db as any)[model].findMany({ where, distinct: ['userId'], select: { userId: true } })) as { userId: string }[]).length;

    const [
      totalUsers,
      paying,
      signupRows,
      connectedDev,
      connectedConn,
      withSearch,
      withLead,
      byPlanRaw,
      subsRaw,
      activeDeviceRows,
      activeLeadRows,
      autopostSearches,
      onboardingSearches,
      campaignUserRows,
      leadsByUser,
      hiredByUser,
      usersForEmail,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { plan: { not: 'FREE' } } }),
      db.user.findMany({ where: { createdAt: { gte: since8w } }, select: { createdAt: true } }),
      distinctUsers('device'),
      distinctUsers('threadsConnection'),
      distinctUsers('search'),
      distinctUsers('lead'),
      db.user.groupBy({ by: ['plan'], _count: true }),
      db.subscription.groupBy({ by: ['status'], _count: true }),
      db.device.findMany({ where: { lastHeartbeat: { gte: ago(7) } }, distinct: ['userId'], select: { userId: true } }),
      db.lead.findMany({ where: { createdAt: { gte: ago(7) } }, distinct: ['userId'], select: { userId: true } }),
      db.publishConfig.count({ where: { enabled: true } }),
      db.search.count({ where: { obEnabled: true } }),
      db.adCampaign.findMany({ distinct: ['userId'], select: { userId: true } }),
      db.lead.groupBy({ by: ['userId'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 8 }),
      db.lead.groupBy({ by: ['userId'], where: { stage: 'HIRED' }, _count: { id: true } }),
      db.user.findMany({ select: { id: true, email: true } }),
    ]);

    // активные за 7 дней (WAU): объединение тех, у кого был лид или heartbeat расширения
    const activeSet = new Set<string>([...activeDeviceRows, ...activeLeadRows].map((r) => r.userId));

    // DAU (сутки) и MAU (30 дней) для липкости DAU/MAU
    const [dDev1, dLead1, dDev30, dLead30] = await Promise.all([
      db.device.findMany({ where: { lastHeartbeat: { gte: ago(1) } }, distinct: ['userId'], select: { userId: true } }),
      db.lead.findMany({ where: { createdAt: { gte: ago(1) } }, distinct: ['userId'], select: { userId: true } }),
      db.device.findMany({ where: { lastHeartbeat: { gte: ago(30) } }, distinct: ['userId'], select: { userId: true } }),
      db.lead.findMany({ where: { createdAt: { gte: ago(30) } }, distinct: ['userId'], select: { userId: true } }),
    ]);
    const dau = new Set([...dDev1, ...dLead1].map((r) => r.userId)).size;
    const mau = new Set([...dDev30, ...dLead30].map((r) => r.userId)).size;
    const stickiness = mau ? Math.round((dau / mau) * 100) : 0;

    // регистрации по неделям (8 недель)
    const weeks: { week: string; count: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const start = now - (i + 1) * 7 * 86_400_000;
      const end = now - i * 7 * 86_400_000;
      const count = signupRows.filter((u) => {
        const t = u.createdAt.getTime();
        return t >= start && t < end;
      }).length;
      weeks.push({ week: `${i === 0 ? 'эта' : i} нед.`, count });
    }

    const byPlan: Record<string, number> = { FREE: 0, PRO: 0, VIP: 0 };
    for (const r of byPlanRaw) byPlan[r.plan] = r._count;
    const subs: Record<string, number> = {};
    for (const r of subsRaw) subs[r.status] = r._count;
    const PRICE_RUB: Record<string, number> = { PRO: 1490, VIP: 4900 };
    const mrr = byPlan.PRO * PRICE_RUB.PRO + byPlan.VIP * PRICE_RUB.VIP;

    const emailById = new Map(usersForEmail.map((u) => [u.id, u.email]));
    const hiredMap: Record<string, number> = {};
    for (const r of hiredByUser) hiredMap[r.userId] = r._count.id;
    const powerUsers = leadsByUser.map((r) => ({ email: emailById.get(r.userId) || '—', leads: r._count.id, hired: hiredMap[r.userId] || 0 }));

    return {
      signupsByWeek: weeks,
      activation: {
        total: totalUsers,
        connected: Math.max(connectedDev, connectedConn), // подключил хотя бы один аккаунт
        withSearch,
        withLead,
        paying,
      },
      engagement: { dau, wau: activeSet.size, mau, stickiness },
      revenue: {
        mrr,
        arr: mrr * 12,
        arpu: paying ? Math.round(mrr / paying) : 0,
        payingPct: totalUsers ? Math.round((paying / totalUsers) * 100) : 0,
        churnedSubs: (subs.canceled || 0) + (subs.past_due || 0),
      },
      adoption: {
        autopost: autopostSearches,
        otbivka: connectedDev,
        onboarding: onboardingSearches,
        campaigns: campaignUserRows.length,
      },
      powerUsers,
    };
  });

  // ── Email-цепочки (drip) для новых пользователей ──
  // steps хранятся JSON-строкой; реальная отправка через Resend (когда подключён).
  app.get('/api/admin/email-sequences', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const rows = await db.emailSequence.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ ...r, steps: safeParse(r.steps) }));
  });
  app.post('/api/admin/email-sequences', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const body = (req.body as any) || {};
    const row = await db.emailSequence.create({
      data: { name: (body.name || 'Новая цепочка').slice(0, 120), audience: body.audience === 'waitlist' ? 'waitlist' : 'new_users' },
    });
    return { ...row, steps: safeParse(row.steps) };
  });
  const seqSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    audience: z.enum(['new_users', 'waitlist']).optional(),
    enabled: z.boolean().optional(),
    steps: z.array(z.any()).optional(),
  });
  app.put('/api/admin/email-sequences/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = (req.params as any).id as string;
    const parsed = seqSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const d = parsed.data;
    const row = await db.emailSequence.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.audience !== undefined ? { audience: d.audience } : {}),
        ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
        ...(d.steps !== undefined ? { steps: JSON.stringify(d.steps) } : {}),
      },
    });
    return { ...row, steps: safeParse(row.steps) };
  });
  app.delete('/api/admin/email-sequences/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    await db.emailSequence.delete({ where: { id: (req.params as any).id as string } });
    return { ok: true };
  });

  // Статистика отправок drip-цепочки: сколько писем ушло по каждому шагу.
  app.get('/api/admin/email-sequences/:id/stats', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = (req.params as any).id as string;
    const [rows, started] = await Promise.all([
      db.emailDrip.groupBy({ by: ['stepIndex'], where: { sequenceId: id }, _count: { id: true } }),
      db.emailDrip.findMany({ where: { sequenceId: id }, distinct: ['userId'], select: { userId: true } }),
    ]);
    const perStep: Record<number, number> = {};
    for (const r of rows) perStep[r.stepIndex] = r._count.id;
    return { perStep, started: started.length };
  });

  // Тест-отправка одного письма (рендер блоков → HTML → Resend). По умолчанию — себе.
  app.post('/api/admin/email-test', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const userId = getUserId(app, req)!;
    const body = (req.body as any) || {};
    let to: string | undefined = typeof body.to === 'string' && body.to.includes('@') ? body.to.trim() : undefined;
    if (!to) {
      const me = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
      to = me?.email;
    }
    if (!to) return reply.code(400).send({ error: 'Не указан адрес' });
    const html = renderEmailHtml(Array.isArray(body.blocks) ? body.blocks : []);
    const res = await sendEmail({ to, subject: body.subject || 'Тест Threadhunt', html });
    if (!res.ok) return reply.code(400).send({ error: res.error });
    return { ok: true, to };
  });

  // Рассылка письма по базе: лист ожидания (опц. по статусу) или зарегистрированные.
  app.post('/api/admin/email-broadcast', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const body = (req.body as any) || {};
    const subject = (body.subject || '').toString().slice(0, 200) || 'Threadhunt';
    const blocks = Array.isArray(body.blocks) ? body.blocks : [];
    const audience = body.audience === 'waitlist' ? 'waitlist' : 'new_users';
    let recipients: string[] = [];
    if (audience === 'waitlist') {
      const where = body.status ? { status: String(body.status) } : {};
      const rows = await db.waitlistEntry.findMany({ where, select: { email: true }, take: 2000 });
      recipients = rows.map((r) => r.email);
    } else {
      const rows = await db.user.findMany({ select: { email: true }, take: 2000 });
      recipients = rows.map((r) => r.email);
    }
    recipients = [...new Set(recipients.filter((e) => e && e.includes('@')))];
    if (!recipients.length) return reply.code(400).send({ error: 'В выбранной аудитории нет адресов' });

    const html = renderEmailHtml(blocks);
    let sent = 0;
    let failed = 0;
    // Последовательно, чтобы не упереться в rate-limit Resend (~10/сек).
    for (const to of recipients) {
      const r = await sendEmail({ to, subject, html });
      r.ok ? sent++ : failed++;
    }
    return { ok: true, total: recipients.length, sent, failed };
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
        extraSeats: true,
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
    extraSeats: z.number().int().min(0).max(100).optional(), // выдать доп-места вручную (до Stripe)
  });
  app.patch('/api/admin/users/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = (req.params as any).id as string;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const { plan, role, subStatus, extraSeats } = parsed.data;
    if (plan || role || extraSeats !== undefined)
      await db.user.update({
        where: { id },
        data: { ...(plan ? { plan } : {}), ...(role ? { role } : {}), ...(extraSeats !== undefined ? { extraSeats } : {}) },
      });
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
