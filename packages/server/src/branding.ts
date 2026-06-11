// Вотермарк бесплатного тарифа (как «Powered by ManyChat»): на FREE автоматически
// добавляем приписку к публикуемым постам и авто-ответам в директе. Добавляется
// СЕРВЕРОМ — клиент не может её убрать. На PRO/VIP вотермарка нет.

export function isFreePlan(plan?: string | null): boolean {
  return (plan || 'FREE') === 'FREE';
}

const WATERMARK_POST = '\n\nСделано с помощью Threadhunt';
const WATERMARK_DM = '\n\nОтправлено через Threadhunt';

// Дописать вотермарк к тексту, если тариф FREE (и текст ещё не содержит её).
export function applyPostWatermark(text: string, plan?: string | null): string {
  if (!isFreePlan(plan)) return text;
  if (text.includes('Threadhunt')) return text; // не дублируем
  return (text || '').trimEnd() + WATERMARK_POST;
}

export function applyDmWatermark(text: string, plan?: string | null): string {
  if (!isFreePlan(plan)) return text;
  if (text.includes('Threadhunt')) return text;
  return (text || '').trimEnd() + WATERMARK_DM;
}
