'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface Option {
  value: string;
  label: string;
}

// Кастомный выпадающий список в стиле сервиса (не нативный OS-дропдаун).
export function Select({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2.5 text-sm';

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-bg text-text outline-none transition-colors hover:border-line/80 focus:border-accent',
          pad,
        )}
      >
        <span className="truncate">{current?.label ?? '—'}</span>
        <ChevronDown size={15} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        // Панель: не уже триггера (min-w-full), под содержимое (w-max), но с потолком
        // (max-w) и переносом длинного текста — чтобы НЕ вылезать вбок и не перекрывать
        // соседние элементы. Раньше min-w-max растягивал панель под самую длинную опцию.
        <div className="anim-pop absolute z-50 mt-1.5 max-h-64 w-max min-w-full max-w-[min(22rem,80vw)] overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-xl shadow-black/30">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                o.value === value ? 'bg-accent-soft text-accent-ink' : 'text-text hover:bg-panel-2',
              )}
            >
              <span className="whitespace-normal break-words">{o.label}</span>
              {o.value === value && <Check size={14} className="mt-0.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
