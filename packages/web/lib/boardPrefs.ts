// Пользовательские настройки канбан-доски кандидатов (в localStorage, на устройство).
// Меняем ТОЛЬКО отображение: порядок/названия/видимость колонок и состав полей на
// карточке. Ключи стадий (NEW…REJECTED) остаются прежними — на них завязаны
// автоматизация (дедлайны тестов, онбординг) и аналитика, поэтому их не ломаем.
import type { Stage } from './types';

export type CardField = 'vacancy' | 'rating' | 'testStatus' | 'comments' | 'contact' | 'role' | 'rate' | 'created' | 'keyword' | 'section' | 'onboarding';

export interface BoardPrefs {
  order: Stage[]; // порядок колонок
  labels: Partial<Record<Stage, string>>; // кастомные названия колонок
  hidden: Stage[]; // скрытые колонки
  cardFields: CardField[]; // какие строки показывать на карточке
}

export const ALL_STAGES: Stage[] = ['NEW', 'CONTACTED', 'SCREENING', 'HIRED', 'BENCH', 'REJECTED'];

export const DEFAULT_PREFS: BoardPrefs = {
  order: [...ALL_STAGES],
  labels: {},
  hidden: [],
  cardFields: ['vacancy', 'onboarding', 'rating', 'testStatus', 'comments'],
};

export const CARD_FIELDS: { key: CardField; label: string }[] = [
  { key: 'vacancy', label: 'Вакансия' },
  { key: 'rating', label: 'Рейтинг' },
  { key: 'testStatus', label: 'Статус теста' },
  { key: 'onboarding', label: 'Прогресс анкеты' },
  { key: 'comments', label: 'Кол-во заметок' },
  { key: 'contact', label: 'Контакт' },
  { key: 'role', label: 'Роль (при найме)' },
  { key: 'rate', label: 'Ставка' },
  { key: 'keyword', label: 'Кодовое слово' },
  { key: 'section', label: 'Раздел директа' },
  { key: 'created', label: 'Дата появления' },
];

const KEY = 'th_board_prefs_v1';

// Гарантируем, что order содержит ВСЕ стадии (недостающие добавляем в конец) —
// иначе лид в «пропавшей» колонке стал бы невидимым.
function normalizeOrder(order: Stage[] | undefined): Stage[] {
  const seen = new Set<Stage>();
  const out: Stage[] = [];
  for (const s of order || []) if (ALL_STAGES.includes(s) && !seen.has(s)) (seen.add(s), out.push(s));
  for (const s of ALL_STAGES) if (!seen.has(s)) out.push(s);
  return out;
}

export function loadPrefs(): BoardPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as BoardPrefs;
    return {
      order: normalizeOrder(p.order),
      labels: p.labels && typeof p.labels === 'object' ? p.labels : {},
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((s) => ALL_STAGES.includes(s)) : [],
      cardFields: Array.isArray(p.cardFields) ? p.cardFields : DEFAULT_PREFS.cardFields,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: BoardPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
