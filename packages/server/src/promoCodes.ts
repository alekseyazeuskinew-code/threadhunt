// Генерация уникальных промокодов (общий модуль: используется и роутами промокодов,
// и рассылкой писем для подстановки персонального кода {{promo}} каждому получателю).
import { db } from './db.js';

// Алфавит без двусмысленных символов (нет O/0, I/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(prefix = 'TH'): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}-${s}`;
}

export interface CodeOpts {
  percentOff?: number;
  durationMonths?: number;
  campaign?: string;
  issuedToEmail?: string | null;
  expiresAt?: Date | null;
}

// Создать гарантированно уникальный код (с ретраями на коллизии).
export async function createUniqueCode(opts: CodeOpts = {}): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    try {
      await db.promoCode.create({
        data: {
          code,
          percentOff: opts.percentOff ?? 50,
          durationMonths: opts.durationMonths ?? 2,
          maxRedemptions: 1,
          campaign: opts.campaign ?? 'early',
          issuedToEmail: opts.issuedToEmail ?? null,
          expiresAt: opts.expiresAt ?? null,
        },
      });
      return code;
    } catch {
      // коллизия по unique(code) — пробуем ещё раз
    }
  }
  throw new Error('Не удалось сгенерировать уникальный код');
}

// Вернуть персональный код для email (существующий) или выдать новый и привязать
// к заявке листа ожидания. Используется при рассылке с переменной {{promo}}.
export async function ensurePromoForEmail(email: string, opts: CodeOpts = {}): Promise<string> {
  const existing = await db.promoCode.findFirst({ where: { issuedToEmail: email }, orderBy: { createdAt: 'desc' } });
  if (existing) return existing.code;
  const code = await createUniqueCode({ campaign: 'waitlist', ...opts, issuedToEmail: email });
  await db.waitlistEntry.updateMany({ where: { email }, data: { promoCode: code } }).catch(() => {});
  return code;
}
