// Привязка Telegram-аккаунта и приём апдейтов от бота (webhook).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { env } from '../env.js';
import { getUserId } from '../auth/session.js';
import { tgEnabled, getBotUsername, tgSend, esc } from '../telegram.js';

export async function telegramRoutes(app: FastifyInstance) {
  // Статус привязки + имя бота + настройки уведомлений.
  app.get('/api/telegram/status', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const u = await db.user.findUnique({ where: { id: userId }, select: { telegramChatId: true, tgNotifyLeads: true, tgNotifyTests: true, tgDailySummary: true } });
    return {
      enabled: tgEnabled(),
      connected: !!u?.telegramChatId,
      botUsername: await getBotUsername(),
      prefs: { notifyLeads: u?.tgNotifyLeads ?? true, notifyTests: u?.tgNotifyTests ?? true, dailySummary: u?.tgDailySummary ?? true },
    };
  });

  // Сгенерировать deep-link для привязки (/start <token>).
  app.post('/api/telegram/link', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    if (!tgEnabled()) return reply.code(400).send({ error: 'Бот не настроен (нет TELEGRAM_BOT_TOKEN)' });
    const username = await getBotUsername();
    if (!username) return reply.code(400).send({ error: 'Не удалось получить имя бота' });
    const token = 'lk_' + randomBytes(12).toString('hex');
    await db.user.update({ where: { id: userId }, data: { telegramLinkToken: token } });
    return { url: `https://t.me/${username}?start=${token}` };
  });

  // Отвязать.
  app.post('/api/telegram/unlink', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    await db.user.update({ where: { id: userId }, data: { telegramChatId: null, telegramLinkToken: null } });
    return { ok: true };
  });

  // Тестовое сообщение.
  app.post('/api/telegram/test', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const u = await db.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
    if (!u?.telegramChatId) return reply.code(400).send({ error: 'Telegram не привязан' });
    const ok = await tgSend(u.telegramChatId, '✅ <b>Threadhunt</b> подключён. Сюда будут приходить уведомления и сводки по кандидатам.');
    return { ok };
  });

  // Настройки уведомлений.
  const prefsSchema = z.object({ notifyLeads: z.boolean().optional(), notifyTests: z.boolean().optional(), dailySummary: z.boolean().optional() });
  app.patch('/api/telegram/prefs', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = prefsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const d = parsed.data;
    await db.user.update({
      where: { id: userId },
      data: {
        ...(d.notifyLeads !== undefined ? { tgNotifyLeads: d.notifyLeads } : {}),
        ...(d.notifyTests !== undefined ? { tgNotifyTests: d.notifyTests } : {}),
        ...(d.dailySummary !== undefined ? { tgDailySummary: d.dailySummary } : {}),
      },
    });
    return { ok: true };
  });

  // Webhook от Telegram. Секрет в пути (его знает только Telegram через setWebhook).
  app.post('/api/telegram/webhook/:secret', async (req, reply) => {
    const secret = (req.params as any).secret as string;
    if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) return reply.code(404).send({ error: 'not found' });
    const update = req.body as any;
    const msg = update?.message;
    const text: string = msg?.text || '';
    const chatId = msg?.chat?.id;
    if (chatId && text.startsWith('/start')) {
      const token = text.split(/\s+/)[1] || '';
      if (token) {
        const user = await db.user.findUnique({ where: { telegramLinkToken: token }, select: { id: true } });
        if (user) {
          await db.user.update({ where: { id: user.id }, data: { telegramChatId: String(chatId), telegramLinkToken: null } });
          await tgSend(String(chatId), '✅ Аккаунт <b>Threadhunt</b> привязан! Буду присылать уведомления о кандидатах и ежедневную сводку.');
        } else {
          await tgSend(String(chatId), 'Ссылка устарела. Сгенерируй новую в дашборде Threadhunt → Настройки → Telegram.');
        }
      } else {
        await tgSend(String(chatId), 'Привет! Чтобы привязать аккаунт, открой Threadhunt → Настройки → Telegram → «Подключить».');
      }
    }
    return reply.send({ ok: true });
  });
}

// Удобный нотификатор: шлёт владельцу пространства, если бот привязан и тип включён.
export async function notifyOwner(userId: string, kind: 'lead' | 'test', text: string): Promise<void> {
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { telegramChatId: true, tgNotifyLeads: true, tgNotifyTests: true } });
    if (!u?.telegramChatId) return;
    if (kind === 'lead' && !u.tgNotifyLeads) return;
    if (kind === 'test' && !u.tgNotifyTests) return;
    await tgSend(u.telegramChatId, text);
  } catch {
    /* ignore */
  }
}

export { esc };
