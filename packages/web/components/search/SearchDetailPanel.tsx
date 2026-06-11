'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Sparkles, ShieldAlert, FlaskConical, Check, X, Send, ExternalLink, Eye, Upload, ImageIcon, Video, GitBranch, Layers, Play, Activity, MessageSquare, FileText, Clock, ChevronDown, ChevronRight, TrendingUp, Heart, Repeat2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { SearchDetail, ReplyTemplate, PostTemplate, PostSegment, MediaItem, Lead, SearchStats, TestPublishResult, Limits, DmStats, ActivityItem, ResearchPostRow } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { LeadTable } from '@/components/LeadTable';
import { FlowBuilder } from '@/components/search/FlowBuilder';
import { CampaignsManager } from '@/components/campaigns/CampaignsManager';
import { GoalPlanner } from '@/components/search/GoalPlanner';
import { type Flow, type Block, type BlockType, defaultFlow, FLOW_TEMPLATES, newPage, newBlock } from '@/lib/flow';
import { FlowPreview } from '@/components/onboarding/FlowRenderer';
import { TIMEZONES, zonedToUtc } from '@/lib/timezones';

// Четыре раздела вместо прежних восьми: обзор (пульт + хронология + цель),
// отбивка (директ + комменты), приманки (посты + реклама), лиды (+ онбординг).
type TabKey = 'overview' | 'otbivka' | 'baits' | 'leads';

// Форматы/«ходы» для генерации постов. Ключи синхронны с server/ai/generate.ts POST_FORMATS.
const POST_FORMAT_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'funny', label: '😄 Смешной хук', hint: 'шутка/мем в первой строке' },
  { key: 'provocative', label: '🔥 Провокация', hint: 'вызов, «слабо?», лёгкий троллинг' },
  { key: 'price_low', label: '💸 Цена-якорь ↓', hint: 'низкий порог входа как крючок' },
  { key: 'price_high', label: '💎 Цена-якорь ↑', hint: 'высокая оплата как фильтр статуса' },
  { key: 'intrigue', label: '🤫 Интрига', hint: 'недосказанность, «детали в директе»' },
  { key: 'story', label: '📖 История/кейс', hint: 'короткая живая история' },
  { key: 'urgency', label: '⏳ Дефицит', hint: 'мало мест + дедлайн' },
  { key: 'social_proof', label: '👥 Соцдоказательство', hint: '«уже собрал команду из…»' },
  { key: 'challenge', label: '🎯 Тест-крючок', hint: 'микро-задача прямо в посте' },
];

// Режимы совпадения кодового слова (движок — shared/keywords.ts).
const MATCH_MODE_OPTIONS = [
  { value: 'root', label: 'по корню (монтаж → монтажёр)' },
  { value: 'word', label: 'слово целиком во фразе' },
  { value: 'exact', label: 'всё сообщение точно' },
];

// ─────────────────────────── вспомогательное ───────────────────────────

