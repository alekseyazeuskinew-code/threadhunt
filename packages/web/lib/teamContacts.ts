// Контакты команды (имя + Telegram) — для быстрой вставки в ответы директа.
// Хранятся JSON-строкой в BrandProfile.teamContacts.
export interface TeamContact {
  name: string;
  telegram: string; // @ник или ссылка
}

export function parseContacts(json?: string): TeamContact[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && typeof c.name === 'string')
      .map((c) => ({ name: String(c.name), telegram: String(c.telegram || '') }))
      .slice(0, 30);
  } catch {
    return [];
  }
}

// Нормализуем Telegram к виду @ник (ссылку оставляем как есть).
export function tgDisplay(t: string): string {
  const v = (t || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return v.startsWith('@') ? v : '@' + v;
}
