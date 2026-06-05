// Регистрация / вход / выход / текущий пользователь.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { setSession, clearSession, getUserId } from '../auth/session.js';
import { hashToken } from '../crypto.js';
import { randomBytes } from 'node:crypto';
import { sendEmail, renderEmailHtml } from '../email.js';
import { env } from '../env.js';

const creds = z.object({ email: z.string().email(), password: z.string().min(8) });
const signupCreds = creds.extend({ acceptTerms: z.literal(true) });

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/signup', async (req, reply) => {
    const parsed = signupCreds.safeParse(req.body);
    if (!parsed.success) {
      const noTerms = (req.body as any)?.acceptTerms !== true;
      return reply.code(400).send({
        error: noTerms ? 'Нужно принять условия использования' : 'Введите email и пароль (от 8 символов)',
      });
    }
    const { email, password } = parsed.data;
    const exists = await db.user.findUnique({ where: { email } });
    if (exists) return reply.code(409).send({ error: 'Такой email уже зарегистрирован' });
    // Согласие на обезличенную аналитику — необязательное (opt-in), пишем дату если дано.
    const acceptDataUse = (req.body as any)?.acceptDataUse === true;
    const user = await db.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        acceptedTermsAt: new Date(),
        acceptedDataUseAt: acceptDataUse ? new Date() : null,
        subscription: { create: {} },
      },
    });
    setSession(reply, user.id);
    return { id: user.id, email: user.email, plan: user.plan };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = creds.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные данные' });
    const { email, password } = parsed.data;
    const user = await db.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Неверный email или пароль' });
    }
    setSession(reply, user.id);
    return { id: user.id, email: user.email, plan: user.plan };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  // Сменить имя.
  app.patch('/api/auth/profile', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = z.object({ name: z.string().max(80) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const u = await db.user.update({ where: { id: userId }, data: { name: parsed.data.name } });
    return { id: u.id, email: u.email, name: u.name, plan: u.plan };
  });

  // Сменить пароль (с проверкой текущего).
  app.post('/api/auth/change-password', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Новый пароль — от 8 символов' });
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return reply.code(403).send({ error: 'Текущий пароль неверный' });
    }
    await db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(parsed.data.newPassword), resetTokenHash: null, resetTokenExpiresAt: null },
    });
    return { ok: true };
  });

  // ── Сброс пароля по email ──
  // forgot: всегда отвечаем ok (не раскрываем, есть ли аккаунт). Если есть —
  // создаём одноразовый токен (хеш в БД), шлём ссылку. Без RESEND_API_KEY письмо
  // не уйдёт, но эндпоинт не падает.
  app.post('/api/auth/forgot', async (req, reply) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Введите корректный email' });
    const user = await db.user.findUnique({ where: { email: parsed.data.email } });
    if (user) {
      const token = randomBytes(32).toString('hex');
      await db.user.update({
        where: { id: user.id },
        data: { resetTokenHash: hashToken(token), resetTokenExpiresAt: new Date(Date.now() + 60 * 60_000) }, // 1 час
      });
      const link = `${env.WEB_ORIGIN}/reset?token=${token}`;
      // НЕ блокируем ответ отправкой письма — иначе по времени ответа можно
      // отличить существующий email от несуществующего (enumeration).
      void sendEmail({
        to: user.email,
        subject: 'Сброс пароля — Threadhunt',
        html: renderEmailHtml([
          { type: 'heading', text: 'Сброс пароля', align: 'left' },
          { type: 'text', text: 'Ты запросил сброс пароля в Threadhunt. Ссылка действует 1 час. Если это не ты — просто проигнорируй письмо.', align: 'left' },
          { type: 'button', text: 'Задать новый пароль', url: link, align: 'left' },
        ]),
      });
    }
    return { ok: true };
  });

  app.post('/api/auth/reset', async (req, reply) => {
    const parsed = z.object({ token: z.string().min(10), newPassword: z.string().min(8) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Пароль — от 8 символов' });
    const user = await db.user.findFirst({
      where: { resetTokenHash: hashToken(parsed.data.token), resetTokenExpiresAt: { gt: new Date() } },
    });
    if (!user) return reply.code(400).send({ error: 'Ссылка недействительна или устарела. Запроси сброс заново.' });
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsed.data.newPassword), resetTokenHash: null, resetTokenExpiresAt: null },
    });
    setSession(reply, user.id); // сразу залогинен
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, plan: true, role: true },
    });
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return user;
  });
}
