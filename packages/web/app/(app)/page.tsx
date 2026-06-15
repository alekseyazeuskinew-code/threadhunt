'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, KanbanSquare, Plug, AlertTriangle, ClipboardCheck, Clock, Bell } from 'lucide-react';
import { api } from '@/lib/api';
import type { Overview, SearchSummary, TodoItem } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Stat';
import { Button } from '@/components/ui/Button';
import { TrendBars } from '@/components/charts/TrendBars';
import { Breakdown } from '@/components/charts/Breakdown';
import { GettingStarted } from '@/components/GettingStarted';
import { STAGES } from '@/lib/stages';
import { Skeleton } from '@/components/ui/Skeleton';

// Минималистичная главная: только суть — что требует действия, ключевые цифры,
// динамика лидов и состояние системы. Остальное (планы, воронки, команда,
// онбординг) живёт в своих разделах, чтобы не плодить блоки.
export default function OverviewPage() {
  const router = useRouter();
  const [o, setO] = useState<Overview | null>(null);
  const [searches, setSearches] = useState<SearchSummary[]>([]);
  const [todo, setTodo] = useState<TodoItem[]>([]);

  useEffect(() => {
    api.get<Overview>('/api/analytics/overview').then(setO).catch(() => router.push('/login'));
    api.get<SearchSummary[]>('/api/searches').then(setSearches).catch(() => {});
    api.get<TodoItem[]>('/api/analytics/todo').then(setTodo).catch(() => {});
  }, []);

  return (
    <>
      <PageHeader
        title="Обзор"
        subtitle="Главное по найму: что требует внимания, лиды и состояние системы."
        action={
          <div className="flex gap-2">
            <Link href="/connections">
              <Button variant="ghost" size="sm">
                <Plug size={15} /> Threads
              </Button>
            </Link>
            <Link href="/leads">
              <Button variant="ghost" size="sm">
                <KanbanSquare size={15} /> Кандидаты
              </Button>
            </Link>
            <Link href="/searches">
              <Button size="sm">
                <Plus size={15} /> Новый поиск
              </Button>
            </Link>
          </div>
        }
      />

      <div className="p-8">
        {!o ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
            <Skeleton className="h-12 w-full" />
            <div className="grid gap-6 lg:grid-cols-3">
              <Skeleton className="h-64 lg:col-span-2" />
              <Skeleton className="h-64" />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Пошаговый гайд — только пока настройка не завершена (компонент сам решает). */}
            <GettingStarted
              signals={{
                connections: o.kpi.connections,
                devicesOnline: o.kpi.devicesOnline,
                searchesTotal: o.kpi.searchesTotal,
                postingOn: searches.some((s) => s.publishConfig?.enabled),
                leadsTotal: o.kpi.leadsTotal,
              }}
            />

            {/* 1. Что требует действия — самый высокий приоритет */}
            {todo.length > 0 && (
              <Card className="border-warning/30">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold">Требует действия</h2>
                  <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs text-warning">{todo.length}</span>
                </div>
                <div className="space-y-1.5">
                  {todo.slice(0, 6).map((t) => (
                    <Link key={t.leadId + t.type} href={`/searches?id=${t.searchId}`} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-panel-2">
                      <TodoIcon type={t.type} />
                      <span className="flex-1 truncate text-sm">
                        <b>{t.name}</b> · {t.detail} <span className="text-muted">— {t.searchTitle}</span>
                      </span>
                      {t.at && <span className="shrink-0 text-xs text-muted">{new Date(t.at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span>}
                    </Link>
                  ))}
                </div>
                {todo.length > 6 && (
                  <Link href="/leads" className="mt-2 inline-block text-sm font-medium text-accent-ink hover:underline">
                    Ещё {todo.length - 6} →
                  </Link>
                )}
              </Card>
            )}

            {/* 2. Ключевые цифры */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Лидов всего" value={o.kpi.leadsTotal} accent hint={`+${o.kpi.leads7} за 7 дней`} />
              <Stat label="Сегодня" value={o.kpi.leadsToday} hint="новых кандидатов" />
              <Stat label="Конверсия ответов" value={`${o.kpi.replyRate}%`} hint="бот ответил сам" />
              <Stat label="Опубликовано" value={o.kpi.postsTotal} hint={`+${o.kpi.posts7} за 7 дней`} />
            </div>

            {/* 2.5 Компактный снимок воронки — пайплайн с утра одним взглядом */}
            {o.kpi.leadsTotal > 0 && o.pipeline && <PipelineStrip pipeline={o.pipeline} />}

            {/* 3. Динамика лидов + источники */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">Лиды за 14 дней</h2>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> ответили
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-panel-2" /> всего
                    </span>
                  </div>
                </div>
                <TrendBars data={o.series} />
              </Card>
              <Card>
                <h2 className="mb-4 text-base font-semibold">Откуда приходят</h2>
                <Breakdown
                  rows={[
                    { label: 'Запросы', value: o.sections.requests },
                    { label: 'Скрытые', value: o.sections.hidden },
                    { label: 'Основной', value: o.sections.main },
                  ]}
                />
                <p className="mt-4 text-xs text-muted">Большинство откликов незнакомцев Threads прячет в «Запросы».</p>
              </Card>
            </div>

            {/* 4. Компактное состояние системы */}
            <Card>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
                <StatusItem label="Расширение" value={o.kpi.devicesOnline > 0 ? 'онлайн' : 'оффлайн'} ok={o.kpi.devicesOnline > 0} />
                <StatusItem label="Подключений Threads" value={String(o.kpi.connections)} ok={o.kpi.connections > 0} />
                <StatusItem label="Активных поисков" value={`${o.kpi.searchesActive} из ${o.kpi.searchesTotal}`} ok={o.kpi.searchesActive > 0} />
                <div className="ml-auto flex gap-2">
                  {o.kpi.connections === 0 && (
                    <Link href="/connections">
                      <Button variant="soft" size="sm">Подключить Threads</Button>
                    </Link>
                  )}
                  <Link href="/searches">
                    <Button variant="ghost" size="sm">Все поиски →</Button>
                  </Link>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

// Компактная воронка на главной: счётчики по стадиям, кликабельно → Кандидаты.
function PipelineStrip({ pipeline }: { pipeline: Record<string, number> }) {
  return (
    <Link href="/leads" className="flex flex-wrap items-stretch gap-2 rounded-2xl border border-line bg-panel p-2 transition-colors hover:border-accent/40">
      {STAGES.map((s) => (
        <div key={s.key} className="flex-1 rounded-xl bg-bg px-3 py-2 text-center">
          <div className={`font-display text-lg font-semibold tabular-nums ${s.tone}`}>{pipeline[s.key] ?? 0}</div>
          <div className="mt-0.5 text-[11px] text-muted">{s.label}</div>
        </div>
      ))}
    </Link>
  );
}

function StatusItem({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted">{label}:</span>
      <span className={`font-medium ${ok ? 'text-success' : 'text-warning'}`}>{ok ? '● ' : '○ '}{value}</span>
    </div>
  );
}

function TodoIcon({ type }: { type: TodoItem['type'] }) {
  const map = {
    test_overdue: { Icon: AlertTriangle, cls: 'bg-danger/10 text-danger' },
    review: { Icon: ClipboardCheck, cls: 'bg-accent-soft text-accent-ink' },
    test_soon: { Icon: Clock, cls: 'bg-warning/10 text-warning' },
    bench_touch: { Icon: Bell, cls: 'bg-panel-2 text-muted' },
  } as const;
  const { Icon, cls } = map[type];
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cls}`}>
      <Icon size={14} />
    </span>
  );
}
