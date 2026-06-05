// OAuth-хелперы для Threads и Meta (Marketing API): построение URL авторизации,
// обмен code→token, подпись state (привязка колбэка к пользователю без хранилища)
// и разбор signed_request (deauthorize / data-deletion от Meta).
//
// Без App ID/Secret в env флоу не «готов» (см. *OAuthReady) — маршруты отвечают «не настроено».

import crypto from 'node:crypto';
import { env } from './env.js';

const FB = 'https://graph.facebook.com/v21.0';

// ── state: подписанный userId (HMAC на SESSION_SECRET), живёт 10 минут ──
export function signState(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function verifyState(state: string): string | null {
  const [payload, sig] = (state || '').split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() - t > 10 * 60_000) return null;
    return u as string;
  } catch {
    return null;
  }
}

// ── signed_request от Meta: "<base64url sig>.<base64url payload>" ──
export function parseSignedRequest(signed: string, appSecret: string): any | null {
  const [sigB64, payloadB64] = (signed || '').split('.');
  if (!sigB64 || !payloadB64) return null;
  const expected = crypto.createHmac('sha256', appSecret).update(payloadB64).digest();
  const sig = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch {
    return null;
  }
}

// ── Threads OAuth ──
export const threadsOAuthReady = () => !!(env.THREADS_APP_ID && env.THREADS_APP_SECRET && env.THREADS_OAUTH_REDIRECT);

export function threadsAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.THREADS_APP_ID!,
    redirect_uri: env.THREADS_OAUTH_REDIRECT!,
    scope: 'threads_basic,threads_content_publish',
    response_type: 'code',
    state,
  });
  return `https://threads.net/oauth/authorize?${p}`;
}

export async function threadsExchange(code: string): Promise<{ token: string; expiresIn?: number }> {
  const r1 = await fetch('https://graph.threads.net/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.THREADS_APP_ID!,
      client_secret: env.THREADS_APP_SECRET!,
      grant_type: 'authorization_code',
      redirect_uri: env.THREADS_OAUTH_REDIRECT!,
      code,
    }),
  });
  const j1: any = await r1.json();
  if (!r1.ok || !j1.access_token) throw new Error(`threads short token: ${JSON.stringify(j1)}`);
  const short = j1.access_token as string;
  // обмен на долгоживущий (≈60 дней)
  const u = new URL('https://graph.threads.net/access_token');
  u.searchParams.set('grant_type', 'th_exchange_token');
  u.searchParams.set('client_secret', env.THREADS_APP_SECRET!);
  u.searchParams.set('access_token', short);
  const r2 = await fetch(u);
  const j2: any = await r2.json().catch(() => ({}));
  return { token: r2.ok && j2.access_token ? j2.access_token : short, expiresIn: j2.expires_in };
}

// ── Meta (Marketing API) OAuth ──
export const metaOAuthReady = () => !!(env.META_APP_ID && env.META_APP_SECRET && env.META_OAUTH_REDIRECT);

export function metaAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.META_APP_ID!,
    redirect_uri: env.META_OAUTH_REDIRECT!,
    scope: 'ads_management,ads_read,business_management',
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
}

export async function metaExchange(code: string): Promise<string> {
  const u = new URL(`${FB}/oauth/access_token`);
  u.searchParams.set('client_id', env.META_APP_ID!);
  u.searchParams.set('client_secret', env.META_APP_SECRET!);
  u.searchParams.set('redirect_uri', env.META_OAUTH_REDIRECT!);
  u.searchParams.set('code', code);
  const r = await fetch(u);
  const j: any = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`meta token: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

export async function metaMe(token: string): Promise<{ id: string; name?: string } | null> {
  const u = new URL(`${FB}/me`);
  u.searchParams.set('fields', 'id,name');
  u.searchParams.set('access_token', token);
  const r = await fetch(u);
  return r.ok ? ((await r.json()) as any) : null;
}

export async function metaAdAccounts(token: string): Promise<{ account_id: string; name: string }[]> {
  const u = new URL(`${FB}/me/adaccounts`);
  u.searchParams.set('fields', 'account_id,name');
  u.searchParams.set('access_token', token);
  const r = await fetch(u);
  const j: any = await r.json().catch(() => ({}));
  return r.ok && Array.isArray(j.data) ? j.data : [];
}
