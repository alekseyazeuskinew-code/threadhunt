// Лимит подключённых аккаунтов («мест») по тарифу + платные доп-места.
// «Место» = один подключённый браузер (Device), ведущий отбивку под отдельным
// Threads-аккаунтом. Доп-места сверх тарифа — апселл (оплата через Stripe позже,
// пока доп-места выдаёт админ вручную через extraSeats).
//
// Общий модуль: одинаково используют сервер (enforcement) и веб (UI/апселл).

export type PlanKey = 'FREE' | 'PRO' | 'VIP';

/** Сколько аккаунтов («мест») включено в тариф по умолчанию. */
export const PLAN_SEATS: Record<PlanKey, number> = {
  FREE: 1,
  PRO: 2,
  VIP: 5,
};

/** Итоговый лимит мест: включённые в тариф + докупленные доп-места. */
export function seatLimit(plan: string, extraSeats = 0): number {
  const base = PLAN_SEATS[(plan as PlanKey)] ?? PLAN_SEATS.FREE;
  return base + Math.max(0, extraSeats || 0);
}
