'use client';
import { useEffect, useState } from 'react';
import { LayoutGrid, List, Star, MessageSquare, Clock, Sparkles, Download } from 'lucide-react';
import { api } from '@/lib/api';
import type { Lead, Stage } from '@/lib/types';
import { STAGES } from '@/lib/stages';
import { PageHeader } from '@/components/PageHeader';
import { LeadTable } from '@/components/LeadTable';
import { LeadDrawer } from '@/components/LeadDrawer';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export default function CandidatesPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = () => api.get<Lead[]>('/api/leads').then(setLeads).catch(() => setLeads([]));
  useEffect(() => {
    load();
  }, []);

  async function move(leadId: string, stage: Stage) {
    setLeads((prev) => prev!.map((l) => (l.id === leadId ? { ...l, stage } : l)));
    await api.patch(`/api/leads/${leadId}`, { stage });
  }

  return (
    <>
      <PageHeader
        title="Кандидаты"
        subtitle="Двигай кандидатов по воронке найма. «Резерв» — тёплые про запас."
        action={
          <div className="flex items-center gap-2">
            {leads && leads.length > 0 && (
              <a href="/api/leads.csv" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-text hover:bg-panel-2">
                <Download size={15} /> CSV
              </a>
            )}
            <div className="flex rounded-full border border-line p-0.5">
              <ViewBtn active={view === 'board'} onClick={() => setView('board')} icon={<LayoutGrid size={15} />} label="Доска" />
              <ViewBtn active={view === 'list'} onClick={() => setView('list')} icon={<List size={15} />} label="Список" />
            </div>
          </div>
        }
      />

      <div className="p-8">
        {leads && leads.length > 0 && <FunnelStrip leads={leads} />}
        {leads === null ? (
          <div className="text-muted">Загрузка…</div>
        ) : leads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line p-12 text-center">
            <div className="text-lg font-medium">Кандидатов пока нет</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Реальные кандидаты появляются здесь автоматически, когда кто-то пишет кодовое слово в директ. А пока —
              заполни демо-данными, чтобы посмотреть, как работает воронка.
            </p>
            <Button
              className="mt-5"
              disabled={seeding}
              onClick={async () => {
                setSeeding(true);
                try {
                  await api.post('/api/demo/seed');
                  await load();
                } finally {
                  setSeeding(false);
                }
              }}
            >
              <Sparkles size={16} /> {seeding ? 'Создаю…' : 'Заполнить демо-данными'}
            </Button>
          </div>
        ) : view === 'list' ? (
          <LeadTable leads={leads} showSearch />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {STAGES.map((col) => {
              const items = leads.filter((l) => l.stage === col.key);
              return (
                <div
                  key={col.key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dragId && move(dragId, col.key)}
                  className="flex w-64 shrink-0 flex-col rounded-2xl border border-line bg-panel/40 p-2"
                >
                  <div className="flex items-center justify-between px-2 py-2">
                    <span className={cn('text-sm font-medium', col.tone)}>{col.label}</span>
                    <span className="text-xs text-muted">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map((l) => (
                      <div
                        key={l.id}
                        draggable
                        onDragStart={() => setDragId(l.id)}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => setOpenId(l.id)}
                        className="cursor-pointer rounded-xl border border-line bg-panel p-3 transition-colors hover:border-accent/40"
                      >
                        <div className="truncate text-sm font-medium">{l.fromUsername || '—'}</div>
                        <div className="mt-1 truncate text-xs text-muted">{l.search?.title}</div>
                        <div className="mt-2 flex items-center justify-between text-xs text-muted">
                          <span className="flex items-center gap-2">
                            {l.rating > 0 && (
                              <span className="flex items-center gap-1">
                                <Star size={12} className="fill-accent text-accent-ink" /> {l.rating}
                              </span>
                            )}
                            <TestBadge lead={l} />
                          </span>
                          {!!l._count?.comments && (
                            <span className="flex items-center gap-1">
                              <MessageSquare size={12} /> {l._count.comments}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {items.length === 0 && <div className="px-2 py-3 text-xs text-muted">пусто</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <LeadDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </>
  );
}

// Воронка: счётчики по стадиям + ключевые метрики. Считается из загруженных лидов.
function FunnelStrip({ leads }: { leads: Lead[] }) {
  const count = (k: Stage) => leads.filter((l) => l.stage === k).length;
  const overdue = leads.filter(
    (l) => l.stage === 'SCREENING' && l.testDeadlineAt && !l.testSubmittedAt && new Date(l.testDeadlineAt).getTime() <= Date.now(),
  ).length;
  const hired = count('HIRED');
  const conv = leads.length ? Math.round((hired / leads.length) * 100) : 0;

  return (
    <div className="mb-5 rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-stretch gap-2">
        {STAGES.map((s) => (
          <div key={s.key} className="flex-1 rounded-xl bg-bg px-3 py-2.5 text-center">
            <div className={cn('font-display text-xl font-semibold tabular-nums', s.tone)}>{count(s.key)}</div>
            <div className="mt-0.5 text-[11px] text-muted">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        <span>Конверсия в команду: <b className="text-success">{conv}%</b></span>
        <span>В резерве: <b className="text-accent-ink">{count('BENCH')}</b></span>
        {overdue > 0 && <span className="text-danger">Просрочено тестов: <b>{overdue}</b></span>}
      </div>
    </div>
  );
}

// Бейдж дедлайна тестового на карточке (если тест выдан и ещё не сдан).
function TestBadge({ lead }: { lead: Lead }) {
  if (lead.stage !== 'SCREENING' || !lead.testDeadlineAt || lead.testSubmittedAt) return null;
  const overdue = new Date(lead.testDeadlineAt).getTime() <= Date.now();
  return (
    <span className={cn('flex items-center gap-1', overdue ? 'text-danger' : 'text-warning')}>
      <Clock size={12} /> {overdue ? 'тест просрочен' : 'тест идёт'}
    </span>
  );
}

function ViewBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
        active ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-text',
      )}
    >
      {icon} {label}
    </button>
  );
}
