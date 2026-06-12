'use client';
import { createRoot, type Root } from 'react-dom/client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export interface ConfirmOpts {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean; // деструктивное действие — красная кнопка подтверждения
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

// Императивная замена нативному window.confirm — в стилистике дашборда.
// Использование: if (await confirmDialog({ message: '…', danger: true })) { … }
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (!container) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  return new Promise<boolean>((resolve) => {
    const done = (v: boolean) => {
      root!.render(null);
      resolve(v);
    };
    root!.render(<ConfirmModal opts={opts} onClose={done} />);
  });
}

function ConfirmModal({ opts, onClose }: { opts: ConfirmOpts; onClose: (v: boolean) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
      else if (e.key === 'Enter') onClose(true);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="anim-fade absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => onClose(false)} />
      <div role="dialog" aria-modal="true" className="anim-up relative w-full max-w-sm rounded-2xl border border-line bg-panel p-5 shadow-2xl shadow-black/20">
        {opts.title && <div className="text-base font-semibold">{opts.title}</div>}
        <p className={`whitespace-pre-wrap text-sm text-muted ${opts.title ? 'mt-1.5' : ''}`}>{opts.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onClose(false)}>
            {opts.cancelText || 'Отмена'}
          </Button>
          {opts.danger ? (
            <Button className="border-0 bg-danger text-white hover:bg-danger/90" onClick={() => onClose(true)}>
              {opts.confirmText || 'Удалить'}
            </Button>
          ) : (
            <Button variant="accent" onClick={() => onClose(true)}>
              {opts.confirmText || 'Подтвердить'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
