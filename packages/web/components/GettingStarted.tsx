'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plug, Puzzle, Target, Send, KanbanSquare, Check, ChevronDown, Compass, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';

// Пошаговый гайд: объясняет, за что отвечает каждый «пазл» системы, и подсвечивает,
// что уже настроено. Авто-разворачивается, пока настройка не завершена.
interface Signals {
  connections: number;
  devicesOnline: number;
  searchesTotal: number;
  postingOn: boolean;
  leadsTotal: number;
}

interface Step {
  icon: any;
  title: string;
  what: string; // что это
  why: string; // зачем нужно
  href: string;
  cta: string;
  done: (s: Signals) => boolean;
}

const STEPS: Step[] = [
  {
    icon: Plug,
    title: 'Подключи Threads-аккаунт',
    what: 'Привязываешь аккаунт, от имени которого выходят посты.',
    why: 'Без подключения системе нечем публиковать приманки и не от кого ловить отклики.',
    href: '/connections',
    cta: 'Подключить',
    done: (s) => s.connections > 0,
  },
  {
    icon: Puzzle,
    title: 'Поставь расширение в браузер',
    what: 'Дополнение само отвечает на кодовые слова в директе Threads.',
    why: 'Отбивка идёт прямо в твоём браузере — без доступов и модерации Meta. Работает, пока вкладка открыта.',
    href: '/connections',
    cta: 'Установить',
    done: (s) => s.devicesOnline > 0,
  },
  {
    icon: Target,
    title: 'Создай поиск под роль',
    what: 'Задаёшь кодовые слова, шаблоны ответов и тексты постов-приманок.',
    why: 'Поиск — это «воронка» под конкретную вакансию: по нему система понимает, что постить и на что отвечать.',
    href: '/searches',
    cta: 'Создать поиск',
    done: (s) => s.searchesTotal > 0,
  },
  {
    icon: Send,
    title: 'Включи автопостинг',
    what: 'Посты-приманки выходят по расписанию, которое ты задал.',
    why: 'Пока ты занят, система постит и собирает отклики кандидатов в фоне — без ручной работы.',
    href: '/searches',
    cta: 'Настроить постинг',
    done: (s) => s.postingOn,
  },
  {
    icon: KanbanSquare,
    title: 'Веди кандидатов в CRM',
    what: 'Отклики падают в пайплайн; даёшь кандидату ссылку с тестовым и ведёшь по этапам.',
    why: 'Здесь живёт весь цикл найма: от первого ответа до выхода в команду и резерва.',
    href: '/leads',
    cta: 'Открыть пайплайн',
    done: (s) => s.leadsTotal > 0,
  },
];

export function GettingStarted({ signals }: { signals: Signals }) {
  const states = STEPS.map((st) => st.done(signals));
  const doneCount = states.filter(Boolean).length;
  const allDone = doneCount === STEPS.length;

  // Свёрнуто запоминаем в localStorage; если настройка не завершена — по умолчанию раскрыто.
  const [open, setOpen] = useState(!allDone);
  useEffect(() => {
    const saved = localStorage.getItem('th_guide_open');
    if (saved !== null) setOpen(saved === '1');
    else setOpen(!allDone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = () => {
    setOpen((v) => {
      localStorage.setItem('th_guide_open', v ? '0' : '1');
      return !v;
    });
  };

  return (
    <Card className={allDone ? '' : 'border-accent/30'}>
      <button onClick={toggle} className="-m-1 flex w-full items-center gap-3 rounded-xl p-1 text-left transition-colors hover:bg-panel-2/50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
          <Compass size={18} />
        </span>
        <div className="flex-1">
          <div className="text-base font-semibold">Как работает Threadhunt</div>
          <div className="text-xs text-muted">
            {allDone ? 'Всё настроено — система работает 🎉' : 'Пять пазлов от подключения до найма. Собери их по порядку.'}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-panel-2 px-2.5 py-1 text-xs tabular-nums text-muted">
          {doneCount}/{STEPS.length} шагов
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
          {open ? 'свернуть' : 'развернуть'}
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="mt-5">
          {STEPS.map((st, i) => {
            const done = states[i];
            const Icon = st.icon;
            const last = i === STEPS.length - 1;
            // Первый ненастроенный шаг — «текущий», подсвечиваем CTA.
            const current = !done && states.slice(0, i).every(Boolean);
            return (
              <div key={i} className="relative flex gap-4 pb-5 last:pb-0">
                {/* соединительная линия-цепочка */}
                {!last && <span className={`absolute left-[15px] top-9 bottom-0 w-px ${done ? 'bg-accent/40' : 'bg-line'}`} />}
                {/* узел */}
                <span
                  className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                    done ? 'bg-accent text-on-accent' : current ? 'bg-accent-soft text-accent-ink ring-2 ring-accent/40' : 'bg-panel-2 text-muted'
                  }`}
                >
                  {done ? <Check size={16} /> : i + 1}
                </span>
                <div className="flex-1 pt-0.5">
                  <div className="flex items-center gap-2">
                    <Icon size={15} className={done ? 'text-accent-ink' : 'text-muted'} />
                    <span className={`text-sm font-medium ${done ? 'text-muted line-through decoration-line' : ''}`}>{st.title}</span>
                    {current && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-ink">сейчас</span>}
                  </div>
                  <p className="mt-1 text-sm">{st.what}</p>
                  <p className="mt-0.5 text-xs text-muted">{st.why}</p>
                  {!done && (
                    <Link
                      href={st.href}
                      className={`mt-2 inline-flex items-center gap-1 text-sm font-medium ${current ? 'text-accent-ink hover:underline' : 'text-muted hover:text-fg'}`}
                    >
                      {st.cta} <ArrowRight size={14} />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
