'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

// Автосохранение с дебаунсом. enabled=false (пока идёт первичная загрузка с сервера)
// держит «первый снимок» базовой точкой — чтобы дефолты не улетели на сервер раньше
// реальных данных и не затёрли их. Возвращает статус для индикатора.
export function useAutosave<T>(value: T, persist: (v: T) => Promise<void>, opts?: { delay?: number; enabled?: boolean }): 'idle' | 'saving' | 'saved' {
  const delay = opts?.delay ?? 1000;
  const enabled = opts?.enabled ?? true;
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const first = useRef(true);
  const valueRef = useRef(value);
  valueRef.current = value;
  const key = JSON.stringify(value);
  useEffect(() => {
    if (!enabled) {
      first.current = true;
      return;
    }
    if (first.current) {
      first.current = false;
      return;
    }
    setStatus('saving');
    const t = setTimeout(async () => {
      try {
        await persist(valueRef.current);
        setStatus('saved');
      } catch {
        setStatus('idle');
      }
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return status;
}

export function AutosaveBadge({ status }: { status: 'idle' | 'saving' | 'saved' }) {
  if (status === 'saving')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Loader2 size={13} className="animate-spin" /> Сохранение…
      </span>
    );
  if (status === 'saved')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-success">
        <Check size={13} /> Сохранено
      </span>
    );
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted">Автосохранение включено</span>;
}
