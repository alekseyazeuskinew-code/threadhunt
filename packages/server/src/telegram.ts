// Telegram-бот: один бот на платформу. Пользователи привязывают аккаунт через
// deep-link (/start <token>), бот шлёт сводки и важные уведомления на их chatId.
import { env } from './env.js';

const API = (method: string) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

export function tgEnabled(): boolean {
  return !!env.TELEGRAM_BOT_TOKEN;
}

let cachedUsername: string | null = null;
export async function getBotUsername(): Promise<string | null> {
  if (!tgEnabled()) return null;
  if (cachedUsername) return cachedUsername;
  try {
    const r = await fetch(API('getMe'));
    const j: any = await r.json();
    cachedUsername = j?.result?.username || null;
    return cachedUsername;
  } catch {
    return null;
  }
}

// Отправить сообщение в чат. HTML-разметка, без превью ссылок. Best-effort (не кидает).
export async function tgSend(chatId: string, text: string): Promise<boolean> {
  if (!tgEnabled() || !chatId) return false;
  try {
    const r = await fetch(API('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
