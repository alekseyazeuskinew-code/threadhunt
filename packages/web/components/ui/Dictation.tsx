'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/cn';

// Голосовой ввод через встроенный Web Speech API (Chrome/Edge). Бесплатно, локально,
// русский язык, в реальном времени. onText вызывается с КАЖДЫМ финальным фрагментом —
// вызывающий сам дописывает его к значению поля.
function getSR(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function MicButton({ onText, className, title = 'Надиктовать голосом', lang = 'ru-RU' }: { onText: (t: string) => void; className?: string; title?: string; lang?: string }) {
  const [rec, setRec] = useState(false);
  const ref = useRef<any>(null);
  const supported = typeof window !== 'undefined' && !!getSR();

  useEffect(() => {
    return () => {
      try {
        ref.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  function toggle() {
    if (rec) {
      try {
        ref.current?.stop();
      } catch {
        /* ignore */
      }
      setRec(false);
      return;
    }
    const SR = getSR();
    if (!SR) return;
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      const t = final.trim();
      if (t) onText(t);
    };
    r.onerror = () => setRec(false);
    r.onend = () => setRec(false);
    ref.current = r;
    try {
      r.start();
      setRec(true);
    } catch {
      setRec(false);
    }
  }

  if (!supported) return null; // браузер без распознавания — кнопку не показываем
  return (
    <button
      type="button"
      onClick={toggle}
      title={rec ? 'Остановить запись' : title}
      aria-label={rec ? 'Остановить запись' : title}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg border p-1.5 transition-colors',
        rec ? 'animate-pulse border-danger bg-danger/10 text-danger' : 'border-line text-muted hover:border-accent/50 hover:text-accent-ink',
        className,
      )}
    >
      {rec ? <Square size={14} /> : <Mic size={14} />}
    </button>
  );
}

// Хелпер: дописать надиктованный фрагмент к текущему значению (с пробелом).
export function appendDictation(prev: string, chunk: string): string {
  if (!prev.trim()) return chunk;
  return prev.replace(/\s*$/, '') + ' ' + chunk;
}
