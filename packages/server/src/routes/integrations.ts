// Интеграции аккаунта: исходящий вебхук (новый лид / ответы анкеты уходят на
// URL клиента). Через него подключаются Zapier/Make/n8n → Telegram, Google
// Sheets, Excel Online и др. — данные «живут» в инструментах клиента.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';
import { fireWebhook } from '../webhook.js';

export async function integrationRoutes(app: FastifyInstance) {
  const requireUser = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return userId;
  };

  app.get('/api/integrations', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const user = await db.user.findUnique({ where: { id: userId }, select: { webhookUrl: true, webhookSecret: true, webhookEvents: true } });
    return {
      webhookUrl: user?.webhookUrl || '',
      webhookSecret: user?.webhookSecret || '',
      webhookEvents: (user?.webhookEvents || '').split(',').map((s) => s.trim()).filter(Boolean),
    };
  });

  const ALL_EVENTS = ['lead.created', 'candidate.response', 'candidate.completed'];
  const schema = z.object({
    webhookUrl: z.string().url().or(z.literal('')),
    webhookSecret: z.string().max(200).optional(),
    webhookEvents: z.array(z.enum(['lead.created', 'candidate.response', 'candidate.completed'])).optional(),
  });
  app.patch('/api/integrations', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажите корректный URL (https://…) или оставьте пустым' });
    // пусто или все события выбраны → храним null (= слать все)
    const ev = parsed.data.webhookEvents;
    const events = ev && ev.length && ev.length < ALL_EVENTS.length ? ev.join(',') : null;
    await db.user.update({
      where: { id: userId },
      data: {
        webhookUrl: parsed.data.webhookUrl || null,
        webhookSecret: (parsed.data.webhookSecret || '').trim() || null,
        webhookEvents: events,
      },
    });
    return { ok: true };
  });

  // Тест: шлём пробное событие и возвращаем результат доставки.
  app.post('/api/integrations/test', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const res = await fireWebhook(userId, 'test', { message: 'Тестовое событие Threadhunt' });
    if (!res.ok) return reply.code(400).send({ error: res.error === 'no_webhook' ? 'Сначала сохраните URL вебхука' : `Не доставлено: ${res.error || 'HTTP ' + res.status}` });
    return { ok: true, status: res.status };
  });
}
