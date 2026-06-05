'use client';
import Link from 'next/link';
import { Search, Chrome, Send, ArrowRight } from 'lucide-react';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/Button';

const STEPS = [
  {
    icon: Search,
    title: 'Создай первый поиск',
    text: 'Кого ищем + кодовые слова. ИИ предложит посты-приманки и тексты отбивки.',
    href: '/searches',
    cta: 'Создать поиск',
  },
  {
    icon: Chrome,
    title: 'Поставь расширение и подключи браузер',
    text: 'Включает отбивку в директе. Работает под твоей сессией Threads — ничего официального и никакого Meta не нужно.',
    href: '/connections',
    cta: 'Подключить браузер',
  },
  {
    icon: Send,
    title: 'Threads API — по желанию',
    text: 'Нужен только для автопостинга приманок. Отбивка работает и без него.',
    href: '/connections',
    cta: 'Позже',
  },
];

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-2 text-xl">
        <Wordmark />
      </div>
      <h1 className="text-3xl font-semibold">Запустим найм за 3 шага</h1>
      <p className="mt-2 text-muted">Ставь приманки в ленте — Threadhunt ловит и квалифицирует кандидатов сам.</p>

      <div className="mt-8 space-y-3">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
              <s.icon size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {i + 1}. {s.title}
              </div>
              <div className="text-sm text-muted">{s.text}</div>
            </div>
            <Link href={s.href}>
              <Button variant="ghost" size="sm">
                {s.cta} <ArrowRight size={14} />
              </Button>
            </Link>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center">
        <Link href="/">
          <Button>Перейти в кабинет</Button>
        </Link>
      </div>
    </div>
  );
}
