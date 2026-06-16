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

// Человеческие подсказки по кодам ошибок распознавания.
function errText(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Нет доступа к микрофону. Разреши его в браузере (значок 🔒 в адресной строке → Микрофон → Разрешить) и попробуй снова.';
    case 'audio-capture':
      return 'Микрофон не найден. Проверь, что он подключён и выбран в системе.';
    case 'no-speech':
      return 'Речь не распознана — говори чуть ближе к микрофону.';
    case 'network':
      return 'Нет связи с сервисом распознавания. Проверь интернет (распознавание работает в Chrome/Edge).';
    case 'insecure':
      return 'Голосовой ввод работает только на защищённом соединении (https) — открой сайт по https.';
    default:
      return 'Не получилось включить голосовой ввод. Используй Chrome или Edge.';
  }
}

export function MicButton({ onText, className, title = 'Надиктовать голосом', lang = 'ru-RU' }: { onText: (t: string) => void; className?: string; title?: string; lang?: string }) {
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef<any>(null);
  const stopRef = useRef(false); // true = пользователь сам остановил (не перезапускаем)
  const supported = typeof window !== 'undefined' && !!getSR();

  useEffect(() => {
    return () => {
      stopRef.current = true;
      try {
        ref.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Авто-скрытие сообщения об ошибке.
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(''), 6000);
    return () => clearTimeout(t);
  }, [err]);

  function buildRecognizer() {
    const SR = getSR();
    if (!SR) return null;
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
    r.onerror = (e: any) => {
      const code = e?.error || '';
      // no-speech при continuous — обычное дело, не считаем фатальной ошибкой: onend перезапустит.
      if (code && code !== 'no-speech' && code !== 'aborted') {
        stopRef.current = true; // фатальная ошибка — не перезапускаем
        setErr(errText(code));
        setRec(false);
      }
    };
    r.onend = () => {
      // Chrome глушит запись после паузы тишины. Пока пользователь не нажал «стоп» — перезапускаем.
      if (!stopRef.current) {
        try {
          r.start();
          return;
        } catch {
          /* ignore — упадём в выключение ниже */
        }
      }
      setRec(false);
    };
    return r;
  }

  async function start() {
    if (!window.isSecureContext) {
      setErr(errText('insecure'));
      return;
    }
    // Явно просим доступ к микрофону — так пользователь видит понятный системный запрос.
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop()); // нам нужно только разрешение
      }
    } catch {
      setErr(errText('not-allowed'));
      return;
    }
    const r = buildRecognizer();
    if (!r) {
      setErr(errText('default'));
      return;
    }
    ref.current = r;
    stopRef.current = false;
    try {
      r.start();
      setRec(true);
      setErr('');
    } catch {
      setRec(false);
    }
  }

  function toggle() {
    if (rec) {
      stopRef.current = true;
      try {
        ref.current?.stop();
      } catch {
        /* ignore */
      }
      setRec(false);
      return;
    }
    void start();
  }

  if (!supported) return null; // браузер без распознавания — кнопку не показываем
  return (
    <span className="relative inline-flex">
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
      {err && (
        <span className="anim-fade absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-danger/40 bg-panel p-2 text-[11px] leading-snug text-danger shadow-lg">
          {err}
        </span>
      )}
    </span>
  );
}

// Хелпер: дописать надиктованный фрагмент к текущему значению (с пробелом).
export function appendDictation(prev: string, chunk: string): string {
  if (!prev.trim()) return chunk;
  return prev.replace(/\s*$/, '') + ' ' + chunk;
}
