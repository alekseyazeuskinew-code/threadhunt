// Горизонтальная разбивка (напр. лиды по разделам директа или топ-поиски).
export interface BreakdownRow {
  label: string;
  value: number;
}

export function Breakdown({ rows }: { rows: BreakdownRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="text-sm text-muted">нет данных</div>;
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-28 shrink-0 truncate text-sm text-muted">{r.label}</div>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="w-8 shrink-0 text-right text-sm tabular-nums">{r.value}</div>
        </div>
      ))}
    </div>
  );
}
