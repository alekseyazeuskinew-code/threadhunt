'use client';
import { useEffect, useState } from 'react';
import { Settings2, Check, GripVertical } from 'lucide-react';

export interface Section {
  id: string;
  title: string;
  node: React.ReactNode;
}

// Лёгкая липкая переключалка-переходы по существующим секциям страницы (без перетаскивания).
// На странице каждой секции дайте контейнеру id из items и класс scroll-mt-16.
export function SectionAnchors({ items }: { items: { id: string; title: string }[] }) {
  return (
    <div className="sticky top-0 z-20 -mx-8 mb-4 flex items-center gap-1.5 overflow-x-auto border-b border-line bg-bg/85 px-8 py-2.5 backdrop-blur">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-text"
        >
          {it.title}
        </button>
      ))}
    </div>
  );
}

// Липкая панель-переключалка по подблокам длинной страницы + (опц.) режим
// перетаскивания блоков (как иконки на айфоне). Порядок запоминается в localStorage.
export function SectionNav({ sections, storageKey, reorderable = false }: { sections: Section[]; storageKey: string; reorderable?: boolean }) {
  const ids = sections.map((s) => s.id);
  const [order, setOrder] = useState<string[]>(ids);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const key = `th_sections_${storageKey}`;

  // загрузка сохранённого порядка + сверка с актуальным набором секций
  useEffect(() => {
    let saved: string[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(key) || '[]');
    } catch {}
    const valid = saved.filter((id) => ids.includes(id));
    const merged = [...valid, ...ids.filter((id) => !valid.includes(id))];
    setOrder(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);

  const ordered = order.map((id) => sections.find((s) => s.id === id)).filter(Boolean) as Section[];

  function persist(next: string[]) {
    setOrder(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }
  function onDrop(to: number) {
    if (drag === null || drag === to) return setDrag(null);
    const next = [...order];
    const [m] = next.splice(drag, 1);
    next.splice(to, 0, m);
    persist(next);
    setDrag(null);
  }
  function scrollTo(id: string) {
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <>
      {/* переключалка */}
      <div className="sticky top-0 z-20 -mx-8 mb-4 flex items-center gap-1.5 overflow-x-auto border-b border-line bg-bg/85 px-8 py-2.5 backdrop-blur">
        {editing ? (
          <span className="text-sm text-muted">Перетащите блоки в нужном порядке.</span>
        ) : (
          <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
            {ordered.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-text"
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
        {reorderable && (
          <button
            onClick={() => setEditing((v) => !v)}
            className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${editing ? 'bg-accent text-on-accent' : 'text-muted hover:bg-panel-2 hover:text-text'}`}
          >
            {editing ? (
              <>
                <Check size={13} /> Готово
              </>
            ) : (
              <>
                <Settings2 size={13} /> Расположение
              </>
            )}
          </button>
        )}
      </div>

      {/* блоки */}
      <div className="space-y-6">
        {ordered.map((s, i) => (
          <div
            key={s.id}
            id={`sec-${s.id}`}
            className={`scroll-mt-16 transition-all ${editing ? 'cursor-grab rounded-2xl ring-1 ring-accent/40 ring-offset-2 ring-offset-bg' : ''} ${drag === i ? 'scale-[0.99] opacity-50' : ''}`}
            draggable={editing}
            onDragStart={() => editing && setDrag(i)}
            onDragOver={(e) => editing && e.preventDefault()}
            onDrop={() => editing && onDrop(i)}
          >
            {editing && (
              <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                <GripVertical size={14} /> {s.title}
              </div>
            )}
            {s.node}
          </div>
        ))}
      </div>
    </>
  );
}
