'use client';
// Лёгкий столбчатый график без зависимостей: лиды по дням.
// Высота столбца = total; нижняя (лаймовая) часть = replied (ответили).

export interface TrendPoint {
  label: string;
  total: number;
  replied: number;
}

export function TrendBars({ data, height = 140 }: { data: TrendPoint[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => {
        const h = (d.total / max) * (height - 18);
        const repliedH = d.total ? (d.replied / d.total) * h : 0;
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5" title={`${d.label}: ${d.total} лидов, ${d.replied} ответили`}>
            <div className="flex w-full flex-col justify-end rounded-md bg-panel-2" style={{ height: Math.max(h, 2) }}>
              <div className="w-full rounded-md bg-accent" style={{ height: repliedH }} />
            </div>
            <span className="text-[10px] text-muted">{i % 2 === 0 ? d.label : ''}</span>
          </div>
        );
      })}
    </div>
  );
}
