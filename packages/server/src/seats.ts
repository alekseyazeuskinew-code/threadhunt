// Лимит «мест» (аккаунтов) по тарифу + докупленные доп-места.
// ВАЖНО: серверная локальная копия (а не импорт из @threadhunt/shared) — shared
// публикуется как сырой .ts без сборки в dist, и любой РАНТАЙМ-импорт из него
// в скомпилированном сервере падает с ERR_MODULE_NOT_FOUND. Типы из shared
// импортировать можно (стираются при компиляции), значения — нет.

export const PLAN_SEATS: Record<string, number> = { FREE: 1, PRO: 2, VIP: 5 };

export function seatLimit(plan: string, extraSeats = 0): number {
  const base = PLAN_SEATS[plan] ?? PLAN_SEATS.FREE;
  return base + Math.max(0, extraSeats || 0);
}
