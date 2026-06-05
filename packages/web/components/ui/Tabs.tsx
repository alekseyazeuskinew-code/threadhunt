'use client';
import { cn } from '@/lib/cn';

interface Props {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}

// Вкладки внутри одной страницы — деталь поиска без лишних переходов.
export function Tabs({ tabs, active, onChange }: Props) {
  return (
    <div className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'relative px-4 py-3 text-sm transition-colors',
            active === t.key ? 'text-text' : 'text-muted hover:text-text',
          )}
        >
          {t.label}
          {typeof t.count === 'number' && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
          {active === t.key && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}
