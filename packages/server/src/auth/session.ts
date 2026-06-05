// Сессия — подписанная httpOnly-cookie с userId (целостность через @fastify/cookie).
import type { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify';

const COOKIE = 'th_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

export function setSession(reply: FastifyReply, userId: string) {
  reply.setCookie(COOKIE, userId, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: '/' });
}

// Достаёт userId из подписанной cookie (или null).
export function getUserId(app: FastifyInstance, req: FastifyRequest): string | null {
  const raw = req.cookies[COOKIE];
  if (!raw) return null;
  const res = app.unsignCookie(raw);
  return res.valid ? res.value : null;
}

// preHandler: требует авторизацию, иначе 401.
export function requireAuth(app: FastifyInstance) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    (req as any).userId = userId;
  };
}
