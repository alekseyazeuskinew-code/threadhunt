// Исходящий вебхук клиента: новый лид / ответы анкеты POST-ятся на его URL
// (Zapier/Make/n8n → Telegram, Google Sheets, Excel Online и т.п.).
// Никогда не роняет основной флоу: всё в try/catch, с таймаутом. Вызывать без
// await (`void fireWebhook(...)`), кроме теста, где результат нужен пользователю.
import { db } from './db.js';

export async function fireWebhook(userId: string, event: string, data: unknown): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { webhookUrl: true, webhookSecret: true, webhookEvents: true } });
    const url = user?.webhookUrl?.trim();
    if (!url) return { ok: false, error: 'no_webhook' };
    // Фильтр по выбранным событиям: пусто/null → шлём все. 'test' — всегда (кнопка проверки).
    const enabled = (user?.webhookEvents || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (event !== 'test' && enabled.length && !enabled.includes(event)) return { ok: false, error: 'event_disabled' };
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Threadhunt-Event': event };
    if (user?.webhookSecret) headers['X-Threadhunt-Secret'] = user.webhookSecret; // получатель сверяет подпись
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ event, at: new Date().toISOString(), data }),
        signal: ctrl.signal,
      });
      return { ok: res.ok, status: res.status };
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}
