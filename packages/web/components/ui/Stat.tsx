import { cn } from '@/lib/cn';

// KPI-карточка: метка, крупное число, подпись/дельта.
export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="anim-up rounded-2xl border border-line bg-panel p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={cn('mt-2 font-display text-3xl font-semibold tabular-nums', accent && 'text-accent-ink')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
