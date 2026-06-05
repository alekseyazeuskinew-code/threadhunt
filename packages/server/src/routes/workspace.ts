// Командный доступ: рабочее пространство = аккаунт владельца + приглашённые участники.
// resolveCtx определяет, в чьём пространстве работает текущий пользователь и с какой ролью.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';

export type Role = 'OWNER' | 'MANAGER' | 'VIEWER';
export interface Ctx {
  userId: string;
  ownerId: string; // чьи данные читаем/пишем
  role: Role;
}

// Места по тарифам (включая владельца). FREE — без команды.
const SEATS: Record<string, number> = { FREE: 1, PRO: 3, VIP: 10 };

// Контекст текущего запроса: владелец сам → OWNER; приглашённый → роль из Membership.
export async function resolveCtx(app: FastifyInstance, req: FastifyRequest): Promise<Ctx | null> {
  const userId = getUserId(app, req);
  if (!userId) return null;
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  const m = u
    ? await db.membership.findFirst({ where: { OR: [{ memberId: userId }, { email: u.email }] } })
    : null;
  if (m) {
    if (!m.memberId) await db.membership.update({ where: { id: m.id }, data: { memberId: userId } }).catch(() => {});
    return { userId, ownerId: m.ownerId, role: (m.role as Role) === 'VIEWER' ? 'VIEWER' : 'MANAGER' };
  }
  return { userId, ownerId: userId, role: 'OWNER' };
}

export const canManageLeads = (role: Role) => role === 'OWNER' || role === 'MANAGER';
export const isOwner = (role: Role) => role === 'OWNER';

export async function workspaceRoutes(app: FastifyInstance) {
  // Контекст для UI (кто я в текущем пространстве).
  app.get('/api/workspace', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
    const owner = await db.user.findUnique({
      where: { id: ctx.ownerId },
      select: { email: true, name: true, plan: true, brandProfile: { select: { companyName: true } } },
    });
    return {
      role: ctx.role,
      isMember: ctx.role !== 'OWNER',
      ownerEmail: owner?.email || '',
      company: owner?.brandProfile?.companyName || owner?.name || owner?.email || '',
      plan: owner?.plan || 'FREE',
    };
  });

  // Список участников (только владелец).
  app.get('/api/team', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
    if (!isOwner(ctx.role)) return reply.code(403).send({ error: 'forbidden' });
    const me = await db.user.findUnique({ where: { id: ctx.userId }, select: { plan: true } });
    const members = await db.membership.findMany({ where: { ownerId: ctx.userId }, orderBy: { createdAt: 'asc' } });
    const seats = SEATS[me?.plan || 'FREE'] ?? 1;
    return {
      members: members.map((m) => ({ id: m.id, email: m.email, role: m.role, linked: !!m.memberId, createdAt: m.createdAt })),
      seats, // всего мест включая владельца
      used: members.length + 1, // владелец + участники
    };
  });

  // Пригласить участника.
  app.post('/api/team/invite', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
    if (!isOwner(ctx.role)) return reply.code(403).send({ error: 'forbidden' });
    const parsed = z.object({ email: z.string().email(), role: z.enum(['MANAGER', 'VIEWER']).default('MANAGER') }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Введите корректный email' });

    const me = await db.user.findUnique({ where: { id: ctx.userId }, select: { plan: true, email: true } });
    const seats = SEATS[me?.plan || 'FREE'] ?? 1;
    const count = await db.membership.count({ where: { ownerId: ctx.userId } });
    if (count + 1 >= seats) {
      return reply.code(402).send({ error: `Закончились места (${seats}). Расширь команду на более высоком тарифе.` });
    }
    if (parsed.data.email === me?.email) return reply.code(400).send({ error: 'Это твой аккаунт' });

    const memberUser = await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } });
    const m = await db.membership.upsert({
      where: { ownerId_email: { ownerId: ctx.userId, email: parsed.data.email } },
      create: { ownerId: ctx.userId, email: parsed.data.email, role: parsed.data.role, memberId: memberUser?.id },
      update: { role: parsed.data.role },
    });
    return { id: m.id, email: m.email, role: m.role, linked: !!m.memberId };
  });

  app.patch('/api/team/:id', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx || !isOwner(ctx.role)) return reply.code(403).send({ error: 'forbidden' });
    const id = (req.params as any).id as string;
    const parsed = z.object({ role: z.enum(['MANAGER', 'VIEWER']) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const m = await db.membership.findFirst({ where: { id, ownerId: ctx.userId } });
    if (!m) return reply.code(404).send({ error: 'not found' });
    return db.membership.update({ where: { id }, data: { role: parsed.data.role } });
  });

  app.delete('/api/team/:id', async (req, reply) => {
    const ctx = await resolveCtx(app, req);
    if (!ctx || !isOwner(ctx.role)) return reply.code(403).send({ error: 'forbidden' });
    const id = (req.params as any).id as string;
    const m = await db.membership.findFirst({ where: { id, ownerId: ctx.userId } });
    if (!m) return reply.code(404).send({ error: 'not found' });
    await db.membership.delete({ where: { id } });
    return { ok: true };
  });
}
