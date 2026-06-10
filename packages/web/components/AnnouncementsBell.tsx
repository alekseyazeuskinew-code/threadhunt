'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell, X, Megaphone, Sparkles, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Announcement } from '@/lib/types';

// Колокольчик объявлений основателя. Красная точка = есть непрочитанные.
// Открытие панели гасит счётчик (отмечает прочитанным на сервере).
export function AnnouncementsBell() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const { items, unread } = await api.get<{ items: Announcement[]; unread: number }>('/api/announcements');
      setItems(items);
      setUnread(unread);
    } catch {
      /* не критично */
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 120_000); // подтягивать новые раз в 2 мин
    return () => clearInterval(t);
  }, []);

  // Закрытие по клику вне панели.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      api.post('/api/announcements/seen').catch(() => {});
    }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} title="Объявления" className="relative rounded-lg p-2 text-muted transition-colors hover:bg-panel-2 hover:text-text">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-panel shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Megaphone size={15} className="text-accent-ink" /> Объявления
            </div>
            <button onClick={() => setOpen(false)} className="text-muted hover:text-text">
              <X size={16} />
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted">Пока объявлений нет.</div>
            ) : (
              items.map((a) => <AnnouncementRow key={a.id} a={a} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementRow({ a }: { a: Announcement }) {
  const meta = {
    info: { Icon: Megaphone, cls: 'text-accent-ink', label: 'новость' },
    update: { Icon: Sparkles, cls: 'text-success', label: 'обновление' },
    important: { Icon: AlertTriangle, cls: 'text-warning', label: 'важное' },
  }[a.level] || { Icon: Megaphone, cls: 'text-accent-ink', label: 'новость' };
  const { Icon, cls, label } = meta;
  return (
    <div className="border-b border-line px-4 py-3 last:border-0">
      <div className="mb-1 flex items-center gap-2">
        <Icon size={14} className={cls} />
        <span className="text-sm font-medium">{a.title}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted">{a.body}</p>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
        <span className={cls}>{label}</span>
        <span>·</span>
        <span>{new Date(a.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}
