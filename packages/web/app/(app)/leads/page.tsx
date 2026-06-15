'use client';
import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List, Star, MessageSquare, Clock, Sparkles, Download, SlidersHorizontal, GripVertical, Eye, EyeOff, RotateCcw, X, FileText, Check, Link2, Send, CheckSquare, ArrowRightLeft, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Lead, Stage } from '@/lib/types';
import { STAGES, stageLabel } from '@/lib/stages';
import { PageHeader } from '@/components/PageHeader';
import { LeadTable } from '@/components/LeadTable';
import { LeadDrawer } from '@/components/LeadDrawer';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { confirmDialog } from '@/components/ui/confirm';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { type BoardPrefs, type CardField, DEFAULT_PREFS, CARD_FIELDS, loadPrefs, savePrefs } from '@/lib/boardPrefs';

type TestFilter = 'all' | 'submitted' | 'pending' | 'overdue';
type SortKey = 'new' | 'old' | 'rating' | 'deadline';
const tgUrl = (h: string) => {
  const v = (h || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('@')) return `https://t.me/${v.slice(1)}`;
  if (/^[a-zA-Z0-9_]{3,}$/.test(v)) return `https://t.me/${v}`;
  return null;
};

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
  // фильтры + сортировка
  const [minRating, setMinRating] = useState(0);
  const [testFilter, setTestFilter] = useState<TestFilter>('all');
  const [obFilter, setObFilter] = useState<'all' | 'has' | 'started' | 'submitted'>('all');
  const [sort, setSort] = useState<SortKey>('new');
  // массовое выделение
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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
    const prevStage = leads?.find((l) => l.id === leadId)?.stage;
    setLeads((prev) => prev!.map((l) => (l.id === leadId ? { ...l, stage } : l)));
    try {
      await api.patch(`/api/leads/${leadId}`, { stage });
    } catch {
      // откат: вернуть прежнюю стадию, если сервер не принял
      if (prevStage) setLeads((prev) => prev!.map((l) => (l.id === leadId ? { ...l, stage: prevStage } : l)));
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
    setSelectMode(false);
  }
  async function bulkStage(stage: Stage) {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    setLeads((prev) => prev!.map((l) => (selected.has(l.id) ? { ...l, stage } : l)));
    try {
      await api.post('/api/leads/bulk', { ids, action: 'stage', stage });
    } catch {
      await load(); // не приняли — пересинхронизируемся с сервером
    } finally {
      setBulkBusy(false);
      clearSelection();
    }
  }
  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!(await confirmDialog({ title: 'Удалить кандидатов?', message: `Будет удалено: ${ids.length}. Действие необратимо.`, confirmText: 'Удалить', danger: true }))) return;
    setBulkBusy(true);
    setLeads((prev) => prev!.filter((l) => !selected.has(l.id)));
    try {
      await api.post('/api/leads/bulk', { ids, action: 'delete' });
    } catch {
      await load(); // не удалилось — вернём как было
    } finally {
      setBulkBusy(false);
      clearSelection();
    }
  }

  // Список вакансий (поисков) для фильтра — из загруженных лидов.
  const vacancies = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads || []) if (l.searchId) m.set(l.searchId, l.search?.title || '—');
    return [...m.entries()].map(([id, title]) => ({ id, title }));
  }, [leads]);

  const filtered = useMemo(() => {
    const now = Date.now();
    let arr = leads || [];
    if (vacancy !== 'all') arr = arr.filter((l) => l.searchId === vacancy);
    const q = query.trim().toLowerCase();
    if (q)
      arr = arr.filter((l) =>
        [l.fromUsername, l.candidateName, l.matchedKeyword, l.role, l.contact, l.candidateContact]
          .some((f) => (f || '').toLowerCase().includes(q)),
      );
    if (minRating > 0) arr = arr.filter((l) => l.rating >= minRating);
    if (testFilter !== 'all')
      arr = arr.filter((l) => {
        const over = l.testDeadlineAt && !l.testSubmittedAt && new Date(l.testDeadlineAt).getTime() <= now;
        if (testFilter === 'submitted') return !!l.testSubmittedAt;
        if (testFilter === 'overdue') return !!over;
        if (testFilter === 'pending') return !!l.testDeadlineAt && !l.testSubmittedAt && !over;
        return true;
      });
    if (obFilter !== 'all')
      arr = arr.filter((l) => {
        if (obFilter === 'has') return !!l.onboardToken;
        if (obFilter === 'started') return (l.obStep ?? 0) > 0;
        if (obFilter === 'submitted') return !!l.testSubmittedAt;
        return true;
      });
    // сортировка (копия, чтобы не мутировать)
    const sorted = [...arr];
    if (sort === 'new') sorted.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    else if (sort === 'old') sorted.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    else if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating);
    else if (sort === 'deadline')
      sorted.sort((a, b) => (a.testDeadlineAt ? +new Date(a.testDeadlineAt) : Infinity) - (b.testDeadlineAt ? +new Date(b.testDeadlineAt) : Infinity));
    return sorted;
  }, [leads, vacancy, query, minRating, testFilter, obFilter, sort]);

  const activeFilters = (minRating > 0 ? 1 : 0) + (testFilter !== 'all' ? 1 : 0) + (obFilter !== 'all' ? 1 : 0);

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
            {leads && leads.length > 0 && (
              <button
                onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm', selectMode ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-panel-2')}
              >
                <CheckSquare size={15} /> {selectMode ? 'Отменить' : 'Выделить'}
              </button>
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

        {/* Фильтры + сортировка */}
        {leads && leads.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs font-medium text-muted">Фильтры:</span>
            <div className="w-36"><Select size="sm" value={String(minRating)} onChange={(v) => setMinRating(+v)} options={[{ value: '0', label: 'Любой рейтинг' }, { value: '3', label: '★ 3+' }, { value: '4', label: '★ 4+' }, { value: '5', label: '★ 5' }]} /></div>
            <div className="w-40"><Select size="sm" value={testFilter} onChange={(v) => setTestFilter(v as TestFilter)} options={[{ value: 'all', label: 'Тест: любой' }, { value: 'submitted', label: 'Тест: сдан' }, { value: 'pending', label: 'Тест: ждём' }, { value: 'overdue', label: 'Тест: просрочен' }]} /></div>
            <div className="w-40"><Select size="sm" value={obFilter} onChange={(v) => setObFilter(v as any)} options={[{ value: 'all', label: 'Анкета: любая' }, { value: 'has', label: 'Ссылка выдана' }, { value: 'started', label: 'Анкета начата' }, { value: 'submitted', label: 'Тест сдан' }]} /></div>
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
            <div className="w-44"><Select size="sm" value={sort} onChange={(v) => setSort(v as SortKey)} options={[{ value: 'new', label: 'Сначала новые' }, { value: 'old', label: 'Сначала старые' }, { value: 'rating', label: 'По рейтингу' }, { value: 'deadline', label: 'По дедлайну теста' }]} /></div>
            {activeFilters > 0 && (
              <button onClick={() => { setMinRating(0); setTestFilter('all'); setObFilter('all'); }} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-text">
                <X size={12} /> Сбросить ({activeFilters})
              </button>
            )}
            <span className="ml-auto text-xs text-muted">Показано: {filtered.length}</span>
          </div>
        )}

        {filtered.length > 0 && <FunnelStrip leads={filtered} />}
        {leads === null ? (
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-64 shrink-0 space-y-2">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            ))}
          </div>
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
                      <LeadCard
                        key={l.id}
                        lead={l}
                        fields={prefs.cardFields}
                        selectMode={selectMode}
                        selected={selected.has(l.id)}
                        setDragId={setDragId}
                        onOpen={setOpenId}
                        onToggle={toggleSelect}
                        onMove={move}
                      />
                    ))}
                    {items.length === 0 && <div className="px-2 py-3 text-xs text-muted">пусто</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Панель массовых действий */}
      {selectMode && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-5 z-40 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel px-4 py-2.5 shadow-2xl">
          <span className="text-sm font-medium">Выбрано: {selected.size}</span>
          <span className="mx-1 h-5 w-px bg-line" />
          <span className="text-xs text-muted">В стадию:</span>
          {STAGES.map((s) => (
            <button
              key={s.key}
              disabled={bulkBusy}
              onClick={() => bulkStage(s.key)}
              className={cn('rounded-full border border-line px-2.5 py-1 text-xs hover:bg-panel-2 disabled:opacity-50', s.tone)}
            >
              {stageLabel(s.key)}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          <button disabled={bulkBusy} onClick={bulkDelete} className="inline-flex items-center gap-1 rounded-full border border-danger/30 px-2.5 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50">
            <Trash2 size={13} /> Удалить
          </button>
          <button onClick={clearSelection} className="rounded-full border border-line p-1.5 text-muted hover:bg-panel-2" title="Снять выделение">
            <X size={14} />
          </button>
        </div>
      )}

      <LeadDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </>
  );
}

