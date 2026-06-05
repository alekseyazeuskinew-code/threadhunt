import type { Stage } from './types';

// Стадии пайплайна найма. «Резерв» (BENCH) — намеренно отдельная стадия:
// тёплые проверенные кандидаты, которых держим про запас. Это и философия
// (всегда держи входящий поток подрядчиков), и механика удержания в сервисе.
export const STAGES: { key: Stage; label: string; tone: string }[] = [
  { key: 'NEW', label: 'Новый', tone: 'text-muted' },
  { key: 'CONTACTED', label: 'На связи', tone: 'text-text' },
  { key: 'SCREENING', label: 'Тест / собес', tone: 'text-warning' },
  { key: 'HIRED', label: 'В команде', tone: 'text-success' },
  { key: 'BENCH', label: 'Резерв', tone: 'text-accent' },
  { key: 'REJECTED', label: 'Отказ', tone: 'text-danger' },
];

export const stageLabel = (s: string) => STAGES.find((x) => x.key === s)?.label ?? s;
