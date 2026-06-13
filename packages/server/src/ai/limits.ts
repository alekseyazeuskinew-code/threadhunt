// Дневные лимиты ИИ-генераций по тарифам (защита бюджета владельца).
export const AI_DAILY_LIMIT: Record<string, number> = {
  FREE: 5, // «попробовать» — затем мотивируем перейти на Pro
  PRO: 100,
  VIP: 500,
};

export function aiLimitFor(plan: string | undefined): number {
  return AI_DAILY_LIMIT[plan || 'FREE'] ?? 0;
}

export const today = () => new Date().toISOString().slice(0, 10);
