// Исходящий вебхук клиента: новый лид / ответы анкеты POST-ятся на его URL
// (Zapier/Make/n8n → Telegram, Google Sheets, Excel Online и т.п.).
// Никогда не роняет основной флоу: всё в try/catch, с таймаутом. Вызывать без
// await (`void fireWebhook(...)`), кроме теста, где результат нужен пользователю.
import { db } from './db.js';

export async function fireWebhook(userId: string, event: string, data: unknown): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { webhookUrl: true } });
    const url = user?.webhookUrl?.trim();
    if (!url) return { ok: false, error: 'no_webhook' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Threadhunt-Event': event },
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
