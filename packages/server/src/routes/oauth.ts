// OAuth-флоу подключения Threads и Meta (Marketing API) + обязательные для Meta
// колбэки deauthorize / data-deletion. Пока App ID/Secret не заданы в env — старт
// аккуратно редиректит на /connections?…=unconfigured (ручной токен остаётся фолбэком).

import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { env } from '../env.js';
import { encrypt } from '../crypto.js';
import { getUserId } from '../auth/session.js';
import { whoami } from '../threads/publisher.js';
import * as oauth from '../oauth.js';

const WEB = env.WEB_ORIGIN;

export async function oauthRoutes(app: FastifyInstance) {
  // ── Threads: старт (редирект — для прямого захода на сервер) ──
  app.get('/api/threads/oauth/start', (req, reply) => {
    const uid = getUserId(app, req);
    if (!uid) return reply.redirect(`${WEB}/login`);
    if (!oauth.threadsOAuthReady()) return reply.redirect(`${WEB}/connections?threads=unconfigured`);
    return reply.redirect(oauth.threadsAuthUrl(oauth.signState(uid)));
  });

  // ── Threads: URL авторизации как JSON ──
  // Фронт на Netlify зовёт это через прокси (cookie доходит), получает готовый
  // URL и сам уводит браузер на threads.net. Так нет внешнего 302 через прокси
  // (Netlify отдаёт на него «upstream error»).
  app.get('/api/threads/oauth/url', (req, reply) => {
    const uid = getUserId(app, req);
    if (!uid) return reply.code(401).send({ error: 'unauthorized' });
    if (!oauth.threadsOAuthReady()) return reply.send({ url: null, unconfigured: true });
    return reply.send({ url: oauth.threadsAuthUrl(oauth.signState(uid)) });
  });

  // ── Threads: колбэк ──
  app.get('/api/threads/callback', async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string>;
    if (error || !code) return reply.redirect(`${WEB}/connections?threads=error`);
    const uid = oauth.verifyState(state);
    if (!uid) return reply.redirect(`${WEB}/connections?threads=error`);
    try {
      const { token, expiresIn } = await oauth.threadsExchange(code);
      const me: any = await whoami(token);
      const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
      await db.threadsConnection.upsert({
        where: { userId_threadsUserId: { userId: uid, threadsUserId: me.id } },
        create: { userId: uid, threadsUserId: me.id, username: me.username || '', accessTokenEnc: encrypt(token), tokenExpiresAt },
        update: { username: me.username || '', accessTokenEnc: encrypt(token), tokenExpiresAt },
      });
      return reply.redirect(`${WEB}/connections?threads=connected`);
    } catch {
      return reply.redirect(`${WEB}/connections?threads=error`);
    }
  });

  // ── Meta (Ads): старт ──
  app.get('/api/meta/oauth/start', (req, reply) => {
    const uid = getUserId(app, req);
    if (!uid) return reply.redirect(`${WEB}/login`);
    if (!oauth.metaOAuthReady()) return reply.redirect(`${WEB}/connections?meta=unconfigured`);
    return reply.redirect(oauth.metaAuthUrl(oauth.signState(uid)));
  });

  // ── Meta (Ads): URL авторизации как JSON (см. комментарий у threads/oauth/url) ──
  app.get('/api/meta/oauth/url', (req, reply) => {
    const uid = getUserId(app, req);
    if (!uid) return reply.code(401).send({ error: 'unauthorized' });
    if (!oauth.metaOAuthReady()) return reply.send({ url: null, unconfigured: true });
    return reply.send({ url: oauth.metaAuthUrl(oauth.signState(uid)) });
  });

  // ── Meta (Ads): колбэк ──
  app.get('/api/meta/callback', async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string>;
    if (error || !code) return reply.redirect(`${WEB}/connections?meta=error`);
    const uid = oauth.verifyState(state);
    if (!uid) return reply.redirect(`${WEB}/connections?meta=error`);
    try {
      const token = await oauth.metaExchange(code);
      const [me, accts] = await Promise.all([oauth.metaMe(token), oauth.metaAdAccounts(token)]);
      const first = accts[0];
      await db.metaConnection.upsert({
        where: { userId: uid },
        create: {
          userId: uid,
          adAccountId: first ? `act_${first.account_id}` : '',
          businessName: first?.name || me?.name || '',
          metaUserId: me?.id || null,
          accessTokenEnc: encrypt(token),
          status: 'active',
        },
        update: {
          adAccountId: first ? `act_${first.account_id}` : undefined,
          businessName: first?.name || me?.name || '',
          metaUserId: me?.id || null,
          accessTokenEnc: encrypt(token),
          status: 'active',
        },
      });
      return reply.redirect(`${WEB}/connections?meta=connected`);
    } catch {
      return reply.redirect(`${WEB}/connections?meta=error`);
    }
  });

  // ── Колбэки, обязательные для Meta App Review ──
  // Meta дёргает их при отзыве доступа и при запросе удаления данных (POST signed_request).
  app.post('/api/meta/deauthorize', async (req, reply) => {
    const signed = (req.body as any)?.signed_request as string | undefined;
    if (env.META_APP_SECRET && signed) {
      const data = oauth.parseSignedRequest(signed, env.META_APP_SECRET);
      if (data?.user_id) await db.metaConnection.deleteMany({ where: { metaUserId: String(data.user_id) } });
    }
    return reply.send({ ok: true });
  });

  app.post('/api/meta/data-deletion', async (req, reply) => {
    const signed = (req.body as any)?.signed_request as string | undefined;
    if (env.META_APP_SECRET && signed) {
      const data = oauth.parseSignedRequest(signed, env.META_APP_SECRET);
      if (data?.user_id) await db.metaConnection.deleteMany({ where: { metaUserId: String(data.user_id) } });
    }
    const code = 'del_' + Date.now().toString(36);
    return reply.send({ url: `${WEB}/privacy?deletion=${code}`, confirmation_code: code });
  });

  // Те же колбэки для приложения Threads (часто отдельный App Secret).
  app.post('/api/threads/deauthorize', async (req, reply) => {
    const signed = (req.body as any)?.signed_request as string | undefined;
    const secret = env.THREADS_APP_SECRET;
    if (secret && signed) {
      const data = oauth.parseSignedRequest(signed, secret);
      if (data?.user_id) await db.threadsConnection.deleteMany({ where: { threadsUserId: String(data.user_id) } });
    }
    return reply.send({ ok: true });
  });

  app.post('/api/threads/data-deletion', async (req, reply) => {
    const signed = (req.body as any)?.signed_request as string | undefined;
    const secret = env.THREADS_APP_SECRET;
    if (secret && signed) {
      const data = oauth.parseSignedRequest(signed, secret);
      if (data?.user_id) await db.threadsConnection.deleteMany({ where: { threadsUserId: String(data.user_id) } });
    }
    const code = 'del_' + Date.now().toString(36);
    return reply.send({ url: `${WEB}/privacy?deletion=${code}`, confirmation_code: code });
  });
}
