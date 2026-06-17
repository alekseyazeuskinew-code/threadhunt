// Короткоживущий тикет для ПРЯМОЙ загрузки файла на бэкенд, минуя прокси фронта.
//
// ЗАЧЕМ: фронт на Netlify проксирует /api/* через свою функцию с лимитом тела ~6 МБ —
// фото/видео туда не пролезают (500). Поэтому файл шлём напрямую на публичный адрес
// бэкенда. Сессионная кука живёт на домене фронта и кросс-доменно не уходит, так что
// прямой запрос аутентифицируем подписанным тикетом: фронт берёт его обычным (мелким)
// JSON-запросом через прокси, а затем прикладывает к прямой загрузке файла.

import crypto from 'node:crypto';
import { env } from './env.js';

const TTL_MS = 10 * 60 * 1000; // тикет действует 10 минут

function sign(data: string): string {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(data).digest('hex');
}

export function makeUploadTicket(userId: string): string {
  const exp = Date.now() + TTL_MS;
  const data = `${userId}.${exp}`;
  return `${data}.${sign(data)}`;
}

export function verifyUploadTicket(ticket: string): string | null {
  const parts = (ticket || '').split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const expected = sign(`${userId}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number(expStr) || Date.now() > Number(expStr)) return null;
  return userId;
}

// Публичный адрес самого бэкенда (для прямой загрузки). Берём из PUBLIC_BASE_URL,
// иначе из RAILWAY_PUBLIC_DOMAIN. Пусто → фронт грузит через относительный /api (dev).
export function publicApiBase(): string {
  const explicit = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (explicit) return explicit;
  const railway = (process.env.RAILWAY_PUBLIC_DOMAIN || '').replace(/\/$/, '');
  return railway ? `https://${railway}` : '';
}