function useAutosave<T>(value: T, persist: (v: T) => Promise<void>, delay = 1000): 'idle' | 'saving' | 'saved' {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const first = useRef(true);
  const valueRef = useRef(value);
  valueRef.current = value;
  const key = JSON.stringify(value);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setStatus('saving');
    const t = setTimeout(async () => {
      try {
        await persist(valueRef.current);
        setStatus('saved');
      } catch {
        setStatus('idle');
      }
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return status;
}

function AutosaveBadge({ status }: { status: 'idle' | 'saving' | 'saved' }) {
  if (status === 'saving') return <span className="text-xs text-muted">Сохраняю…</span>;
  if (status === 'saved') return <span className="text-xs text-success">Автосохранено ✓</span>;
  return <span className="text-xs text-muted">Автосохранение включено</span>;
}

function SectionTitle({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className="text-accent-ink">{icon}</span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
    </div>
  );
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────── корневая панель ───────────────────────────

export function SearchDetailPanel({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [s, setS] = useState<SearchDetail | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');

  async function load() {
    setS(await api.get<SearchDetail>(`/api/searches/${id}`));
  }
  useEffect(() => {
    setS(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!s) return <div className="p-8 text-muted">Загрузка…</div>;

  async function toggle() {
    setS({ ...s!, status: s!.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' });
    await api.post(`/api/searches/${id}/toggle`);
    onChanged?.();
  }
  const reload = () => {
    load();
    onChanged?.();
  };

  return (
    <div>
      <header className="border-b border-line px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-xl font-semibold">{s.title}</h1>
              <Badge tone={s.status === 'ACTIVE' ? 'accent' : 'neutral'}>{s.status === 'ACTIVE' ? '● активен' : '○ пауза'}</Badge>
            </div>
            {s.connection?.username && <p className="mt-1 text-sm text-muted">Аккаунт @{s.connection.username}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm text-muted">{s.status === 'ACTIVE' ? 'Включён' : 'На паузе'}</span>
            <Toggle checked={s.status === 'ACTIVE'} onChange={toggle} />
          </div>
        </div>
        <StatsStrip id={id} />
        <div className="mt-5">
          <Tabs
            active={tab}
            onChange={(k) => setTab(k as TabKey)}
            tabs={[
              { key: 'overview', label: 'Обзор' },
              { key: 'otbivka', label: 'Отбивка', count: s.keywords.length },
              { key: 'baits', label: 'Посты', count: s.postTemplates.length },
              { key: 'leads', label: 'Лиды', count: s._count?.leads ?? 0 },
            ]}
          />
        </div>
      </header>

      <div className="max-w-3xl p-6">
        {tab === 'overview' && <OverviewTab s={s} reload={reload} status={s.status} onToggleSearch={toggle} goTo={setTab} />}
        {tab === 'otbivka' && <OtbivkaTab s={s} reload={reload} status={s.status} onToggleSearch={toggle} />}
        {tab === 'baits' && <BaitsTab s={s} reload={reload} />}
        {tab === 'leads' && <LeadsAndOnboardingTab s={s} reload={reload} id={id} />}
      </div>
    </div>
  );
}

// ─────────────────────────────── ОБЗОР ───────────────────────────────
// Пульт: компактные тумблеры движков + хронология бэка + цель.
function OverviewTab({
  s,
  reload,
  status,
  onToggleSearch,
  goTo,
}: {
  s: SearchDetail;
  reload: () => void;
  status: string;
  onToggleSearch: () => void;
  goTo: (t: TabKey) => void;
}) {
  const [cfg, setCfg] = useState(s.publishConfig ?? { enabled: false, intervalMinutes: 240, maxPerDay: 5, rotation: 'sequential' as const });

  async function toggleAutopost(v: boolean) {
    setCfg({ ...cfg, enabled: v });
    await api.patch(`/api/searches/${s.id}/publish-config`, { ...cfg, enabled: v });
    reload();
  }

  return (
    <div className="space-y-5">
      {/* Движки */}
      <div className="grid gap-3 sm:grid-cols-3">
        <EngineCard
          title="Отбивка в директе"
          on={status === 'ACTIVE'}
          onToggle={onToggleSearch}
          meta={`${s.keywords.length} слов · ${s.replyTemplates.length} ответов`}
          onClick={() => goTo('otbivka')}
        />
        <EngineCard
          title="Автопостинг"
          on={cfg.enabled}
          onToggle={toggleAutopost}
          meta={`${s.postTemplates.length} шаблонов · каждые ${Math.round((cfg.intervalMinutes || 0) / 60)} ч`}
          onClick={() => goTo('baits')}
        />
        <EngineCard
          title="Отбивка в комментариях"
          on={!!s.commentRule?.enabled}
          meta={s.commentRule?.enabled ? 'включена' : 'выключена'}
          onClick={() => goTo('otbivka')}
        />
      </div>

      {/* Хронология «что происходит на бэке» */}
      <ActivityTimeline id={s.id} />

      {/* Цель найма */}
      <div>
        <SectionTitle icon={<FlaskConical size={16} />} title="Цель найма" hint="Сколько нужно лидов под цель и успеваем ли по темпу." />
        <GoalPlanner searchId={s.id} onRewrite={() => goTo('baits')} />
      </div>
    </div>
  );
}

function EngineCard({ title, on, onToggle, meta, onClick }: { title: string; on: boolean; onToggle?: (v: boolean) => void; meta: string; onClick: () => void }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-tight">{title}</div>
        {onToggle ? (
          <Toggle checked={on} onChange={onToggle} />
        ) : (
          <span className={`text-xs font-medium ${on ? 'text-success' : 'text-muted'}`}>{on ? '●' : '○'}</span>
        )}
      </div>
      <div className="mt-2 text-xs text-muted">{meta}</div>
      <button onClick={onClick} className="mt-3 text-sm font-medium text-accent-ink hover:underline">
        Настроить →
      </button>
    </div>
  );
}

// Лента активности бэка: публикации + лиды + проходы агента. Сворачиваемая —
// по умолчанию показывает короткую сводку (последние события), полный список — по кнопке.
const ACTIVITY_PREVIEW = 5;
function ActivityTimeline({ id }: { id: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true); // свёрнут/развёрнут весь блок
  const [showAll, setShowAll] = useState(false); // показать все события или только превью
  async function load() {
    setBusy(true);
    try {
      setItems(await api.get<ActivityItem[]>(`/api/searches/${id}/activity`));
    } catch {
      setItems([]);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const icon = (k: ActivityItem['kind']) => (k === 'post' ? <FileText size={14} /> : k === 'lead' ? <MessageSquare size={14} /> : <Activity size={14} />);
  const errors = items?.filter((it) => !it.ok).length ?? 0;
  const shown = items ? (showAll ? items : items.slice(0, ACTIVITY_PREVIEW)) : [];

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 items-center gap-2 text-left">
          <span className="text-accent-ink">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
          <Activity size={16} className="shrink-0 text-accent-ink" />
          <span className="font-semibold">Что происходит на бэке</span>
          {items && items.length > 0 && (
            <span className="text-xs text-muted">
              · {items.length} событий{errors > 0 && <span className="text-danger"> · {errors} с ошибкой</span>}
            </span>
          )}
        </button>
        <Button variant="ghost" size="sm" onClick={load} disabled={busy}>
          {busy ? 'Обновляю…' : 'Обновить'}
        </Button>
      </div>

      {open && (
        <div className="mt-3">
          {!items ? (
            <div className="text-sm text-muted">Загрузка…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted">Пока тихо. Как только бот опубликует пост или ответит в директе — появится здесь.</div>
          ) : (
            <>
              <div className="space-y-2">
                {shown.map((it, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-sm">
                    <span className={`mt-0.5 shrink-0 ${it.ok ? 'text-muted' : 'text-danger'}`}>{icon(it.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{it.title}</span>
                      {it.detail && <span className="text-muted"> · {it.detail}</span>}
                      {it.permalink && (
                        <a href={it.permalink} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-accent-ink hover:underline">
                          открыть <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted">{relTime(it.at)}</span>
                  </div>
                ))}
              </div>
              {items.length > ACTIVITY_PREVIEW && (
                <button onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm font-medium text-accent-ink hover:underline">
                  {showAll ? 'Свернуть' : `Показать все (${items.length})`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── ОТБИВКА ──────────────────────────────
// Директ: слова (+режим) → ответы → параметры прохода + статистика → комменты.
function OtbivkaTab({ s, reload, status, onToggleSearch }: { s: SearchDetail; reload: () => void; status: string; onToggleSearch: () => void }) {
  return (
    <div className="space-y-7">
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Отбивка в директе</div>
            <div className="text-sm text-muted">Бот сам отвечает в Threads на сообщения с кодовыми словами (через расширение).</div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium ${status === 'ACTIVE' ? 'text-success' : 'text-muted'}`}>{status === 'ACTIVE' ? 'Включена' : 'Выключена'}</span>
            <Toggle checked={status === 'ACTIVE'} onChange={onToggleSearch} />
          </div>
        </div>
      </div>

      <DmPassCard searchId={s.id} />

      <div>
        <SectionTitle icon={<Sparkles size={16} />} title="Кодовые слова" hint="Что ловим в директе и как — по корню или точно." />
        <KeywordsSection s={s} reload={reload} />
      </div>

      <div>
        <SectionTitle icon={<MessageSquare size={16} />} title="Шаблоны ответов" hint="Что бот пишет в ответ. Несколько — ротация / A-B." />
        <RepliesSection s={s} reload={reload} />
      </div>

      <div>
        <SectionTitle icon={<MessageSquare size={16} />} title="Отбивка в комментариях" hint="Ответы под твоими постами через официальный Threads API." />
        <CommentRuleCard s={s} reload={reload} />
      </div>
    </div>
  );
}

// Параметры прохода отбивки + статистика (аккаунт-уровень: один обход на все поиски).
function DmPassCard({ searchId }: { searchId: string }) {
  const [lim, setLim] = useState<Limits | null>(null);
  const [stats, setStats] = useState<DmStats | null>(null);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');

  async function loadAll() {
    const [l, st] = await Promise.all([api.get<Limits>('/api/limits'), api.get<DmStats>(`/api/searches/${searchId}/dm-stats`).catch(() => null)]);
    setLim(l);
    if (st) setStats(st);
  }
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId]);

  if (!lim) return <div className="rounded-2xl border border-line bg-panel p-4 text-sm text-muted">Загрузка параметров…</div>;

  const set = (patch: Partial<Limits>) => setLim({ ...lim, ...patch });
  const intervalMin = lim.caps?.intervalMin ?? 30;

  async function save() {
    await api.put('/api/limits', {
      sweepIntervalMinutes: lim!.sweepIntervalMinutes,
      maxDialogsPerSweep: lim!.maxDialogsPerSweep,
      safeMode: lim!.safeMode,
      sweepMain: lim!.sweepMain,
      sweepRequests: lim!.sweepRequests,
      sweepHidden: lim!.sweepHidden,
      researchEnabled: lim!.researchEnabled,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }
  async function runNow() {
    setRunning(true);
    setMsg('');
    try {
      await api.post('/api/dm/run-now');
      setMsg('Запущено — расширение начнёт обход в открытой вкладке Threads (до минуты).');
      setTimeout(loadAll, 2000);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setRunning(false);
    }
  }

  const lp = stats?.lastPass;
  const noSections = !lim.sweepMain && !lim.sweepRequests && !lim.sweepHidden;

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-medium">Параметры прохода</div>
          <div className="text-sm text-muted">
            Как бот обходит директ. Один обход покрывает все активные поиски аккаунта.
            {stats && (
              <span className={`ml-2 ${stats.agent.online ? 'text-success' : 'text-warning'}`}>
                ● агент {stats.agent.online ? 'онлайн' : 'офлайн'}
              </span>
            )}
          </div>
        </div>
        <Button size="sm" onClick={runNow} disabled={running || noSections}>
          <Play size={14} /> {running ? 'Запускаю…' : 'Прогон сейчас'}
        </Button>
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-muted">
          интервал
          <Input
            type="number"
            min={intervalMin}
            className="w-20"
            value={lim.sweepIntervalMinutes}
            onChange={(e) => set({ sweepIntervalMinutes: Math.max(intervalMin, +e.target.value) })}
          />
          мин
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          чатов за проход
          <Input type="number" min={1} className="w-20" value={lim.maxDialogsPerSweep} onChange={(e) => set({ maxDialogsPerSweep: Math.max(1, +e.target.value) })} />
        </label>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-xs font-medium text-muted">Разделы директа (где искать)</div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Check2 label="Основной директ" checked={lim.sweepMain} onChange={(v) => set({ sweepMain: v })} />
          <Check2 label="Запросы" checked={lim.sweepRequests} onChange={(v) => set({ sweepRequests: v })} />
          <Check2 label="Скрытые" checked={lim.sweepHidden} onChange={(v) => set({ sweepHidden: v })} />
        </div>
        {noSections && <p className="mt-1.5 text-xs text-danger">Выбери хотя бы один раздел — иначе обходить нечего.</p>}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={lim.safeMode} onChange={(e) => set({ safeMode: e.target.checked })} />
        <span>Безопасный режим — проходить и считать совпадения, но <b>не отправлять</b> ответы</span>
      </label>

      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={lim.researchEnabled} onChange={(e) => set({ researchEnabled: e.target.checked })} />
        <span>Research — раз в ~12 ч собирать <b>топовые вакансии-ветки</b> в Threads по твоим ролям (для вдохновения постов)</span>
      </label>

      {lim.sweepIntervalMinutes <= intervalMin && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-warning">
          <ShieldAlert size={13} /> Частые проходы повышают риск ограничений. Безопасно — раз в 2–3 часа.
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={save} disabled={noSections}>{saved ? 'Сохранено ✓' : 'Сохранить параметры'}</Button>
      </div>
      {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}

      {/* Статистика последнего прохода */}
      {lp && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Clock size={14} className="text-muted" /> Последний проход · {relTime(lp.at)}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <PassStat label="Отправлено" value={lp.sent} />
            <PassStat label="Чатов проверено" value={lp.scanned} />
            <PassStat label="Найдено слов" value={lp.matched} />
          </div>
        </div>
      )}

      {/* Всего ответов по кодовым словам */}
      {stats && stats.byKeyword.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-2 text-sm font-medium">Всего ответов по кодовым словам</div>
          <div className="space-y-1.5">
            {(() => {
              const max = Math.max(...stats.byKeyword.map((k) => k.count), 1);
              return stats.byKeyword.map((k) => (
                <div key={k.keyword} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 truncate text-muted">{k.keyword}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((k.count / max) * 100)}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right tabular-nums">{k.count}</span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function PassStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-bg p-3">
      <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Check2({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

type KwRow = { text: string; mode: string; replyText: string };

function KeywordsSection({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const [list, setList] = useState<KwRow[]>(
    s.keywords.length ? s.keywords.map((k) => ({ text: k.text, mode: k.mode || 'root', replyText: k.replyText || '' })) : [{ text: '', mode: 'root', replyText: '' }],
  );
  const [saved, setSaved] = useState(false);
  const set = (i: number, patch: Partial<KwRow>) => setList((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const persist = async () =>
    void (await api.put(`/api/searches/${s.id}/keywords`, {
      keywords: list.filter((r) => r.text.trim()).map((r) => ({ text: r.text.trim(), mode: r.mode || 'root', replyText: r.replyText.trim() || undefined })),
    }));
  const autosave = useAutosave(list, persist);

  async function save() {
    await persist();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    reload();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Сообщения с этими словами ловятся автоматически. Режим «по корню» поймает забытое окончание («монтаж» → «монтажёр»);
        «слово целиком» — только отдельное слово; «всё сообщение» — если текст равен слову. Можно задать свой ответ под каждое слово.
      </p>

      {list.map((r, i) => (
        <div key={i} className="rounded-2xl border border-line bg-panel p-3">
          <div className="flex items-center gap-2">
            <Input className="flex-1" value={r.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="монтаж" />
            <Select className="w-56" size="sm" value={r.mode} onChange={(v) => set(i, { mode: v })} options={MATCH_MODE_OPTIONS} />
            <button onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="text-muted hover:text-danger">
              <Trash2 size={18} />
            </button>
          </div>
          <Textarea
            className="mt-2"
            value={r.replyText}
            onChange={(e) => set(i, { replyText: e.target.value })}
            placeholder="Свой ответ под это слово (необязательно). Пусто → общий шаблон."
          />
        </div>
      ))}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setList((l) => [...l, { text: '', mode: 'root', replyText: '' }])}>
          <Plus size={16} /> Добавить слово
        </Button>
        <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить'}</Button>
        <AutosaveBadge status={autosave} />
      </div>
    </div>
  );
}

function RepliesSection({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const [list, setList] = useState<ReplyTemplate[]>(s.replyTemplates.length ? s.replyTemplates : [{ text: '', redirectTarget: '' }]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const set = (i: number, patch: Partial<ReplyTemplate>) => setList((l) => l.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const persist = async () =>
    void (await api.put(`/api/searches/${s.id}/reply-templates`, {
      templates: list.filter((t) => t.text.trim()).map((t) => ({ text: t.text, redirectTarget: t.redirectTarget })),
    }));
  const autosave = useAutosave(list, persist);

  async function save() {
    await persist();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    reload();
  }
  async function generate() {
    setBusy(true);
    setGenMsg('');
    try {
      const { result, source } = await api.post<{ result: string[]; source?: string }>(`/api/searches/${s.id}/generate`, { kind: 'replies', count: 4 });
      setList((l) => [...l, ...(result || []).map((text) => ({ text, redirectTarget: '' }))]);
      if (source === 'demo') setGenMsg('Сгенерировано демо-движком (ИИ-ключ не подключён).');
    } catch (e: any) {
      setGenMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button variant="soft" size="sm" onClick={generate} disabled={busy}>
          <Sparkles size={14} /> {busy ? 'Генерирую…' : 'Сгенерировать ИИ'}
        </Button>
      </div>
      {genMsg && <p className="text-xs text-warning">{genMsg}</p>}
      {list.map((t, i) => (
        <div key={i} className="rounded-2xl border border-line bg-panel p-4">
          <Textarea value={t.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="Привет! Спасибо за отклик…" />
          <div className="mt-2 flex items-center gap-2">
            <Input className="flex-1" value={t.redirectTarget} onChange={(e) => set(i, { redirectTarget: e.target.value })} placeholder="Куда направить: @telegram или ссылка" />
            <button onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="text-muted hover:text-danger">
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setList((l) => [...l, { text: '', redirectTarget: '' }])}>
          <Plus size={16} /> Добавить
        </Button>
        <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить'}</Button>
        <AutosaveBadge status={autosave} />
      </div>
    </div>
  );
}

// Правило авто-ответа на комментарии под постами (Threads API).
function CommentRuleCard({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const cr = s.commentRule;
  const [enabled, setEnabled] = useState(cr?.enabled ?? false);
  const [mode, setMode] = useState<'keyword' | 'all'>(cr?.mode ?? 'keyword');
  const [replyText, setReplyText] = useState(cr?.replyText ?? '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save(patch?: { enabled?: boolean }) {
    setSaving(true);
    try {
      await api.put(`/api/searches/${s.id}/comment-rule`, { enabled: patch?.enabled ?? enabled, mode, replyText });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-muted">На все комментарии или только с кодовым словом.</div>
        <Toggle
          checked={enabled}
          onChange={(v) => {
            setEnabled(v);
            save({ enabled: v });
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === 'keyword'} onChange={() => setMode('keyword')} /> только с кодовым словом
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> на все комментарии
        </label>
      </div>

      <div className="mt-3">
        <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Напр.: Привет! Спасибо за интерес 🙌 Напиши кодовое слово в директ — пришлю детали." />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={() => save()} disabled={saving}>{saved ? 'Сохранено ✓' : 'Сохранить'}</Button>
      </div>

      <p className="mt-3 rounded-lg bg-warning/5 px-3 py-2 text-xs text-warning">
        Требует доступа Meta (threads_read_replies / threads_manage_replies) — включится после одобрения и переподключения аккаунта. Настройки можно сохранить заранее.
      </p>
    </div>
  );
}

// ───────────────────────────── ПРИМАНКИ ─────────────────────────────
// Посты с медиа/каруселью/цепочками + расписание + тест/публикация + реклама.
function BaitsTab({ s, reload }: { s: SearchDetail; reload: () => void }) {
  return (
    <div className="space-y-8">
      <PostsSection s={s} reload={reload} />
      <div>
        <SectionTitle icon={<Layers size={16} />} title="Реклама" hint="Платное продвижение приманок через Meta." />
        <CampaignsManager fixedSearchId={s.id} searches={[{ id: s.id, title: s.title } as any]} />
      </div>
    </div>
  );
}

// Загрузить медиа из шаблона поста в редактируемые сегменты.
function templateToSegments(t: PostTemplate): PostSegment[] {
  if (t.segmentsJson) {
    try {
      const arr = JSON.parse(t.segmentsJson);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((seg: any) => ({
          text: typeof seg?.text === 'string' ? seg.text : '',
          media: Array.isArray(seg?.media) ? seg.media.filter((m: any) => m?.url && (m.type === 'image' || m.type === 'video')) : [],
        }));
      }
    } catch {}
  }
  const media: MediaItem[] = t.mediaUrl && (t.mediaType === 'image' || t.mediaType === 'video') ? [{ url: t.mediaUrl, type: t.mediaType }] : [];
  return [{ text: t.text || '', media }];
}

type EditTpl = { segments: PostSegment[] };

function PostsSection({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const [list, setList] = useState<EditTpl[]>(
    s.postTemplates.length ? s.postTemplates.map((t) => ({ segments: templateToSegments(t) })) : [{ segments: [{ text: '', media: [] }] }],
  );
  const [cfg, setCfg] = useState(s.publishConfig ?? { enabled: false, intervalMinutes: 240, maxPerDay: 5, rotation: 'sequential' as const });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [brief, setBrief] = useState('');
  const [formats, setFormats] = useState<string[]>([]);
  const [chainMode, setChainMode] = useState(false); // ИИ: генерировать цепочки веток
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestPublishResult | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ ok: boolean; permalink?: string | null; error?: string } | null>(null);

  // изменить сегмент шаблона ti, сегмент si
  const setSeg = (ti: number, si: number, patch: Partial<PostSegment>) =>
    setList((l) => l.map((t, j) => (j === ti ? { ...t, segments: t.segments.map((sg, k) => (k === si ? { ...sg, ...patch } : sg)) } : t)));

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.post<TestPublishResult>(`/api/searches/${s.id}/test-publish`, {}));
    } catch (e: any) {
      setTest({ ready: false, dryRun: true, connection: null, checks: [{ label: 'Ошибка теста', ok: false, detail: e.message }], wouldPost: null });
    } finally {
      setTesting(false);
    }
  }
  async function runPublishNow() {
    if (!window.confirm('Опубликовать реальный пост (или цепочку) в Threads от твоего аккаунта прямо сейчас?')) return;
    setPublishing(true);
    setPublished(null);
    try {
      const res = await api.post<{ ok: boolean; permalink?: string | null }>(`/api/searches/${s.id}/publish-now`, {});
      setPublished(res);
      reload();
    } catch (e: any) {
      setPublished({ ok: false, error: e.message });
    } finally {
      setPublishing(false);
    }
  }

  // Сохраняем как цепочки сегментов (карусель + ветки).
  const persist = async () => {
    await api.put(`/api/searches/${s.id}/post-templates`, {
      templates: list
        .map((t) => ({ segments: t.segments.filter((sg) => sg.text.trim() || sg.media.length) }))
        .filter((t) => t.segments.length)
        .map((t) => ({ segments: t.segments })),
    });
    await api.patch(`/api/searches/${s.id}/publish-config`, cfg);
  };
  const autosave = useAutosave({ list, cfg }, persist);

  async function save() {
    await persist();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    reload();
  }
  async function generate() {
    setBusy(true);
    setGenMsg('');
    try {
      if (chainMode) {
        const { result, source } = await api.post<{ result: string[][]; source?: string }>(`/api/searches/${s.id}/generate`, {
          kind: 'chain',
          count: 3,
          brief: brief.trim() || undefined,
          formats: formats.length ? formats : undefined,
        });
        const chains = (result || []).map((chain) => ({ segments: chain.map((text) => ({ text, media: [] as MediaItem[] })) }));
        setList((l) => [...l, ...chains]);
        if (source === 'demo') setGenMsg('Сгенерировано демо-движком (ИИ-ключ не подключён).');
      } else {
        const { result, source } = await api.post<{ result: string[]; source?: string }>(`/api/searches/${s.id}/generate`, {
          kind: 'posts',
          count: formats.length ? Math.max(formats.length, 5) : 5,
          brief: brief.trim() || undefined,
          formats: formats.length ? formats : undefined,
        });
        setList((l) => [...l, ...(result || []).map((text) => ({ segments: [{ text, media: [] as MediaItem[] }] }))]);
        if (source === 'demo') setGenMsg('Сгенерировано демо-движком (ИИ-ключ не подключён).');
      }
    } catch (e: any) {
      setGenMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Автопубликация */}
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Автопубликация</div>
            <div className="text-sm text-muted">Бот сам постит приманки по расписанию через официальный API.</div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium ${cfg.enabled ? 'text-success' : 'text-muted'}`}>{cfg.enabled ? 'Включён' : 'Выключен'}</span>
            <Toggle checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted">
          <label className="flex items-center gap-2">
            раз в
            <Input
              type="number"
              min={0}
              className="w-16"
              value={Math.floor((cfg.intervalMinutes || 0) / 60)}
              onChange={(e) => setCfg({ ...cfg, intervalMinutes: Math.max(0, +e.target.value) * 60 + ((cfg.intervalMinutes || 0) % 60) })}
            />
            ч
            <Input
              type="number"
              min={0}
              max={59}
              className="w-16"
              value={(cfg.intervalMinutes || 0) % 60}
              onChange={(e) => setCfg({ ...cfg, intervalMinutes: Math.floor((cfg.intervalMinutes || 0) / 60) * 60 + Math.max(0, Math.min(59, +e.target.value)) })}
            />
            мин
          </label>
          <label className="flex items-center gap-2">
            не больше
            <Input type="number" className="w-20" value={cfg.maxPerDay} onChange={(e) => setCfg({ ...cfg, maxPerDay: +e.target.value })} />
            в день
          </label>
          <label className="flex items-center gap-2">
            порядок
            <Select
              size="sm"
              className="w-36"
              value={cfg.rotation}
              onChange={(v) => setCfg({ ...cfg, rotation: v as any })}
              options={[{ value: 'sequential', label: 'по очереди' }, { value: 'random', label: 'случайно' }]}
            />
          </label>
        </div>
        {(cfg.intervalMinutes < 60 || cfg.maxPerDay > 10) && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-warning">
            <ShieldAlert size={13} /> Слишком частый постинг повышает риск ограничений. Безопасно: раз в 2–4 ч, до 5–10 в день.
          </p>
        )}

        {/* Тест + публикация */}
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <div className="font-medium">Тест публикации</div>
              <div className="text-xs text-muted">Проверит подключение, токен и шаблоны — ничего не публикуя.</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={runTest} disabled={testing || publishing}>
                <FlaskConical size={14} /> {testing ? 'Проверяю…' : 'Запустить тест'}
              </Button>
              <Button size="sm" onClick={runPublishNow} disabled={publishing || testing}>
                <Send size={14} /> {publishing ? 'Публикую…' : 'Опубликовать сейчас'}
              </Button>
            </div>
          </div>

          {published && (
            <div className={`mt-3 rounded-xl border p-3 text-sm ${published.ok ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5'}`}>
              {published.ok ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-success">✓ Опубликовано в Threads</span>
                  {published.permalink && (
                    <a href={published.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-ink hover:underline">
                      Открыть пост <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              ) : (
                <span className="text-danger">⚠ Не удалось опубликовать: {published.error}</span>
              )}
            </div>
          )}
          {test && (
            <div className={`mt-3 rounded-xl border p-3 ${test.ready ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'}`}>
              <div className="mb-2 text-sm font-medium">
                {test.ready ? '✓ Готово к публикации (тест, без отправки)' : '⚠ Публикация не пройдёт — есть незакрытые пункты'}
              </div>
              <div className="space-y-1.5">
                {test.checks.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 shrink-0 ${c.ok ? 'text-success' : 'text-danger'}`}>{c.ok ? <Check size={15} /> : <X size={15} />}</span>
                    <span className="flex-1">{c.label}{c.detail && <span className="text-muted"> · {c.detail}</span>}</span>
                  </div>
                ))}
              </div>
              {test.wouldPost && (
                <div className="mt-3 rounded-lg bg-bg p-2.5 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span>Следующим выйдет ({test.wouldPost.rotation}):</span>
                    {(test.wouldPost.segmentCount ?? 1) > 1 && <Badge tone="accent">цепочка из {test.wouldPost.segmentCount}</Badge>}
                    {(test.wouldPost.mediaCount ?? 0) > 1 && <Badge tone="accent">карусель {test.wouldPost.mediaCount}</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap">{test.wouldPost.text}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Research: топовые вакансии-ветки за 30 дней */}
      <ResearchPanel searchId={s.id} onUse={(t) => setBrief('Сделай в духе этой залетевшей ветки (не копируй дословно, возьми приём/тон):\n' + t)} />

      {/* Бриф + ИИ */}
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="mb-1 text-sm font-medium">Бриф для ИИ (необязательно)</div>
        <p className="mb-2 text-xs text-muted">Опиши условия: оплата/цена, формат и занятость, куда писать, дедлайн. ИИ впишет это в посты.</p>
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Напр.: монтажёр Reels, 15–20 роликов/нед, 500₽ за ролик, удалёнка, кодовое слово «монтаж», дедлайн пятница"
        />
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-muted">Тон и ходы (можно несколько)</div>
          <div className="flex flex-wrap gap-1.5">
            {POST_FORMAT_OPTIONS.map((f) => {
              const on = formats.includes(f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  title={f.hint}
                  onClick={() => setFormats((prev) => (prev.includes(f.key) ? prev.filter((x) => x !== f.key) : [...prev, f.key]))}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-panel-2'}`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={chainMode} onChange={(e) => setChainMode(e.target.checked)} />
            <span className="inline-flex items-center gap-1"><GitBranch size={14} /> Цепочки веток (пост + ответвления)</span>
          </label>
          <Button variant="soft" size="sm" onClick={generate} disabled={busy}>
            <Sparkles size={14} /> {busy ? 'Генерирую…' : chainMode ? 'Сгенерировать цепочки' : 'Сгенерировать ИИ'}
          </Button>
        </div>
      </div>
      {genMsg && <p className="text-xs text-warning">{genMsg}</p>}

      {/* Шаблоны постов */}
      {list.map((t, ti) => (
        <div key={ti} className="rounded-2xl border border-line bg-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
              {t.segments.length > 1 ? (
                <><GitBranch size={13} /> Цепочка из {t.segments.length}</>
              ) : (
                <>Пост</>
              )}
            </div>
            <button onClick={() => setList((l) => l.filter((_, j) => j !== ti))} className="text-muted hover:text-danger" title="Удалить шаблон">
              <Trash2 size={18} />
            </button>
          </div>

          <div className="space-y-3">
            {t.segments.map((seg, si) => (
              <div key={si} className={si > 0 ? 'rounded-xl border-l-2 border-accent/40 bg-bg/40 pl-3' : ''}>
                {t.segments.length > 1 && (
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted">{si === 0 ? 'Корневой пост' : `Ветка ${si}`}</span>
                    {si > 0 && (
                      <button
                        onClick={() => setList((l) => l.map((x, j) => (j === ti ? { ...x, segments: x.segments.filter((_, k) => k !== si) } : x)))}
                        className="text-xs text-muted hover:text-danger"
                      >
                        убрать ветку
                      </button>
                    )}
                  </div>
                )}
                <Textarea value={seg.text} onChange={(e) => setSeg(ti, si, { text: e.target.value })} placeholder={si === 0 ? 'Ищу монтажёра Reels…' : 'Продолжение в ветке: детали, оплата, CTA…'} />
                <MediaEditor
                  media={seg.media}
                  onChange={(media) => setSeg(ti, si, { media })}
                />
              </div>
            ))}
          </div>

          <button
            onClick={() => setList((l) => l.map((x, j) => (j === ti ? { ...x, segments: [...x.segments, { text: '', media: [] }] } : x)))}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
          >
            <GitBranch size={14} /> Добавить ветку под этот пост
          </button>
        </div>
      ))}

      <p className="text-xs text-muted">
        Загружай фото/видео прямо сюда — файл уйдёт в публикацию (Threads скачает его по нашей ссылке). Несколько медиа в одном
        посте = <b>карусель</b>. «Ветка под веткой» = цепочка ответов, которая лучше заходит в ленте.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setList((l) => [...l, { segments: [{ text: '', media: [] }] }])}>
          <Plus size={16} /> Добавить пост
        </Button>
        <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить'}</Button>
        <AutosaveBadge status={autosave} />
      </div>
    </div>
  );
}

// Редактор медиа сегмента: загрузка файла + вставка по ссылке + превью + карусель.
// Топовые вакансии-ветки за 30 дней (собраны расширением через research). Источник
// «насмотренности»: видно, что заходит у других по этой роли, и можно скормить в ИИ.
function ResearchPanel({ searchId, onUse }: { searchId: string; onUse: (text: string) => void }) {
  const [rows, setRows] = useState<ResearchPostRow[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api.get<ResearchPostRow[]>(`/api/searches/${searchId}/research`).then(setRows).catch(() => setRows([]));
  }, [searchId]);
  if (!rows) return null;

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="text-accent-ink">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
        <TrendingUp size={16} className="shrink-0 text-accent-ink" />
        <span className="font-semibold">Топ веток за 30 дней</span>
        {rows.length > 0 && <span className="text-xs text-muted">· {rows.length} собрано</span>}
      </button>
      {open && (
        <div className="mt-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">
              Пока пусто. Включи <b>Research</b> во вкладке «Отбивка» — расширение раз в ~12 ч соберёт самые заходящие
              вакансии-ветки по этой роли (нужен открытый Threads в браузере).
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.id} className="rounded-xl border border-line bg-bg p-3">
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm">{r.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                    {r.author && <span>@{r.author}</span>}
                    <span className="inline-flex items-center gap-1"><Heart size={12} /> {r.likes}</span>
                    <span className="inline-flex items-center gap-1"><MessageSquare size={12} /> {r.replies}</span>
                    <span className="inline-flex items-center gap-1"><Repeat2 size={12} /> {r.reposts}</span>
                    <div className="ml-auto flex items-center gap-3">
                      {r.permalink && (
                        <a href={r.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-ink hover:underline">
                          открыть <ExternalLink size={11} />
                        </a>
                      )}
                      <button onClick={() => onUse(r.text)} className="font-medium text-accent-ink hover:underline">
                        в ИИ-бриф →
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MediaEditor({ media, onChange }: { media: MediaItem[]; onChange: (m: MediaItem[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState('');
  const [urlType, setUrlType] = useState<'image' | 'video'>('image');
  const [lightbox, setLightbox] = useState<MediaItem | null>(null); // открытое на просмотр медиа
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setErr('');
    try {
      const added: MediaItem[] = [];
      for (const f of Array.from(files)) {
        const r = await api.upload(f);
        added.push({ url: r.url, type: r.type });
      }
      onChange([...media, ...added]);
    } catch (e: any) {
      setErr(e.message || 'Не удалось загрузить');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function addUrl() {
    if (!url.trim()) return;
    onChange([...media, { url: url.trim(), type: urlType }]);
    setUrl('');
    setShowUrl(false);
  }

  return (
    <>
    <div className="mt-2">
      {media.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {media.map((m, i) => (
            <div key={i} className="group relative">
              {/* Клик по превью — открыть фото/видео в полном размере. */}
              <button type="button" onClick={() => setLightbox(m)} title="Открыть" className="block">
                {m.type === 'image' ? (
                  <img src={m.url} alt="" className="h-20 w-20 rounded-lg border border-line object-cover" onError={(e) => (e.currentTarget.style.opacity = '0.3')} />
                ) : (
                  <video src={m.url} className="h-20 w-20 rounded-lg border border-line object-cover" />
                )}
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                  <Eye size={18} />
                </span>
              </button>
              <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 p-0.5 text-white">{m.type === 'image' ? <ImageIcon size={11} /> : <Video size={11} />}</span>
              <button
                onClick={() => onChange(media.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-danger p-0.5 text-white hover:bg-danger/80"
                title="Убрать"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {media.length > 1 && (
            <span className="self-center"><Badge tone="accent">карусель {media.length}</Badge></span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => onFile(e.target.files)} />
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload size={14} /> {uploading ? 'Загружаю…' : 'Загрузить фото/видео'}
        </Button>
        <button onClick={() => setShowUrl((v) => !v)} className="text-xs text-muted hover:text-text">
          или по ссылке
        </button>
      </div>

      {showUrl && (
        <div className="mt-2 flex items-center gap-2">
          <Input className="flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/file.mp4 (прямая ссылка)" />
          <Select size="sm" className="w-24" value={urlType} onChange={(v) => setUrlType(v as any)} options={[{ value: 'image', label: 'фото' }, { value: 'video', label: 'видео' }]} />
          <Button size="sm" onClick={addUrl}>Добавить</Button>
        </div>
      )}
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </div>

    {/* Лайтбокс: полноразмерный просмотр загруженного фото/видео. */}
    {lightbox && (
      <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/85 p-6" onClick={() => setLightbox(null)}>
        <div className="relative max-h-[88vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
          {lightbox.type === 'image' ? (
            <img src={lightbox.url} alt="" className="max-h-[84vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" />
          ) : (
            <video src={lightbox.url} controls autoPlay className="max-h-[84vh] max-w-[92vw] rounded-xl shadow-2xl" />
          )}
          <div className="mt-3 flex items-center justify-between text-sm text-white/85">
            <a href={lightbox.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
              Открыть оригинал <ExternalLink size={13} />
            </a>
            <button onClick={() => setLightbox(null)} className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20">Закрыть ✕</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ──────────────────────────── ЛИДЫ + ОНБОРДИНГ ────────────────────────────
function LeadsAndOnboardingTab({ s, reload, id }: { s: SearchDetail; reload: () => void; id: string }) {
  return (
    <div className="space-y-8">
      <div>
        <SectionTitle icon={<MessageSquare size={16} />} title="Лиды" hint="Кто написал кодовое слово — пайплайн кандидатов." />
        <LeadsList id={id} />
      </div>
      <div>
        <SectionTitle icon={<Eye size={16} />} title="Онбординг по ссылке" hint="Страницы и блоки, по которым пройдёт кандидат." />
        <OnboardingSection s={s} reload={reload} />
      </div>
    </div>
  );
}

function LeadsList({ id }: { id: string }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  useEffect(() => {
    api.get<Lead[]>(`/api/searches/${id}/leads`).then(setLeads);
  }, [id]);
  if (!leads) return <div className="text-muted">Загрузка…</div>;
  if (!leads.length) return <div className="text-sm text-muted">Пока лидов нет. Появятся, как только кто-то напишет кодовое слово.</div>;
  return <LeadTable leads={leads} showSearch={false} />;
}

function OnboardingSection({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const [enabled, setEnabled] = useState(s.obEnabled);
  const [showPreview, setShowPreview] = useState(false);
  const [flow, setFlow] = useState<Flow>(() => {
    try {
      if (s.obFlow) {
        const f = JSON.parse(s.obFlow);
        if (f?.pages?.length) return f;
      }
    } catch {}
    return defaultFlow();
  });
  const [saved, setSaved] = useState(false);
  const [tplName, setTplName] = useState('');
  const [saved2, setSaved2] = useState(false);
  const [dlMode, setDlMode] = useState<'none' | 'relative' | 'fixed'>(s.obDeadlineMode || 'none');
  const initHours = s.obDeadlineHours || 48;
  const [dlUnit, setDlUnit] = useState<'h' | 'd'>(initHours % 24 === 0 ? 'd' : 'h');
  const [dlValue, setDlValue] = useState(initHours % 24 === 0 ? initHours / 24 : initHours);
  const [dlLocal, setDlLocal] = useState('');
  const [tz, setTz] = useState(s.obTimezone || '');
  const [reminders, setReminders] = useState(s.obRemindersEnabled ?? true);

  async function save() {
    const hours = dlUnit === 'd' ? dlValue * 24 : dlValue;
    const obDeadlineAt = dlMode === 'fixed' && dlLocal ? zonedToUtc(dlLocal, tz).toISOString() : null;
    await api.put(`/api/searches/${s.id}/onboarding`, {
      obEnabled: enabled,
      obFlow: JSON.stringify(flow),
      obDeadlineMode: dlMode,
      obDeadlineHours: Math.min(720, Math.max(1, hours)),
      obDeadlineAt,
      obTimezone: tz,
      obRemindersEnabled: reminders,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    reload();
  }
  async function saveTemplate() {
    if (!tplName.trim()) return;
    await api.post('/api/flow-templates', { name: tplName.trim(), flow: JSON.stringify(flow) });
    setTplName('');
    setSaved2(true);
    setTimeout(() => setSaved2(false), 1500);
  }

  // ── ИИ в билдере: собрать весь онбординг + точечная помощь по блоку ──
  const [aiBusy, setAiBusy] = useState(false);
  const [aiBrief, setAiBrief] = useState('');
  const [aiMsg, setAiMsg] = useState('');

  async function generateOnboarding() {
    setAiBusy(true);
    setAiMsg('');
    try {
      const r = await api.post<{ pages: any[]; source?: string }>(`/api/searches/${s.id}/generate-onboarding`, { brief: aiBrief.trim() || undefined });
      const built: Flow = {
        pages: (r.pages || []).map((p) => ({
          ...newPage(p.title || 'Страница'),
          blocks: (p.blocks || []).map((b: any) => {
            const base = newBlock((b.type as BlockType) || 'text');
            return { ...base, ...b, id: base.id, type: base.type } as Block;
          }),
        })),
      };
      if (built.pages.length) setFlow(built);
      if (r.source === 'demo') setAiMsg('Собрано демо-движком (ИИ-ключ не подключён).');
    } catch (e: any) {
      setAiMsg(e.message);
    } finally {
      setAiBusy(false);
    }
  }

  // точечная помощь по тексту блока — пробрасывается в FlowBuilder
  const aiBlockText = async (purpose: string, current: string): Promise<string | null> => {
    try {
      const r = await api.post<{ text: string }>(`/api/searches/${s.id}/generate-block`, { purpose, current: current || undefined });
      return r.text || null;
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted">Ссылку выдашь из карточки лида во вкладке «Лиды».</div>
          <div className="flex shrink-0 items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setShowPreview(true)}>
              <Eye size={15} /> Предпросмотр
            </Button>
            <Toggle checked={enabled} onChange={setEnabled} />
          </div>
        </div>
      </div>

      {/* ИИ собирает весь онбординг под роль — быстрый старт */}
      <div className="rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles size={15} className="text-accent-ink" /> Собрать онбординг с ИИ
        </div>
        <p className="mt-0.5 text-xs text-muted">ИИ соберёт страницы и тексты под роль (знакомство → условия+тест → сдача). Останется только поправить.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input className="min-w-[12rem] flex-1" value={aiBrief} onChange={(e) => setAiBrief(e.target.value)} placeholder="Бриф (необязательно): условия, оплата, что в тесте…" />
          <Button variant="accent" size="sm" onClick={generateOnboarding} disabled={aiBusy}>
            <Sparkles size={14} /> {aiBusy ? 'Собираю…' : 'Собрать ИИ'}
          </Button>
        </div>
        {aiMsg && <p className="mt-1.5 text-xs text-warning">{aiMsg}</p>}
      </div>

      <div>
        <div className="mb-2 text-sm text-muted">Загрузить шаблон под роль (заменит текущий конструктор):</div>
        <div className="flex flex-wrap gap-2">
          {FLOW_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFlow(JSON.parse(JSON.stringify(t.flow)))}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm transition-colors hover:border-accent/50 hover:bg-panel-2"
            >
              <span>{t.emoji}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      <FlowBuilder value={flow} onChange={setFlow} ai={aiBlockText} />

      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="font-medium">Дедлайн сдачи тестового</div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Select
            className="w-44"
            value={dlMode}
            onChange={(v) => setDlMode(v as any)}
            options={[{ value: 'none', label: 'Без дедлайна' }, { value: 'relative', label: 'Через…' }, { value: 'fixed', label: 'К дате' }]}
          />
          {dlMode === 'relative' && (
            <>
              <Input type="number" className="w-20" value={dlValue} onChange={(e) => setDlValue(+e.target.value)} />
              <Select className="w-28" value={dlUnit} onChange={(v) => setDlUnit(v as any)} options={[{ value: 'h', label: 'часов' }, { value: 'd', label: 'дней' }]} />
              <span>с момента, как кандидат откроет ссылку</span>
            </>
          )}
          {dlMode === 'fixed' && (
            <input type="datetime-local" value={dlLocal} onChange={(e) => setDlLocal(e.target.value)} className="rounded-xl border border-line bg-bg px-3 py-2 text-text" />
          )}
        </div>
        {dlMode !== 'none' && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <span>Часовой пояс:</span>
            <Select className="w-72" value={tz} onChange={setTz} options={TIMEZONES.map((t) => ({ value: t.tz, label: t.label }))} />
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Кандидат увидит дедлайн, обратный отсчёт и кнопку «Добавить в календарь». По истечении — в канбане «тест просрочен».</p>

        {dlMode !== 'none' && (
          <div className="mt-3 flex items-start justify-between gap-3 border-t border-line pt-3">
            <div>
              <div className="text-sm font-medium">Email-напоминания о дедлайне</div>
              <div className="text-xs text-muted">Кто оставил email, но не сдал тест — получит 1–2 деликатных письма с обратным отсчётом и ссылкой. Поднимает доходимость.</div>
            </div>
            <Toggle checked={reminders} onChange={setReminders} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить онбординг'}</Button>
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Название шаблона" className="w-48" />
        <Button variant="ghost" onClick={saveTemplate} disabled={!tplName.trim()}>
          {saved2 ? 'В библиотеке ✓' : 'Сохранить как шаблон'}
        </Button>
      </div>

      <OnboardingFunnelBlock id={s.id} />

      {showPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setShowPreview(false)}>
          <div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex w-full items-center justify-between text-sm text-white/90">
              <span>Так увидит кандидат · мобильный вид</span>
              <button onClick={() => setShowPreview(false)} className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20">Закрыть ✕</button>
            </div>
            <IphoneMock>
              <FlowPreview flow={flow} role={s.title} />
            </IphoneMock>
          </div>
        </div>
      )}
    </div>
  );
}

function OnboardingFunnelBlock({ id }: { id: string }) {
  const [f, setF] = useState<import('@/lib/types').OnboardingFunnel | null>(null);
  useEffect(() => {
    api.get<import('@/lib/types').OnboardingFunnel>(`/api/searches/${id}/onboarding-funnel`).then(setF).catch(() => {});
  }, [id]);
  if (!f) return null;
  const base = Math.max(1, f.issued);
  const rows = [
    { title: 'Выдано ссылок', reached: f.issued },
    ...f.steps.map((st, i) => ({ title: `Шаг ${i + 1}: ${st.title}`, reached: st.reached })),
    { title: 'Завершили', reached: f.finished },
  ];
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-1 font-medium">Воронка онбординга</div>
      <p className="mb-4 text-xs text-muted">Сколько кандидатов дошло до каждого шага — видно, где отваливаются.</p>
      {f.issued === 0 ? (
        <div className="text-sm text-muted">Пока никому не выдавали ссылку.</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r, i) => {
            const pct = Math.round((r.reached / base) * 100);
            const prev = i > 0 ? rows[i - 1].reached : r.reached;
            const drop = prev - r.reached;
            return (
              <div key={i} className="flex items-center gap-3">
                <div className="w-44 shrink-0 truncate text-sm">{r.title}</div>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                <div className="w-24 shrink-0 text-right text-sm tabular-nums">
                  {r.reached} <span className="text-xs text-muted">({pct}%)</span>
                  {i > 0 && drop > 0 && <span className="ml-1 text-xs text-danger">−{drop}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Мокап iPhone (Pro, последнее поколение): титановый корпус, Dynamic Island,
// боковые кнопки, очень скруглённые углы. Внутри — экран с прокруткой контента.
function IphoneMock({ children }: { children: React.ReactNode }) {
  // Корпус фиксированной ширины; экран на всю ширину корпуса с ограниченной по
  // высоте областью прокрутки. Без aspect-ratio (он конфликтовал с max-высотой и
  // делал экран уже рамки — «кривой» вид). Контент прокручивается внутри.
  return (
    <div className="relative shrink-0" style={{ width: 336 }}>
      {/* боковые кнопки */}
      <div className="absolute -left-[3px] top-[108px] h-7 w-[3px] rounded-l-sm bg-neutral-600" />
      <div className="absolute -left-[3px] top-[156px] h-12 w-[3px] rounded-l-sm bg-neutral-600" />
      <div className="absolute -left-[3px] top-[210px] h-12 w-[3px] rounded-l-sm bg-neutral-600" />
      <div className="absolute -right-[3px] top-[150px] h-20 w-[3px] rounded-r-sm bg-neutral-600" />
      {/* корпус (титан) → чёрная рамка → экран */}
      <div className="rounded-[3.3rem] bg-gradient-to-b from-neutral-600 via-neutral-800 to-neutral-900 p-[3px] shadow-[0_30px_70px_-20px_rgba(0,0,0,0.75)]">
        <div className="rounded-[3.1rem] bg-black p-[10px]">
          <div className="relative w-full overflow-hidden rounded-[2.6rem] bg-bg" style={{ height: 'min(700px, 82vh)' }}>
            {/* Dynamic Island */}
            <div className="pointer-events-none absolute left-1/2 top-2.5 z-20 flex h-[26px] w-[90px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-2.5">
              <span className="h-2 w-2 rounded-full bg-neutral-800 ring-1 ring-neutral-700" />
            </div>
            <div className="h-full overflow-y-auto pt-2">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsStrip({ id }: { id: string }) {
  const [st, setSt] = useState<SearchStats | null>(null);
  useEffect(() => {
    api.get<SearchStats>(`/api/analytics/search/${id}`).then(setSt).catch(() => {});
  }, [id]);
  if (!st) return null;
  const items = [
    { label: 'лидов', value: st.kpi.leadsTotal },
    { label: 'за 7 дней', value: st.kpi.leads7 },
    { label: 'конверсия', value: `${st.kpi.replyRate}%` },
    { label: 'постов', value: st.kpi.postsTotal },
  ];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline gap-1.5">
          <span className="font-display text-lg font-semibold tabular-nums">{it.value}</span>
          <span className="text-xs text-muted">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
