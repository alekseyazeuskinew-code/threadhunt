'use client';
import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List, Star, MessageSquare, Clock, Sparkles, Download, SlidersHorizontal, GripVertical, Eye, EyeOff, RotateCcw, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Lead, Stage } from '@/lib/types';
import { STAGES, stageLabel } from '@/lib/stages';
import { PageHeader } from '@/components/PageHeader';
import { LeadTable } from '@/components/LeadTable';
import { LeadDrawer } from '@/components/LeadDrawer';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { type BoardPrefs, type CardField, DEFAULT_PREFS, CARD_FIELDS, loadPrefs, savePrefs } from '@/lib/boardPrefs';

const toneOf = (s: Stage) => STAGES.find((x) => x.key === s)?.tone ?? 'text-text';

export default function CandidatesPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [colDrag, setColDrag] = useState<Stage | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [vacancy, setVacancy] = useState<string>('all');
  const [prefs, setPrefs] = useState<BoardPrefs>(DEFAULT_PREFS);
  const [customize, setCustomize] = useState(false);
  const [query, setQuery] = useState('');

  const load = () => api.get<Lead[]>('/api/leads').then(setLeads).catch(() => setLeads([]));
  useEffect(() => {
    load();
    setPrefs(loadPrefs());
  }, []);

  function updatePrefs(p: Partial<BoardPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...p };
      savePrefs(next);
      return next;
    });
  }

  async function move(leadId: string, stage: Stage) {
    setLeads((prev) => prev!.map((l) => (l.id === leadId ? { ...l, stage } : l)));
    await api.patch(`/api/leads/${leadId}`, { stage });
  }

  // Список вакансий (поисков) для фильтра — из загруженных лидов.
  const vacancies = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads || []) if (l.searchId) m.set(l.searchId, l.search?.title || '—');
    return [...m.entries()].map(([id, title]) => ({ id, title }));
  }, [leads]);

  const filtered = useMemo(() => {
    let arr = leads || [];
    if (vacancy !== 'all') arr = arr.filter((l) => l.searchId === vacancy);
    const q = query.trim().toLowerCase();
    if (q)
      arr = arr.filter((l) =>
        [l.fromUsername, l.candidateName, l.matchedKeyword, l.role, l.contact, l.candidateContact]
          .some((f) => (f || '').toLowerCase().includes(q)),
      );
    return arr;
  }, [leads, vacancy, query]);

  // Перестановка колонки перетаскиванием заголовка.
  function reorderColumn(target: Stage) {
    if (!colDrag || colDrag === target) return;
    const order = [...prefs.order];
    const from = order.indexOf(colDrag);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    order.splice(to, 0, colDrag);
    updatePrefs({ order });
    setColDrag(null);
  }

  const visibleCols = prefs.order.filter((s) => !prefs.hidden.includes(s));

  return (
    <>
      <PageHeader
        title="Кандидаты"
        subtitle="Двигай кандидатов по воронке найма. «Резерв» — тёплые про запас."
        action={
          <div className="flex items-center gap-2">
            {/* Поиск по кандидатам */}
            {leads && leads.length > 0 && (
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск кандидата…"
                className="w-44 rounded-full border border-line bg-bg px-3.5 py-1.5 text-sm outline-none focus:border-accent"
              />
            )}
            {/* Фильтр по вакансии */}
            {vacancies.length > 0 && (
              <div className="w-52">
                <Select
                  size="sm"
                  value={vacancy}
                  onChange={setVacancy}
                  options={[{ value: 'all', label: `Все вакансии (${(leads || []).length})` }, ...vacancies.map((v) => ({ value: v.id, label: v.title }))]}
                />
              </div>
            )}
            {leads && leads.length > 0 && (
              <a href="/api/leads.csv" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-text hover:bg-panel-2">
                <Download size={15} /> CSV
              </a>
            )}
            {view === 'board' && (
              <button
                onClick={() => setCustomize((v) => !v)}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm', customize ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-panel-2')}
              >
                <SlidersHorizontal size={15} /> Настроить доску
              </button>
            )}
            <div className="flex rounded-full border border-line p-0.5">
              <ViewBtn active={view === 'board'} onClick={() => setView('board')} icon={<LayoutGrid size={15} />} label="Доска" />
              <ViewBtn active={view === 'list'} onClick={() => setView('list')} icon={<List size={15} />} label="Список" />
            </div>
          </div>
        }
      />

      <div className="p-8">
        {customize && view === 'board' && <CustomizePanel prefs={prefs} onChange={updatePrefs} onClose={() => setCustomize(false)} />}

        {filtered.length > 0 && <FunnelStrip leads={filtered} />}
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
          <LeadTable leads={filtered} showSearch onSelect={setOpenId} />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {visibleCols.map((key) => {
              const items = filtered.filter((l) => l.stage === key);
              const label = prefs.labels[key] || stageLabel(key);
              return (
                <div
                  key={key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragId) move(dragId, key);
                    else if (colDrag) reorderColumn(key);
                  }}
                  className={cn('flex w-64 shrink-0 flex-col rounded-2xl border bg-panel/40 p-2', colDrag ? 'border-dashed border-accent/40' : 'border-line')}
                >
                  <div
                    draggable
                    onDragStart={() => setColDrag(key)}
                    onDragEnd={() => setColDrag(null)}
                    className="flex cursor-grab items-center justify-between px-2 py-2 active:cursor-grabbing"
                    title="Перетащи, чтобы поменять порядок колонок"
                  >
                    <span className={cn('flex items-center gap-1.5 text-sm font-medium', toneOf(key))}>
                      <GripVertical size={13} className="text-muted" />
                      {label}
                    </span>
                    <span className="text-xs text-muted">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map((l) => (
                      <div
                        key={l.id}
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setDragId(l.id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => setOpenId(l.id)}
                        className="cursor-pointer rounded-xl border border-line bg-panel p-3 transition-colors hover:border-accent/40"
                      >
                        <div className="truncate text-sm font-medium">{l.fromUsername || l.candidateName || '—'}</div>
                        <CardFields lead={l} fields={prefs.cardFields} />
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

// Поля карточки — состав настраивается в «Настроить доску».
function CardFields({ lead, fields }: { lead: Lead; fields: CardField[] }) {
  const rows: React.ReactNode[] = [];
  for (const f of fields) {
    if (f === 'vacancy' && lead.search?.title) rows.push(<div key="v" className="truncate text-xs text-muted">{lead.search.title}</div>);
    if (f === 'contact' && lead.contact) rows.push(<div key="c" className="truncate text-xs text-muted">📩 {lead.contact}</div>);
    if (f === 'role' && lead.role) rows.push(<div key="r" className="truncate text-xs text-muted">🧩 {lead.role}</div>);
    if (f === 'rate' && lead.rate) rows.push(<div key="rt" className="truncate text-xs text-muted">💸 {lead.rate}</div>);
    if (f === 'keyword' && lead.matchedKeyword) rows.push(<div key="k" className="truncate text-xs text-muted">🔑 {lead.matchedKeyword}</div>);
    if (f === 'section' && lead.section) rows.push(<div key="s" className="truncate text-xs text-muted">📂 {lead.section}</div>);
    if (f === 'created') rows.push(<div key="cr" className="truncate text-xs text-muted">{new Date(lead.createdAt).toLocaleDateString('ru-RU')}</div>);
  }
  const showRating = fields.includes('rating') && lead.rating > 0;
  const showTest = fields.includes('testStatus');
  const showComments = fields.includes('comments') && !!lead._count?.comments;
  return (
    <>
      {rows.length > 0 && <div className="mt-1 space-y-0.5">{rows}</div>}
      {(showRating || showTest || showComments) && (
        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-2">
            {showRating && (
              <span className="flex items-center gap-1">
                <Star size={12} className="fill-accent text-accent-ink" /> {lead.rating}
              </span>
            )}
            {showTest && <TestBadge lead={lead} />}
          </span>
          {showComments && (
            <span className="flex items-center gap-1">
              <MessageSquare size={12} /> {lead._count!.comments}
            </span>
          )}
        </div>
      )}
    </>
  );
}

// Панель кастомизации доски: порядок/названия/видимость колонок + поля карточки.
function CustomizePanel({ prefs, onChange, onClose }: { prefs: BoardPrefs; onChange: (p: Partial<BoardPrefs>) => void; onClose: () => void }) {
  const [drag, setDrag] = useState<Stage | null>(null);

  function reorder(target: Stage) {
    if (!drag || drag === target) return;
    const order = [...prefs.order];
    const from = order.indexOf(drag);
    const to = order.indexOf(target);
    order.splice(from, 1);
    order.splice(to, 0, drag);
    onChange({ order });
    setDrag(null);
  }
  function toggleHidden(s: Stage) {
    onChange({ hidden: prefs.hidden.includes(s) ? prefs.hidden.filter((x) => x !== s) : [...prefs.hidden, s] });
  }
  function rename(s: Stage, value: string) {
    const labels = { ...prefs.labels };
    if (value.trim() && value.trim() !== stageLabel(s)) labels[s] = value.trim();
    else delete labels[s];
    onChange({ labels });
  }
  function toggleField(f: CardField) {
    onChange({ cardFields: prefs.cardFields.includes(f) ? prefs.cardFields.filter((x) => x !== f) : [...prefs.cardFields, f] });
  }

  return (
    <div className="mb-5 rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Настройка доски</div>
        <div className="flex items-center gap-2">
          <button onClick={() => onChange({ ...DEFAULT_PREFS })} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs hover:bg-panel-2">
            <RotateCcw size={13} /> Сбросить
          </button>
          <button onClick={onClose} className="rounded-full border border-line p-1.5 text-muted hover:bg-panel-2" title="Закрыть">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Колонки */}
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Колонки — тяни за ⠿, переименуй, спрячь</div>
          <div className="space-y-1.5">
            {prefs.order.map((s) => {
              const hidden = prefs.hidden.includes(s);
              return (
                <div
                  key={s}
                  draggable
                  onDragStart={() => setDrag(s)}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => reorder(s)}
                  className={cn('flex items-center gap-2 rounded-xl border bg-bg px-2.5 py-1.5', drag === s ? 'border-accent' : 'border-line')}
                >
                  <GripVertical size={14} className="shrink-0 cursor-grab text-muted" />
                  <input
                    defaultValue={prefs.labels[s] || stageLabel(s)}
                    onBlur={(e) => rename(s, e.target.value)}
                    className={cn('min-w-0 flex-1 bg-transparent text-sm outline-none', hidden && 'text-muted line-through')}
                  />
                  <span className="shrink-0 text-[10px] uppercase text-muted/60">{s}</span>
                  <button onClick={() => toggleHidden(s)} className="shrink-0 rounded p-1 text-muted hover:bg-panel-2" title={hidden ? 'Показать' : 'Скрыть'}>
                    {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted">Названия и порядок — на твоём устройстве. Базовые стадии воронки сохраняются (на них завязаны автоматизация и аналитика).</p>
        </div>

        {/* Поля карточки */}
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Что показывать на карточке</div>
          <div className="flex flex-wrap gap-1.5">
            {CARD_FIELDS.map((f) => {
              const on = prefs.cardFields.includes(f.key);
              return (
                <button
                  key={f.key}
                  onClick={() => toggleField(f.key)}
                  className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-panel-2')}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Воронка: счётчики по стадиям + ключевые метрики. Считается из (отфильтрованных) лидов.
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
