'use client';
import { useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';

// Спокойное уведомление про серую зону ToS Threads. Скрывается и запоминается.
export function SafetyNotice({ storageKey = 'th_safety_dismissed' }: { storageKey?: string }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    setHidden(localStorage.getItem(storageKey) === '1');
  }, [storageKey]);
  if (hidden) return null;

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
      <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
      <div className="flex-1 text-sm">
        <div className="font-medium text-text">Берегите аккаунт</div>
        <p className="mt-1 text-muted">
          Автоматизация директа — серая зона правил Threads. Не «перебарщивайте»: мы держим безопасные лимиты, но риск
          ограничений на аккаунте — на вас. Сверьтесь с официальными условиями{' '}
          <a
            href="https://developers.facebook.com/docs/threads"
            target="_blank"
            rel="noreferrer"
            className="text-accent-ink hover:underline"
          >
            Threads API
          </a>
          .
        </p>
      </div>
      <button
        onClick={() => {
          localStorage.setItem(storageKey, '1');
          setHidden(true);
        }}
        className="text-muted hover:text-text"
        aria-label="Скрыть"
      >
        <X size={16} />
      </button>
    </div>
  );
}