// Карточка кандидата на доске: выделение, быстрые действия (ссылка/TG/перенос), drag.
function LeadCard({
  lead,
  fields,
  selectMode,
  selected,
  setDragId,
  onOpen,
  onToggle,
  onMove,
}: {
  lead: Lead;
  fields: CardField[];
  selectMode: boolean;
  selected: boolean;
  setDragId: (id: string | null) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onMove: (id: string, stage: Stage) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const tg = tgUrl(lead.candidateContact || lead.contact || '');
  async function copyLink(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const r = await api.post<{ url: string }>(`/api/leads/${lead.id}/onboard-link`, {});
      const url = r.url.startsWith('http') ? r.url : window.location.origin + r.url;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <div
      draggable={!selectMode}
      onDragStart={(e) => {
        e.stopPropagation();
        setDragId(lead.id);
      }}
      onDragEnd={() => setDragId(null)}
      onClick={() => (selectMode ? onToggle(lead.id) : onOpen(lead.id))}
      className={cn(
        'group/card relative cursor-pointer rounded-xl border bg-panel p-3 transition-colors',
        selected ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-accent/40',
      )}
    >
      {selectMode && (
        <span className={cn('absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded border', selected ? 'border-accent bg-accent text-on-accent' : 'border-line bg-bg')}>
          {selected && <Check size={11} />}
        </span>
      )}
      <div className="truncate pr-5 text-sm font-medium">{lead.fromUsername || lead.candidateName || '—'}</div>
      <CardFields lead={lead} fields={fields} />
      {!selectMode && (
        <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover/card:opacity-100" onClick={(e) => e.stopPropagation()}>
          <button onClick={copyLink} title="Скопировать персональную ссылку анкеты" className="rounded-md border border-line p-1 text-muted hover:text-accent-ink">
            {copied ? <Check size={13} /> : <Link2 size={13} />}
          </button>
          {tg && (
            <a href={tg} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Написать в Telegram" className="rounded-md border border-line p-1 text-muted hover:text-accent-ink">
              <Send size={13} />
            </a>
          )}
          <div className="relative">
            <button onClick={() => setMenu((v) => !v)} title="Переместить в стадию" className="rounded-md border border-line p-1 text-muted hover:text-accent-ink">
              <ArrowRightLeft size={13} />
            </button>
            {menu && (
              <div className="absolute bottom-8 left-0 z-30 w-40 rounded-xl border border-line bg-panel p-1 shadow-2xl">
                {STAGES.filter((s) => s.key !== lead.stage).map((s) => (
                  <button key={s.key} onClick={() => { onMove(lead.id, s.key); setMenu(false); }} className={cn('block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-panel-2', s.tone)}>
                    → {stageLabel(s.key)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Бейдж прогресса анкеты (онбординга) на карточке.
function OnboardingBadge({ lead }: { lead: Lead }) {
  if (lead.testSubmittedAt) return <span className="flex items-center gap-1 text-success"><Check size={12} /> сдал тест</span>;
  if ((lead.obStep ?? 0) > 0) return <span className="flex items-center gap-1 text-accent-ink"><FileText size={12} /> анкета {Math.min(lead.obStep!, lead.obTotal || lead.obStep!)}{lead.obTotal ? `/${lead.obTotal}` : ''}</span>;
  if (lead.onboardToken) return <span className="flex items-center gap-1 text-muted"><Link2 size={12} /> ссылка</span>;
  return null;
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
  const showOb = fields.includes('onboarding');
  const showComments = fields.includes('comments') && !!lead._count?.comments;
  return (
    <>
      {rows.length > 0 && <div className="mt-1 space-y-0.5">{rows}</div>}
      {(showRating || showTest || showOb || showComments) && (
        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {showRating && (
              <span className="flex items-center gap-1">
                <Star size={12} className="fill-accent text-accent-ink" /> {lead.rating}
              </span>
            )}
            {showOb && <OnboardingBadge lead={lead} />}
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
