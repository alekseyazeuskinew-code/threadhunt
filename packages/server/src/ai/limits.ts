// Дневные лимиты ИИ-генераций по тарифам (защита бюджета владельца).
export const AI_DAILY_LIMIT: Record<string, number> = {
  FREE: 0,
  PRO: 30,
  VIP: 200,
};

export function aiLimitFor(plan: string | undefined): number {
  return AI_DAILY_LIMIT[plan || 'FREE'] ?? 0;
}

export const today = () => new Date().toISOString().slice(0, 10);
