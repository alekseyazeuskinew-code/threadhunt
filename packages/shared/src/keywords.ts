// Чистая логика матча кодовых слов. Перенос из прототипа (bot.js),
// без побочных эффектов — поэтому её используют и сервер (валидация),
// и расширение (реальный матч в директе).

/** Нормализация: нижний регистр + «ё» → «е». */
export function normalize(text: string): string {
  return (text || '').toLowerCase().replace(/ё/g, 'е');
}

/** Режим совпадения кодового слова. */
export type MatchMode =
  | 'root' // вхождение корня: «дизайн» ловит «дизайнер», «веб-дизайн» (как в прототипе)
  | 'word' // слово целиком (по границам), меньше ложных срабатываний
  | 'exact'; // полное совпадение всего текста

export interface Keyword {
  text: string;
  mode?: MatchMode;
}

/**
 * Ищет ПЕРВОЕ совпавшее кодовое слово внутри текста.
 * Возвращает сам keyword.text или null.
 * Порядок важен: при нескольких совпадениях берём первое по списку.
 */
export function matchKeyword(text: string, keywords: Keyword[]): string | null {
  const norm = normalize(text);
  for (const kw of keywords) {
    const needle = normalize(kw.text);
    if (!needle) continue;
    const mode = kw.mode ?? 'root';
    if (mode === 'root' && norm.includes(needle)) return kw.text;
    if (mode === 'exact' && norm.trim() === needle.trim()) return kw.text;
    if (mode === 'word') {
      // граница слова с поддержкой кириллицы (\b не работает с не-латиницей)
      const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-zа-я0-9_])${esc}([^a-zа-я0-9_]|$)`, 'i');
      if (re.test(norm)) return kw.text;
    }
  }
  return null;
}
