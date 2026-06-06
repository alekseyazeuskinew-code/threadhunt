// Кому уходит email-цепочка: базовый список (зарегистрированные / лист ожидания)
// + сегмент-фильтры. Один резолвер используется и авторассылкой (drip-планировщик),
// и ручной рассылкой/подсчётом в админке — чтобы «кому отправляется» считалось
// одинаково везде.
import { db } from './db.js';

export interface EmailSegment {
  // Лист ожидания:
  statuses?: string[]; // new | invited | converted (пусто = любой)
  sourceContains?: string; // подстрока в источнике (utm_source/landing/…)
  withPromo?: 'any' | 'with' | 'without'; // выдан ли персональный промокод
  // Зарегистрированные:
  plans?: string[]; // FREE | PRO | VIP (пусто = любой)
  activation?: 'any' | 'connected' | 'not_connected' | 'with_lead' | 'no_lead';
  // Общее:
  signupWithinDays?: number; // только записавшиеся за последние N дней (0/пусто = все)
}

export interface Recipient {
  key: string; // ключ дедупа отправок (id юзера / id заявки)
  email: string;
  createdAt: Date; // якорь для drip
  name?: string | null;
  promoCode?: string | null; // персональный промокод (для подстановки {{promo}})
}

export function parseSegment(raw: string | null | undefined): EmailSegment {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

// Разрешить получателей. opts.createdAfter — нижняя граница (для drip: не слать тем,
// кто появился раньше создания цепочки).
export async function resolveRecipients(audience: string, seg: EmailSegment, opts: { createdAfter?: Date } = {}): Promise<Recipient[]> {
  const gtes: Date[] = [];
  if (opts.createdAfter) gtes.push(opts.createdAfter);
  if (seg.signupWithinDays && seg.signupWithinDays > 0) gtes.push(new Date(Date.now() - seg.signupWithinDays * 86_400_000));
  const createdAtGte = gtes.length ? new Date(Math.max(...gtes.map((d) => d.getTime()))) : null;

  if (audience === 'waitlist') {
    const where: any = {};
    if (createdAtGte) where.createdAt = { gte: createdAtGte };
    if (seg.statuses?.length) where.status = { in: seg.statuses };
    if (seg.sourceContains) where.source = { contains: seg.sourceContains, mode: 'insensitive' };
    if (seg.withPromo === 'with') where.promoCode = { not: null };
    if (seg.withPromo === 'without') where.promoCode = null;
    const rows = await db.waitlistEntry.findMany({ where, select: { id: true, email: true, name: true, promoCode: true, createdAt: true }, take: 5000 });
    return rows.map((r) => ({ key: r.id, email: r.email, createdAt: r.createdAt, name: r.name, promoCode: r.promoCode }));
  }

  // Зарегистрированные пользователи.
  const where: any = {};
  if (createdAtGte) where.createdAt = { gte: createdAtGte };
  if (seg.plans?.length) where.plan = { in: seg.plans };
  const rows = await db.user.findMany({
    where,
    select: { id: true, email: true, name: true, createdAt: true, _count: { select: { devices: true, connections: true, leads: true } } },
    take: 5000,
  });
  const act = seg.activation || 'any';
  const filtered = rows.filter((u) => {
    const connected = u._count.devices + u._count.connections > 0;
    if (act === 'connected') return connected;
    if (act === 'not_connected') return !connected;
    if (act === 'with_lead') return u._count.leads > 0;
    if (act === 'no_lead') return u._count.leads === 0;
    return true;
  });
  return filtered.map((u) => ({ key: u.id, email: u.email, createdAt: u.createdAt, name: u.name }));
}

// ── Mail-merge: подстановка персональных переменных в письмо ──
// Поддерживаемые токены: {{promo}} {{name}} {{email}}
export function applyVars(text: string | undefined | null, vars: Record<string, string>): string {
  if (!text) return text ?? '';
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : ''));
}

// Содержит ли цепочка переменную {{promo}} (чтобы решить, выдавать ли коды на лету).
export function usesPromoVar(steps: { subject?: string; blocks?: any[] }[]): boolean {
  const hay = JSON.stringify(steps || []);
  return /\{\{\s*promo\s*\}\}/.test(hay);
}

// Персонализировать один шаг под получателя (subject + текст/ссылки блоков).
export function personalizeStep(step: { subject?: string; blocks?: any[] }, vars: Record<string, string>): { subject: string; blocks: any[] } {
  const blocks = (step.blocks || []).map((b) => ({
    ...b,
    ...(b?.text !== undefined ? { text: applyVars(b.text, vars) } : {}),
    ...(b?.url !== undefined ? { url: applyVars(b.url, vars) } : {}),
    ...(b?.linkUrl !== undefined ? { linkUrl: applyVars(b.linkUrl, vars) } : {}),
  }));
  return { subject: applyVars(step.subject, vars), blocks };
}

// Человеческое описание сегмента (для подписи «кому уйдёт»).
export function describeSegment(audience: string, seg: EmailSegment): string {
  const parts: string[] = [audience === 'waitlist' ? 'Лист ожидания' : 'Зарегистрированные'];
  if (audience === 'waitlist') {
    if (seg.statuses?.length) parts.push(`статус: ${seg.statuses.join('/')}`);
    if (seg.sourceContains) parts.push(`источник ~ «${seg.sourceContains}»`);
    if (seg.withPromo === 'with') parts.push('с промокодом');
    if (seg.withPromo === 'without') parts.push('без промокода');
  } else {
    if (seg.plans?.length) parts.push(`тариф: ${seg.plans.join('/')}`);
    const actLabels: Record<string, string> = { connected: 'подключили аккаунт', not_connected: 'не подключили', with_lead: 'есть лид', no_lead: 'без лидов' };
    if (seg.activation && seg.activation !== 'any') parts.push(actLabels[seg.activation]);
  }
  if (seg.signupWithinDays && seg.signupWithinDays > 0) parts.push(`за ${seg.signupWithinDays} дн.`);
  return parts.join(' · ');
}
