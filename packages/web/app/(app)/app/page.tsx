'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, KanbanSquare, Plug, ArrowUpRight, Send, MessageSquare, Bot, AlertTriangle, ClipboardCheck, Clock, Bell } from 'lucide-react';
import { api } from '@/lib/api';
import type { Overview, OnboardingSummaryRow, SearchSummary, ActivityEvent, GoalSummaryRow, TodoItem } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Stat';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { TrendBars } from '@/components/charts/TrendBars';
import { Breakdown } from '@/components/charts/Breakdown';
import { GettingStarted } from '@/components/GettingStarted';
import { SectionNav, type Section } from '@/components/SectionNav';

export default function OverviewPage() {
  const router = useRouter();
  const [o, setO] = useState<Overview | null>(null);
  const [onb, setOnb] = useState<OnboardingSummaryRow[]>([]);
  const [searches, setSearches] = useState<SearchSummary[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [goals, setGoals] = useState<GoalSummaryRow[]>([]);
  const [todo, setTodo] = useState<TodoItem[]>([]);

  useEffect(() => {
    api.get<Overview>('/api/analytics/overview').then(setO).catch(() => router.push('/login'));
    api.get<OnboardingSummaryRow[]>('/api/analytics/onboarding').then(setOnb).catch(() => {});
    api.get<SearchSummary[]>('/api/searches').then(setSearches).catch(() => {});
    api.get<ActivityEvent[]>('/api/analytics/activity').then(setActivity).catch(() => {});
    api.get<GoalSummaryRow[]>('/api/analytics/goals').then(setGoals).catch(() => {});
    api.get<TodoItem[]>('/api/analytics/todo').then(setTodo).catch(() => {});
  }, []);

  async function togglePosting(id: string, enabled: boolean) {
    setSearches((prev) => prev.map((s) => (s.id === id ? { ...s, publishConfig: { ...(s.publishConfig as any), enabled } } : s)));
    await api.patch(`/api/searches/${id}/publish-config`, { enabled });
  }

  function buildSections(ov: Overview): Section[] {
    const sections: Section[] = [];

    if (todo.length > 0) {
      sections.push({
        id: 'todo',
        title: 'Требует действия',
        node: (
          <Card className="border-warning/30">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Требует действия</h2>
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs text-warning">{todo.length}</span>
            </div>
            <div className="space-y-1.5">
              {todo.map((t) => (
                <Link key={t.leadId + t.type} href={`/searches?id=${t.searchId}`} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-panel-2">
                  <TodoIcon type={t.type} />
                  <span className="flex-1 truncate text-sm">
                    <b>{t.name}</b> · {t.detail} <span className="text-muted">— {t.searchTitle}</span>
                  </span>
                  {t.at && <span className="shrink-0 text-xs text-muted">{new Date(t.at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span>}
                </Link>
              ))}
            </div>
          </Card>
        ),
      });
    }

    sections.push({
      id: 'kpi',
      title: 'Показатели',
      node: (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Лидов всего" value={ov.kpi.leadsTotal} accent hint={`+${ov.kpi.leads7} за 7 дней`} />
          <Stat label="Сегодня" value={ov.kpi.leadsToday} hint="новых кандидатов" />
          <Stat label="Конверсия ответов" value={`${ov.kpi.replyRate}%`} hint="бот ответил автоматически" />
          <Stat label="Опубликовано" value={ov.kpi.postsTotal} hint={`+${ov.kpi.posts7} за 7 дней`} />
        </div>
      ),
    });

    sections.push({
      id: 'automations',
      title: 'Автоматизации',
      node: (
        <Card>
          <div className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Bot size={18} className="text-accent-ink" /> Автоматизации
          </div>
          <div className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <MessageSquare size={15} className="text-muted" /> Отбивка в директе (расширение)
            </div>
            {ov.kpi.devicesOnline > 0 ? (
              <span className="text-sm text-success">● работает</span>
            ) : (
              <Link href="/connections" className="text-sm text-warning hover:underline">○ расширение оффлайн →</Link>
            )}
          </div>
          <div className="mt-2 space-y-2">
            {searches.filter((s) => s.status === 'ACTIVE').length === 0 ? (
              <div className="rounded-xl bg-bg px-3 py-2.5 text-sm text-muted">Нет активных поисков.</div>
            ) : (
              searches
                .filter((s) => s.status === 'ACTIVE')
                .map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Send size={15} className="text-muted" /> Автопостинг · {s.title}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">{s.publishConfig?.enabled ? 'вкл' : 'выкл'}</span>
                      <Toggle checked={!!s.publishConfig?.enabled} onChange={(v) => togglePosting(s.id, v)} />
                    </div>
                  </div>
                ))
            )}
          </div>
          <p className="mt-3 text-xs text-muted">Постинг публикует приманки по расписанию (настройка интервала — во вкладке «Посты» поиска). Отбивка работает, пока открыт браузер с расширением.</p>
        </Card>
      ),
    });

    if (goals.length > 0) {
      sections.push({
        id: 'goals',
        title: 'Планы найма',
        node: (
          <Card>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-semibold">Планы найма</h2>
              {goals.some((g) => g.stale) && (
                <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs text-warning">
                  {goals.filter((g) => g.stale).length} требуют внимания
                </span>
              )}
            </div>
            <p className="mb-4 text-xs text-muted">Прогресс по целям и где встал приток лидов.</p>
            <div className="space-y-3">
              {goals.map((g) => {
                const pct = g.requiredLeads > 0 ? Math.min(100, Math.round((g.leads / g.requiredLeads) * 100)) : 0;
                return (
                  <Link key={g.id} href={`/searches?id=${g.id}`} className="block rounded-xl px-3 py-2.5 hover:bg-panel-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 truncate">
                        {g.title}
                        {g.stale && <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">пересмотреть тексты</span>}
                        {g.onPace === true && !g.stale && <span className="shrink-0 text-xs text-success">● в графике</span>}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted">
                        найм {g.hires}/{g.goalHires} · лиды {g.leads}/{g.requiredLeads}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2">
                      <div className={`h-full rounded-full ${g.stale ? 'bg-warning' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>
        ),
      });
    }

    if (activity.length > 0) {
      sections.push({
        id: 'activity',
        title: 'Активность',
        node: (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Активность</h2>
            <div className="space-y-2">
              {activity.map((e, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${e.type === 'lead' ? 'bg-accent-soft text-accent-ink' : 'bg-panel-2 text-muted'}`}>
                    {e.type === 'lead' ? <MessageSquare size={14} /> : <Send size={14} />}
                  </span>
                  <span className="flex-1 truncate">
                    {e.type === 'lead' ? (
                      <>Новый лид {e.who ? <b>{e.who}</b> : ''} по «{e.keyword}» · {e.search}</>
                    ) : (
                      <>{e.ok ? 'Опубликован пост' : 'Ошибка публикации'} · {e.search}</>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{new Date(e.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </Card>
        ),
      });
    }

    sections.push({
      id: 'trend',
      title: 'Лиды и источники',
      node: (
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
            <TrendBars data={ov.series} />
          </Card>
          <Card>
            <h2 className="mb-4 text-base font-semibold">Откуда приходят</h2>
            <Breakdown
              rows={[
                { label: 'Запросы', value: ov.sections.requests },
                { label: 'Скрытые', value: ov.sections.hidden },
                { label: 'Основной', value: ov.sections.main },
              ]}
            />
            <p className="mt-4 text-xs text-muted">Большинство откликов незнакомцев Threads прячет в «Запросы».</p>
          </Card>
        </div>
      ),
    });

    if (ov.teamHealth.length > 0) {
      sections.push({
        id: 'team',
        title: 'Запас команды',
        node: (
          <Card>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-semibold">Запас команды</h2>
              {ov.kpi.rolesAtRisk > 0 && (
                <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs text-warning">
                  {ov.kpi.rolesAtRisk} {ov.kpi.rolesAtRisk === 1 ? 'роль' : 'роли'} без резерва
                </span>
              )}
            </div>
            <p className="mb-4 text-xs text-muted">
              Закрыть вакансию — половина дела. Держи 2+ тёплых кандидата в резерве на каждую ключевую роль: уйдёт один — заменишь за день, а не за месяц.
            </p>
            <div className="space-y-3">
              {ov.teamHealth.map((r) => {
                const risk = r.hired > 0 && r.bench === 0;
                return (
                  <Link key={r.id} href={`/searches?id=${r.id}`} className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-panel-2">
                    <span className="truncate">{r.title}</span>
                    <span className="flex items-center gap-4 text-sm">
                      <span className="text-success">в команде {r.hired}</span>
                      <span className={risk ? 'text-warning' : 'text-muted'}>резерв {r.bench}/{r.reserveTarget}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </Card>
        ),
      });
    }

    if (onb.some((r) => r.issued > 0)) {
      sections.push({
        id: 'onboarding',
        title: 'Онбординг',
        node: (
          <Card>
            <h2 className="mb-1 text-base font-semibold">Онбординг по ролям</h2>
            <p className="mb-4 text-xs text-muted">Сколько кандидатов прислали ссылку и сколько дошли до конца.</p>
            <div className="space-y-2.5">
              {onb
                .filter((r) => r.issued > 0)
                .map((r) => {
                  const pct = Math.round((r.finished / Math.max(1, r.issued)) * 100);
                  return (
                    <Link key={r.id} href={`/searches?id=${r.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-panel-2">
                      <span className="w-40 shrink-0 truncate text-sm">{r.title}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-32 shrink-0 text-right text-sm text-muted">
                        {r.finished}/{r.issued} дошли <span className="text-accent-ink">({pct}%)</span>
                      </span>
                    </Link>
                  );
                })}
            </div>
          </Card>
        ),
      });
    }

    sections.push({
      id: 'top',
      title: 'Топ воронок',
      node: (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="mb-4 text-base font-semibold">Топ воронок по лидам</h2>
            {ov.topSearches.length ? (
              <div className="space-y-2">
                {ov.topSearches.map((s) => (
                  <Link key={s.id} href={`/searches?id=${s.id}`} className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-panel-2">
                    <span className="flex items-center gap-2">
                      {s.title} <ArrowUpRight size={14} className="text-muted" />
                    </span>
                    <span className="tabular-nums text-muted">{s.count} лидов</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted">Пока нет лидов ни в одной воронке.</div>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 text-base font-semibold">Состояние</h2>
            <div className="space-y-3 text-sm">
              <Row label="Активных поисков" value={`${ov.kpi.searchesActive} из ${ov.kpi.searchesTotal}`} />
              <Row label="Подключений Threads" value={ov.kpi.connections} />
              <Row label="Расширение онлайн" value={ov.kpi.devicesOnline > 0 ? `${ov.kpi.devicesOnline} ●` : 'оффлайн'} ok={ov.kpi.devicesOnline > 0} />
            </div>
            {ov.kpi.connections === 0 && (
              <Link href="/connections">
                <Button variant="soft" size="sm" className="mt-4 w-full">Подключить Threads</Button>
              </Link>
            )}
          </Card>
        </div>
      ),
    });

    return sections;
  }

  return (
    <>
      <PageHeader
        title="Обзор"
        subtitle="Сводка по найму: лиды, ответы, публикации и активные воронки."
        action={
          <div className="flex gap-2">
            <Link href="/connections">
              <Button variant="ghost" size="sm">
                <Plug size={15} /> Threads
              </Button>
            </Link>
            <Link href="/leads">
              <Button variant="ghost" size="sm">
                <KanbanSquare size={15} /> Пайплайн
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
          <div className="text-muted">Загрузка…</div>
        ) : (
          <div className="space-y-6">
            {/* Пошаговый гайд закреплён сверху */}
            <GettingStarted
              signals={{
                connections: o.kpi.connections,
                devicesOnline: o.kpi.devicesOnline,
                searchesTotal: o.kpi.searchesTotal,
                postingOn: searches.some((s) => s.publishConfig?.enabled),
                leadsTotal: o.kpi.leadsTotal,
              }}
            />
            {/* Переключалка по блокам + перетаскивание */}
            <SectionNav storageKey="overview" reorderable sections={buildSections(o)} />
          </div>
        )}
      </div>
    </>
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

function Row({ label, value, ok }: { label: string; value: string | number; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={ok ? 'text-success' : ''}>{value}</span>
    </div>
  );
}
