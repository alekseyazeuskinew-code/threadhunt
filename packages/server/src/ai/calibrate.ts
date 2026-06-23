// ИИ-калибровка разметки Threads под конкретного юзера (язык интерфейса/браузер/вёрстка).
// Расширение снимает ВИДИМЫЕ управляющие элементы экрана запроса (только кнопки: текст/aria/
// роль/залитость — БЕЗ текста переписки) и шлёт сюда. Claude по ним определяет, какая кнопка
// «Принять», какая «Показать» (для Скрытых), какая «OK/закрыть инфо-окно», какая «Отклонить».
//
// Зачем: хардкод-эвристики ломаются при смене вёрстки/языка. Калибровка делается РЕДКО
// (при подключении и по кнопке «Перекалибровать»), рантайм работает по результату быстро и
// оффлайн. GRACEFUL: нет ключа/ошибка — возвращаем null, расширение работает на встроенных эвристиках.

import Anthropic from '@anthropic-ai/sdk';
import type { CalibrationConfig } from '@threadhunt/shared';
import { env } from '../env.js';

const MODEL = 'claude-haiku-4-5-20251001';
const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

export interface ControlEl {
  text?: string; // видимая подпись кнопки
  aria?: string; // aria-label / title
  role?: string; // role атрибут
  filled?: boolean; // залита цветом (главная кнопка)
}

const SYS = `Ты помогаешь автоматизации директа Threads определять кнопки интерфейса на ЛЮБОМ языке.
Тебе дают список ВИДИМЫХ кнопок одного экрана «запрос на переписку» (текст/aria/роль/залитость).
Верни СТРОГО JSON без markdown и пояснений, формат:
{"acceptLabels":[],"unhideLabels":[],"dismissLabels":[],"declineLabels":[],"lang":"","notes":""}
Правила:
- acceptLabels — подписи кнопки ПРИНЯТЬ запрос/диалог (напр. Accept, Принять, Kabul et, 承認).
- unhideLabels — ПОКАЗАТЬ скрытое сообщение/переписку, если такая кнопка есть (Show, Показать, Unhide).
- dismissLabels — кнопки закрытия инфо-окна поверх (OK, Понятно, Продолжить, Got it, Continue).
- declineLabels — ОПАСНЫЕ: Отклонить/Удалить/Заблокировать/Decline/Delete/Block — их нельзя нажимать.
- Бери подписи ДОСЛОВНО из входа. Если чего-то нет — пустой массив. lang — язык интерфейса (ru/en/…).`;

export async function calibrateSelectors(controls: ControlEl[], hintLang?: string): Promise<CalibrationConfig | null> {
  if (!client) return null;
  const list = controls
    .slice(0, 40)
    .map((c, i) => `${i + 1}. text=${JSON.stringify((c.text || '').slice(0, 40))} aria=${JSON.stringify((c.aria || '').slice(0, 40))} role=${c.role || ''} filled=${!!c.filled}`)
    .join('\n');
  try {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYS,
      messages: [{ role: 'user', content: `Язык интерфейса (подсказка): ${hintLang || 'неизвестен'}\nКнопки на экране запроса:\n${list}` }],
    });
    const text = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as Partial<CalibrationConfig>;
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim()).slice(0, 20) : []);
    return {
      acceptLabels: arr(parsed.acceptLabels),
      unhideLabels: arr(parsed.unhideLabels),
      dismissLabels: arr(parsed.dismissLabels),
      declineLabels: arr(parsed.declineLabels),
      lang: typeof parsed.lang === 'string' ? parsed.lang.slice(0, 12) : hintLang,
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 200) : undefined,
    };
  } catch {
    return null;
  }
}
