// Шифрование токенов клиентов (AES-256-GCM). Токен НИКОГДА не отдаётся в API
// и хранится в БД только в зашифрованном виде. Ключ — в env (в проде из KMS).
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { env } from './env.js';

const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex'); // 32 байта

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // формат: iv.tag.ciphertext (все base64)
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(payload: string): string {
  const [ivB, tagB, dataB] = payload.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}

/** Хеш device-token для хранения (сам токен видит только расширение). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
