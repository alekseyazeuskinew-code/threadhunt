// Объявления основателя → пользователям. Пользователь видит список и счётчик
// непрочитанных (по User.lastSeenAnnouncementAt); основатель (ADMIN) публикует.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';

export async function announcementRoutes(app: FastifyInstance) {
  const requireUser = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return userId;
  };
  async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    const me = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (me?.role !== 'ADMIN') {
      reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return userId;
  }

  // Список объявлений + счётчик непрочитанных для текущего пользователя.
  app.get('/api/announcements', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const [user, items] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { lastSeenAnnouncementAt: true } }),
      db.announcement.findMany({ where: { published: true }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    const seenAt = user?.lastSeenAnnouncementAt ? new Date(user.lastSeenAnnouncementAt).getTime() : 0;
    const unread = items.filter((a) => new Date(a.createdAt).getTime() > seenAt).length;
    return { items, unread };
  });

  // Отметить всё прочитанным (открыл колокольчик).
  app.post('/api/announcements/seen', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    await db.user.update({ where: { id: userId }, data: { lastSeenAnnouncementAt: new Date() } });
    return { ok: true };
  });

  // ── Админка: публикация/удаление ──
  const createSchema = z.object({
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(4000),
    level: z.enum(['info', 'update', 'important']).default('info'),
  });
  app.post('/api/admin/announcements', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'bad request' });
    return db.announcement.create({ data: parsed.data });
  });
  app.get('/api/admin/announcements', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return db.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  });
  app.delete('/api/admin/announcements/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = (req.params as any).id as string;
    await db.announcement.delete({ where: { id } }).catch(() => {});
    return { ok: true };
  });
}
