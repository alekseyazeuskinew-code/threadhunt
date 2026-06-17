'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Sparkles, ShieldAlert, FlaskConical, Check, X, Send, ExternalLink, Eye, Upload, ImageIcon, Video, GitBranch, Layers, Play, Activity, MessageSquare, FileText, Clock, ChevronDown, ChevronRight, TrendingUp, Heart, Repeat2, Smartphone, Monitor, Loader2, Rocket, Copy, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import type { SearchDetail, ReplyTemplate, PostTemplate, PostSegment, MediaItem, Lead, SearchStats, TestPublishResult, Limits, DmStats, ActivityItem, ResearchPostRow, CompanyProfile, BrandProfile, SearchSummary } from '@/lib/types';
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
import { TIMEZONES, zonedToUtc, utcToZonedLocal } from '@/lib/timezones';
import { useAutosave, AutosaveBadge } from '@/components/ui/Autosave';
import { confirmDialog } from '@/components/ui/confirm';
import { Skeleton } from '@/components/ui/Skeleton';
import { MicButton, appendDictation } from '@/components/ui/Dictation';
import { parseContacts, tgDisplay, type TeamContact } from '@/lib/teamContacts';
import { ADS_ENABLED } from '@/lib/flags';
import { cn } from '@/lib/cn';

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

// Сворачиваемая карточка настроек: акцентная (полоса слева + иконка), в свёрнутом виде
// показывает краткую сводку статуса — чтобы не «терять» настройки в визуальном шуме.
function CollapsibleCard({
  icon,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl border border-line border-l-[3px] border-l-accent bg-panel">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-panel-2/50">
        <span className="text-accent-ink">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
        {icon && <span className="text-accent-ink">{icon}</span>}
        <span className="font-medium">{title}</span>
        {!open && summary && <span className="ml-auto truncate pl-2 text-xs text-muted">{summary}</span>}
      </button>
      {open && <div className="border-t border-line p-4">{children}</div>}
    </div>
  );
}

// Человекочитаемая ошибка вместо сырого JSON от Threads API в ленте активности.
function prettyError(raw: string): string {
  if (!raw) return '';
  let obj: any = null;
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { obj = JSON.parse(raw.slice(a, b + 1)); } catch { /* ignore */ }
  }
  const low = `${obj?.error_user_title || ''} ${obj?.message || ''} ${raw}`.toLowerCase();
  if (/media not found|cannot be found|media with id|requested resource does not exist/.test(low))
    return 'Медиа недоступно — перезалейте фото/видео в пост и опубликуйте снова';
  if (/(expired|invalid).*(token|session)|session has expired|access token/.test(low) && !/media/.test(low))
    return 'Доступ к Threads истёк — переподключите аккаунт в «Подключениях»';
  if (/rate limit|too many|limit reached|temporarily blocked/.test(low))
    return 'Threads временно ограничил публикацию — попробуйте позже';
  const msg = obj?.error_user_msg || obj?.error_user_title || obj?.message || raw;
  return String(msg).slice(0, 160);
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
  const [celebrate, setCelebrate] = useState(false); // анимация запуска сбора

  async function load() {
    setS(await api.get<SearchDetail>(`/api/searches/${id}`));
  }
  useEffect(() => {
    setS(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!s)
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  async function toggle() {
    const next = s!.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setS({ ...s!, status: next });
    await api.post(`/api/searches/${id}/toggle`);
    if (next === 'ACTIVE') setCelebrate(true); // 🚀 запуск сбора — праздничная анимация
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
              <Badge tone={s.status === 'ACTIVE' ? 'accent' : 'neutral'}>{s.status === 'ACTIVE' ? '● активен' : '○ черновик'}</Badge>
            </div>
            {s.connection?.username && <p className="mt-1 text-sm text-muted">Аккаунт @{s.connection.username}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {s.status === 'ACTIVE' ? (
              <>
                <span className="text-sm text-muted">Сбор идёт</span>
                <Toggle checked onChange={toggle} />
              </>
            ) : (
              <Button onClick={toggle}>
                <Rocket size={15} /> Запустить сбор
              </Button>
            )}
          </div>
        </div>
        <StatsStrip id={id} />
        <div className="mt-5">
          <Tabs
            active={tab}
            onChange={(k) => setTab(k as TabKey)}
            tabs={[
              { key: 'overview', label: 'Обзор' },
              { key: 'baits', label: 'Посты', count: s.postTemplates.length },
              { key: 'otbivka', label: 'Отбивка', count: s.keywords.length },
              { key: 'leads', label: 'Лиды', count: s._count?.leads ?? 0 },
            ]}
          />
        </div>
      </header>

      {/* Ширина контента: на десктопе узкая колонка выглядела зажато — даём простор.
          Лиды ещё шире (split-view конструктор + превью). */}
      <div className={tab === 'leads' ? 'max-w-6xl p-6' : 'max-w-5xl p-6'}>
        {tab === 'overview' && <OverviewTab s={s} reload={reload} status={s.status} onToggleSearch={toggle} goTo={setTab} />}
        {tab === 'otbivka' && <OtbivkaTab s={s} reload={reload} status={s.status} onToggleSearch={toggle} />}
        {tab === 'baits' && <BaitsTab s={s} reload={reload} />}
        {tab === 'leads' && <LeadsAndOnboardingTab s={s} reload={reload} id={id} />}
      </div>
      {celebrate && <LaunchCelebration title={s.title} onDone={() => setCelebrate(false)} />}
    </div>
  );
}

// Праздничная анимация запуска сбора — минималистично, с поп-эффектом и конфетти.
function LaunchCelebration({ title, onDone }: { title: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);
  const confetti = ['🎉', '✨', '🚀', '🎊', '⭐', '💫', '🟣', '🎈'];
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onDone}>
      <div className="anim-fade absolute inset-0 bg-black/40 backdrop-blur-sm" />
      {/* конфетти */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {confetti.map((c, i) => (
          <span key={i} className="th-confetti absolute text-2xl" style={{ left: `${8 + i * 11}%`, animationDelay: `${i * 0.12}s` }}>
            {c}
          </span>
        ))}
      </div>
      <div className="anim-pop relative z-10 w-full max-w-sm rounded-3xl border border-line bg-panel p-7 text-center shadow-2xl">
        <div className="th-rocket mx-auto text-5xl">🚀</div>
        <div className="mt-3 text-xl font-semibold">Сбор кандидатов запущен!</div>
        <p className="mt-1.5 text-sm text-muted">«{title}» в работе. Бот начнёт ловить отклики — кандидаты появятся в «Лидах». Удачи! 🍀</p>
        <button onClick={onDone} className="mt-5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-press">
          Отлично
        </button>
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
  async function clear() {
    if (!(await confirmDialog({ title: 'Очистить хронологию?', message: 'Удалятся записи об ошибках публикации и логи проходов бота. Лиды и успешные посты останутся.', confirmText: 'Очистить', danger: true }))) return;
    await api.post(`/api/searches/${id}/activity/clear`).catch(() => {});
    load();
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
        <div className="flex shrink-0 items-center gap-1">
          {!!items?.length && (
            <Button variant="ghost" size="sm" onClick={clear} title="Удалить ошибки и логи проходов">
              <Trash2 size={14} /> Очистить
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={load} disabled={busy}>
            {busy ? 'Обновляю…' : 'Обновить'}
          </Button>
        </div>
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
                      {it.detail && <span className="text-muted"> · {it.ok ? it.detail : prettyError(it.detail)}</span>}
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
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');

  async function loadAll() {
    const [l, st] = await Promise.all([api.get<Limits>('/api/limits'), api.get<DmStats>(`/api/searches/${searchId}/dm-stats`).catch(() => null)]);
    setLim(l);
    if (st) setStats(st);
    setReady(true);
  }
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId]);

  const persistLimits = async (v: Limits | null) => {
    if (!v) return;
    await api.put('/api/limits', {
      sweepIntervalMinutes: v.sweepIntervalMinutes,
      maxDialogsPerSweep: v.maxDialogsPerSweep,
      safeMode: v.safeMode,
      sweepMain: v.sweepMain,
      sweepRequests: v.sweepRequests,
      sweepHidden: v.sweepHidden,
    });
  };
  const autosave = useAutosave(lim, persistLimits, { enabled: ready });

  if (!lim) return <div className="rounded-2xl border border-line bg-panel p-4 text-sm text-muted">Загрузка параметров…</div>;

  const set = (patch: Partial<Limits>) => setLim({ ...lim, ...patch });
  const intervalMin = lim.caps?.intervalMin ?? 30;
  // Запуск обхода с ЖИВОЙ обратной связью: поллим статистику, пока не появится новый
  // проход, и показываем результат — чтобы было понятно, работает система или нет.
  async function runNow() {
    setRunning(true);
    setMsg('⏳ Запускаю обход директа…');
    const before = stats?.lastPass?.at ?? null;
    try {
      await api.post('/api/dm/run-now');
    } catch (e: any) {
      setMsg('Не удалось запустить: ' + (e?.message || 'ошибка'));
      setRunning(false);
      return;
    }
    setMsg('⏳ Иду по директу в фоне… (5–60 сек)');
    const t0 = Date.now();
    const poll = async () => {
      const st = await api.get<DmStats>(`/api/searches/${searchId}/dm-stats`).catch(() => null);
      if (st) setStats(st);
      const at = st?.lastPass?.at ?? null;
      if (at && at !== before) {
        setMsg(`✓ Готово: проверено ${st!.lastPass!.scanned} чатов, совпадений по словам — ${st!.lastPass!.matched}.`);
        setRunning(false);
        return;
      }
      if (Date.now() - t0 > 90_000) {
        setMsg('Расширение пока не ответило. Проверь, что оно онлайн (статус выше) и что ты залогинен в Threads в этом браузере. Обход идёт в фоне — можно обновить через минуту.');
        setRunning(false);
        return;
      }
      setTimeout(poll, 3500);
    };
    setTimeout(poll, 3500);
  }
  const lp = stats?.lastPass;
  const noSections = !lim.sweepMain && !lim.sweepRequests && !lim.sweepHidden;

  return (
    <CollapsibleCard
      icon={<Activity size={16} />}
      title="Параметры прохода"
      summary={`раз в ${lim.sweepIntervalMinutes} мин${stats ? (stats.agent.online ? ' · агент онлайн' : ' · агент офлайн') : ''}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-muted">
          Как бот обходит директ. Один обход покрывает все активные поиски аккаунта.
          {stats && (
            <span className={`ml-2 ${stats.agent.online ? 'text-success' : 'text-warning'}`}>
              ● агент {stats.agent.online ? 'онлайн' : 'офлайн'}
            </span>
          )}
        </div>
        <Button size="sm" onClick={runNow} disabled={running || noSections} className="shrink-0">
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

      {/* Research (топ-ветки) полностью переехал во вкладку «Посты» → блок «Топ веток». */}

      {lim.sweepIntervalMinutes <= intervalMin && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-warning">
          <ShieldAlert size={13} /> Частые проходы повышают риск ограничений. Безопасно — раз в 2–3 часа.
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <AutosaveBadge status={autosave} />
        {noSections && <span className="text-xs text-danger">Не сохранится без выбранного раздела.</span>}
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
    </CollapsibleCard>
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

type KwRow = { text: string; mode: string };

// Кандидаты в кодовые слова из текстов постов: слова в кавычках («Франтик», "монтаж") —
// обычно это и есть призыв «напиши X в директ». Берём одиночные слова с буквой.
function detectCodeWords(s: SearchDetail): string[] {
  const texts: string[] = [];
  for (const t of s.postTemplates || []) {
    if (t.segmentsJson) {
      try {
        const arr = JSON.parse(t.segmentsJson);
        if (Array.isArray(arr)) for (const seg of arr) if (typeof seg?.text === 'string') texts.push(seg.text);
      } catch { /* ignore */ }
    }
    if (t.text) texts.push(t.text);
  }
  const found = new Set<string>();
  const rx = /[«"„“']([^«»"„“'\n]{2,30})[»"”']/g;
  for (const txt of texts) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(txt))) {
      const w = m[1].trim().replace(/[.,!?;:]+$/, '');
      if (w && !/\s/.test(w) && /[a-zA-Zа-яА-ЯёЁ]/.test(w)) found.add(w);
    }
  }
  return [...found].slice(0, 8);
}

function KeywordsSection({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const [list, setList] = useState<KwRow[]>(
    s.keywords.length ? s.keywords.map((k) => ({ text: k.text, mode: k.mode || 'root' })) : [{ text: '', mode: 'root' }],
  );
  const [saved, setSaved] = useState(false);
  const set = (i: number, patch: Partial<KwRow>) => setList((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Подсказки из постов — те, которых ещё нет в списке.
  const suggestions = detectCodeWords(s).filter((w) => !list.some((r) => r.text.trim().toLowerCase() === w.toLowerCase()));
  const addWord = (w: string) => setList((l) => [...l.filter((r) => r.text.trim()), { text: w, mode: 'root' }]);

  const persist = async () => {
    await api.put(`/api/searches/${s.id}/keywords`, {
      keywords: list.filter((r) => r.text.trim()).map((r) => ({ text: r.text.trim(), mode: r.mode || 'root' })),
    });
    reload(); // держим `s` свежим — иначе перемонтирование вкладки покажет старое
  };
  const autosave = useAutosave(list, persist);

  async function save() {
    await persist();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Сообщения с этими словами ловятся автоматически. Режим «по корню» поймает забытое окончание («монтаж» → «монтажёр»);
        «слово целиком» — только отдельное слово; «всё сообщение» — если текст равен слову. Сам ответ настраивается ниже в «Шаблонах ответов».
      </p>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-accent/40 bg-accent-soft/40 p-2.5">
          <span className="text-xs text-muted">Нашли в постах:</span>
          {suggestions.map((w) => (
            <button
              key={w}
              onClick={() => addWord(w)}
              className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-panel px-2.5 py-1 text-xs font-medium text-accent-ink hover:bg-accent-soft"
              title="Добавить в кодовые слова"
            >
              <Plus size={11} /> {w}
            </button>
          ))}
        </div>
      )}

      {list.map((r, i) => (
        <div key={i} className="flex items-center gap-2 rounded-2xl border border-line bg-panel p-3">
          <Input className="flex-1" value={r.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="монтаж" />
          <Select className="w-56" size="sm" value={r.mode} onChange={(v) => set(i, { mode: v })} options={MATCH_MODE_OPTIONS} />
          <button onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="text-muted hover:text-danger">
            <Trash2 size={18} />
          </button>
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
  const [varyBusy, setVaryBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [contacts, setContacts] = useState<TeamContact[]>([]);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null); // редактируемый контакт
  const [nName, setNName] = useState('');
  const [nTg, setNTg] = useState('');
  const cursor = useRef<{ idx: number; start: number; end: number }>({ idx: 0, start: 0, end: 0 });
  const rememberCaret = (i: number, el: HTMLTextAreaElement) =>
    (cursor.current = { idx: i, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length });
  const [brief, setBrief] = useState(''); // контекст для ИИ (наговорить/ввести → сгенерировать)
  const set = (i: number, patch: Partial<ReplyTemplate>) => setList((l) => l.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  useEffect(() => {
    api.get<BrandProfile>('/api/brand-profile').then((b) => setContacts(parseContacts(b.teamContacts))).catch(() => {});
  }, []);

  // Контакты живут в профиле бренда, но управляются прямо здесь (PATCH только этого поля).
  async function saveContacts(next: TeamContact[]) {
    setContacts(next);
    await api.put('/api/brand-profile', { teamContacts: JSON.stringify(next) }).catch(() => {});
  }
  // Добавление ИЛИ сохранение редактируемого контакта.
  function submitContact() {
    if (!nName.trim() && !nTg.trim()) return;
    const entry = { name: nName.trim(), telegram: nTg.trim() };
    const next = editIdx != null ? contacts.map((c, j) => (j === editIdx ? entry : c)) : [...contacts, entry];
    void saveContacts(next);
    setNName('');
    setNTg('');
    setAdding(false);
    setEditIdx(null);
  }
  function startEditContact(i: number) {
    setEditIdx(i);
    setNName(contacts[i].name);
    setNTg(contacts[i].telegram);
    setAdding(true);
  }
  function openAddContact() {
    setEditIdx(null);
    setNName('');
    setNTg('');
    setAdding((v) => !v);
  }

  const persist = async () => {
    await api.put(`/api/searches/${s.id}/reply-templates`, {
      templates: list.filter((t) => t.text.trim()).map((t) => ({ text: t.text, redirectTarget: t.redirectTarget })),
    });
    reload(); // держим `s` свежим — иначе перемонтирование вкладки покажет старое
  };
  const autosave = useAutosave(list, persist);

  async function save() {
    await persist();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }
  // seed — сгенерировать ВАРИАНТЫ в духе заданного текста (кнопка «ещё варианты»).
  // brief — наговоренный/введённый контекст; если пусто, ИИ берёт контекст вакансии.
  async function generate(seed?: string) {
    const setLoad = seed ? setVaryBusy : setBusy;
    setLoad(true);
    setGenMsg('');
    try {
      const { result, source } = await api.post<{ result: string[]; source?: string }>(`/api/searches/${s.id}/generate`, { kind: 'replies', count: 4, seed, brief: brief.trim() || undefined });
      setList((l) => [...l, ...(result || []).map((text) => ({ text, redirectTarget: '' }))]);
      if (source === 'demo') setGenMsg('Сгенерировано демо-движком (ИИ-ключ не подключён).');
    } catch (e: any) {
      setGenMsg(e.message);
    } finally {
      setLoad(false);
    }
  }
  // Вставить контакт (имя + @ник) В ПОЗИЦИЮ КУРСОРА активного шаблона.
  function insertContact(c: TeamContact) {
    const tg = tgDisplay(c.telegram);
    const chunk = (c.name ? `${c.name} ${tg}` : tg).trim();
    const idx = focusedIdx;
    setList((l) =>
      l.map((t, j) => {
        if (j !== idx) return t;
        const useCaret = cursor.current.idx === idx;
        const start = useCaret ? cursor.current.start : t.text.length;
        const end = useCaret ? cursor.current.end : t.text.length;
        const before = t.text.slice(0, start);
        const after = t.text.slice(end);
        const pre = before && !/\s$/.test(before) ? ' ' : '';
        const post = after && !/^\s/.test(after) ? ' ' : '';
        return { ...t, text: before + pre + chunk + post + after };
      }),
    );
  }
  const firstText = list.find((t) => t.text.trim())?.text;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {list.filter((t) => t.text.trim()).length > 1 ? 'Несколько шаблонов — бот чередует их случайно (живее и безопаснее).' : 'Можно добавить несколько — бот будет чередовать их.'}
          {s.obLinkInReply && <span className="text-accent-ink"> К каждому ответу добавится персональная ссылка анкеты.</span>}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {firstText && (
            <Button variant="ghost" size="sm" onClick={() => generate(firstText)} disabled={varyBusy}>
              <Sparkles size={14} /> {varyBusy ? '…' : 'Ещё варианты'}
            </Button>
          )}
          <Button variant="soft" size="sm" onClick={() => generate()} disabled={busy}>
            <Sparkles size={14} /> {busy ? 'Генерирую…' : 'Сгенерировать ИИ'}
          </Button>
        </div>
      </div>

      {/* Контекст для ИИ — наговори или впиши, и сгенерируй ответы (пусто = ИИ берёт контекст вакансии) */}
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Контекст для ИИ (необязательно): тон, что просить, куда вести… или наговори 🎤"
        />
        <MicButton onText={(t) => setBrief((v) => appendDictation(v, t))} />
      </div>

      {/* Контакты команды — управляются прямо здесь; клик по чипу вставляет в активный шаблон */}
      <div className="rounded-xl border border-line bg-bg p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">Контакты команды — клик вставит «Имя @ник» в позицию курсора</span>
          <button onClick={openAddContact} className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline">
            <Plus size={12} /> контакт
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {contacts.map((c, i) => (
            <span key={i} className="group/ct inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2.5 py-1 text-xs">
              <button onClick={() => insertContact(c)} className="font-medium text-accent-ink" title={`Вставить ${tgDisplay(c.telegram)}`}>
                {c.name || tgDisplay(c.telegram)}
              </button>
              <button onClick={() => startEditContact(i)} className="text-muted opacity-0 transition group-hover/ct:opacity-100 hover:text-accent-ink" title="Редактировать">
                <Pencil size={11} />
              </button>
              <button onClick={() => saveContacts(contacts.filter((_, j) => j !== i))} className="text-muted opacity-0 transition group-hover/ct:opacity-100 hover:text-danger" title="Удалить контакт">
                <X size={11} />
              </button>
            </span>
          ))}
          {contacts.length === 0 && !adding && <span className="text-xs text-muted">пока нет — добавь сотрудника, чтобы вставлять одним кликом</span>}
        </div>
        {adding && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input className="w-40" value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Имя (Валерия)" />
            <Input className="w-52" value={nTg} onChange={(e) => setNTg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitContact()} placeholder="@valeriyatargetpoint" />
            <Button size="sm" onClick={submitContact}>{editIdx != null ? 'Сохранить' : 'Добавить'}</Button>
            <button onClick={() => { setAdding(false); setEditIdx(null); }} className="text-xs text-muted hover:text-text">отмена</button>
          </div>
        )}
      </div>

      {genMsg && <p className="text-xs text-warning">{genMsg}</p>}
      {list.map((t, i) => (
        <div key={i} className={cn('rounded-2xl border bg-panel p-4', i === focusedIdx ? 'border-accent/40' : 'border-line')}>
          <div className="flex items-start gap-2">
            <Textarea
              className="flex-1"
              value={t.text}
              onFocus={(e) => { setFocusedIdx(i); rememberCaret(i, e.currentTarget); }}
              onSelect={(e) => rememberCaret(i, e.currentTarget)}
              onChange={(e) => { set(i, { text: e.target.value }); rememberCaret(i, e.currentTarget); }}
              placeholder="Привет! Спасибо за отклик…"
            />
            <button onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="mt-1 text-muted hover:text-danger" title="Удалить шаблон">
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

  // Автосохранение всех полей правила (включая текст и режим, а не только тумблер).
  const autosave = useAutosave({ enabled, mode, replyText }, async (v) => {
    await api.put(`/api/searches/${s.id}/comment-rule`, v);
    reload(); // держим `s` свежим — иначе перемонтирование вкладки покажет старое
  });

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-muted">На все комментарии или только с кодовым словом.</div>
        <Toggle checked={enabled} onChange={setEnabled} />
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
        <div className="mb-1.5 flex items-center justify-end">
          <MicButton onText={(t) => setReplyText((v) => appendDictation(v, t))} />
        </div>
        <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Напр.: Привет! Спасибо за интерес 🙌 Напиши кодовое слово в директ — пришлю детали. (или наговори 🎤)" />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <AutosaveBadge status={autosave} />
      </div>

      <p className="mt-3 rounded-lg bg-warning/5 px-3 py-2 text-xs text-warning">
        Требует доступа Meta (threads_read_replies / threads_manage_replies) — включится после одобрения и переподключения аккаунта. Настройки можно сохранить заранее.
      </p>
    </div>
  );
}

// ───────────────────────────── ПРИМАНКИ ─────────────────────────────
// Посты с медиа/каруселью/цепочками + расписание + тест/публикация.
// (Реклама Meta скрыта до запуска — см. ADS_ENABLED.)
function BaitsTab({ s, reload }: { s: SearchDetail; reload: () => void }) {
  return (
    <div className="space-y-8">
      <PostsSection s={s} reload={reload} />
      {ADS_ENABLED && (
        <div>
          <SectionTitle icon={<Layers size={16} />} title="Реклама" hint="Платное продвижение приманок через Meta." />
          <CampaignsManager fixedSearchId={s.id} searches={[{ id: s.id, title: s.title } as any]} />
        </div>
      )}
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

  // Продублировать медиа в корневой пост КАЖDOГО шаблона — чтобы не грузить одни и те
  // же фото/видео под каждым из 5 сгенерированных постов вручную.
  async function applyMediaToAll(mediaToCopy: MediaItem[]) {
    if (!mediaToCopy.length || list.length < 2) return;
    const ok = await confirmDialog({
      title: 'Применить медиа ко всем постам?',
      message: `Это же медиа (${mediaToCopy.length} файл(а/ов)) встанет в корневой пост каждого из ${list.length} постов. Медиа, добавленное в других постах, будет заменено.`,
      confirmText: 'Применить ко всем',
    });
    if (!ok) return;
    setList((l) => l.map((t) => ({ ...t, segments: t.segments.map((sg, k) => (k === 0 ? { ...sg, media: mediaToCopy.map((m) => ({ ...m })) } : sg)) })));
  }

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
    if (!(await confirmDialog({ title: 'Опубликовать сейчас?', message: 'Реальный пост (или цепочка) будет опубликован в Threads от твоего аккаунта прямо сейчас.', confirmText: 'Опубликовать' }))) return;
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

  // Сохраняем как цепочки сегментов (карусель + ветки). После сохранения обновляем `s`
  // в родителе — иначе при переключении вкладок секция перемонтируется и возьмёт
  // устаревшие шаблоны (без только что добавленного медиа), а следующий автосейв затрёт
  // медиа пустым списком. reload держит источник правды свежим.
  const persist = async () => {
    await api.put(`/api/searches/${s.id}/post-templates`, {
      templates: list
        .map((t) => ({ segments: t.segments.filter((sg) => sg.text.trim() || sg.media.length) }))
        .filter((t) => t.segments.length)
        .map((t) => ({ segments: t.segments })),
    });
    await api.patch(`/api/searches/${s.id}/publish-config`, cfg);
    reload();
  };
  const autosave = useAutosave({ list, cfg }, persist);

  async function save() {
    await persist();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
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

  // Поля времени/количества держим как СТРОКИ — иначе значение пересчитывается из
  // intervalMinutes на каждый ввод, и нельзя стереть/заменить первые цифры.
  const [hStr, setHStr] = useState(() => String(Math.floor(((s.publishConfig?.intervalMinutes) ?? 240) / 60)));
  const [mStr, setMStr] = useState(() => String(((s.publishConfig?.intervalMinutes) ?? 240) % 60));
  const [perDayStr, setPerDayStr] = useState(() => String(s.publishConfig?.maxPerDay ?? 5));
  const applyInterval = (h: string, m: string) => {
    const hh = Math.max(0, parseInt(h || '0', 10) || 0);
    const mm = Math.min(59, Math.max(0, parseInt(m || '0', 10) || 0));
    setCfg((c) => ({ ...c, intervalMinutes: hh * 60 + mm }));
  };

  // Карточка автопубликации (расписание + тест/публикация). Выделена в переменную,
  // чтобы держать её внизу вкладки — после того, как посты написаны.
  const autoPublishCard = (
      <>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted">Бот сам постит приманки по расписанию через официальный API.</div>
          <div className="flex shrink-0 items-center gap-3">
            <span className={`text-sm font-medium ${cfg.enabled ? 'text-success' : 'text-muted'}`}>{cfg.enabled ? 'Включён' : 'Выключен'}</span>
            <Toggle checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted">
          <label className="flex items-center gap-2">
            раз в
            <Input
              type="text"
              inputMode="numeric"
              className="w-16"
              value={hStr}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setHStr(v); applyInterval(v, mStr); }}
            />
            ч
            <Input
              type="text"
              inputMode="numeric"
              className="w-16"
              value={mStr}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 2); setMStr(v); applyInterval(hStr, v); }}
            />
            мин
          </label>
          <label className="flex items-center gap-2">
            не больше
            <Input
              type="text"
              inputMode="numeric"
              className="w-20"
              value={perDayStr}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 3); setPerDayStr(v); setCfg((c) => ({ ...c, maxPerDay: parseInt(v || '0', 10) || 0 })); }}
            />
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
      </>
  );

  return (
    <div className="space-y-5">
      {/* ── 1. Генерация постов с ИИ — свёрнута, чтобы не перегружать вкладку ── */}
      <CollapsibleCard icon={<Sparkles size={16} />} title="Генерация постов с ИИ" summary="ИИ напишет варианты по брифу">
        <p className="mb-3 -mt-1 text-sm text-muted">Опиши условия вакансии — ИИ напишет несколько вариантов. Они добавятся в список «Посты» ниже.</p>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Бриф (необязательно)</div>
          <MicButton onText={(t) => setBrief((v) => appendDictation(v, t))} />
        </div>
        <p className="mb-2 text-xs text-muted">Оплата/цена, формат и занятость, куда писать, дедлайн, кодовое слово. ИИ впишет это в посты.</p>
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Напр.: монтажёр Reels, 15–20 роликов/нед, 500₽ за ролик, удалёнка, кодовое слово «монтаж», дедлайн пятница (или наговори 🎤)"
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
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={chainMode} onChange={(e) => setChainMode(e.target.checked)} />
          <span className="inline-flex items-center gap-1"><GitBranch size={14} /> Цепочки веток (пост + ответвления)</span>
        </label>
        <Button variant="primary" className="mt-4 w-full" onClick={generate} disabled={busy}>
          <Sparkles size={15} /> {busy ? 'Генерирую…' : chainMode ? 'Сгенерировать цепочки веток' : 'Сгенерировать посты'}
        </Button>
        {genMsg && <p className="mt-2 text-xs text-warning">{genMsg}</p>}
      </CollapsibleCard>

      {/* ── 2. Публикация — расписание/сроки. Свёрнута; в шапке краткий статус. ── */}
      <CollapsibleCard
        icon={<Send size={16} />}
        title="Публикация"
        summary={cfg.enabled ? `вкл · раз в ${parseInt(hStr || '0', 10)}ч${mStr && mStr !== '0' ? ' ' + mStr + 'м' : ''} · до ${parseInt(perDayStr || '0', 10)}/день` : 'выключена'}
      >
        {autoPublishCard}
      </CollapsibleCard>

      {/* ── 3. Вдохновение: топ-ветки. Кнопка «в ИИ-бриф» подставит приём в бриф выше. ── */}
      <ResearchPanel searchId={s.id} onUse={(t) => setBrief('Сделай в духе этой залетевшей ветки (не копируй дословно, возьми приём/тон):\n' + t)} />

      {/* ── 4. Посты ── */}
      <SectionTitle icon={<FileText size={16} />} title="Посты" hint="Тексты приманок. Несколько медиа в посте = карусель, ветка под веткой = цепочка." />

      {/* Шаблоны постов. Опубликованные подсвечиваем серым + бейдж — видно, что уже вышло. */}
      {list.map((t, ti) => {
        const publishedAt = s.postTemplates[ti]?.lastPublishedAt;
        return (
        <div key={ti} className={cn('rounded-2xl border border-line p-4', publishedAt ? 'bg-panel-2/60' : 'bg-panel')}>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-muted">
              <span className="inline-flex items-center gap-1.5">
                {t.segments.length > 1 ? (
                  <><GitBranch size={13} /> Цепочка из {t.segments.length}</>
                ) : (
                  <>Пост</>
                )}
              </span>
              {publishedAt && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                  <Check size={11} /> опубликован {relTime(publishedAt)}
                </span>
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
                  onApplyAll={si === 0 && list.length > 1 ? applyMediaToAll : undefined}
                  applyAllCount={list.length}
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
        );
      })}

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
const RESEARCH_WINDOWS = [
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё время' },
];
// 1234 → «1.2K», 1200000 → «1.2M» (компактные счётчики вовлечённости).
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function fmtPostDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
  } catch {
    return '';
  }
}
type ResearchDiag = { q?: string; ext?: string; url?: string; postLinks?: number; userPostLinks?: number; pressable?: number; articles?: number; anchors?: number; bodyLen?: number; sample?: string[]; buttons?: { label: string; text: string; next: string }[]; htmlSample?: string; collected?: number };
type ResearchResp = { posts: ResearchPostRow[]; running: boolean; lastAt: string | null; lastRunAt?: string | null; diag?: ResearchDiag | null };
function ResearchPanel({ searchId, onUse }: { searchId: string; onUse: (text: string) => void }) {
  const [resp, setResp] = useState<ResearchResp | null>(null);
  const [open, setOpen] = useState(false);
  const [win, setWin] = useState<'week' | 'month' | 'all'>('month');
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectMsg, setCollectMsg] = useState('');
  // Настройки авто-сбора (перенесены сюда из «Отбивки» — чтобы вся research-логика была вместе).
  const [rEnabled, setREnabled] = useState<boolean | null>(null);
  const [rByKw, setRByKw] = useState(false);
  useEffect(() => {
    api.get<Limits>('/api/limits').then((l) => { setREnabled(!!l.researchEnabled); setRByKw(!!l.researchByKeywords); }).catch(() => setREnabled(false));
  }, []);
  const saveResearch = (patch: { researchEnabled?: boolean; researchByKeywords?: boolean }) => api.put('/api/limits', patch).catch(() => {});
  // Запустить сбор топ-веток прямо отсюда (рядом с результатом) — расширение откроет
  // вкладку Threads в фоне и соберёт ветки.
  async function collectNow() {
    setCollectBusy(true);
    setCollectMsg('');
    try {
      await api.post('/api/research/run-now');
      try { window.postMessage({ source: 'threadhunt-cmd', cmd: 'research-now' }, window.location.origin); } catch {}
      setCollectMsg('Запущено — расширение соберёт топ-ветки в фоне (1–3 мин). Нужен залогиненный Threads в этом браузере.');
      setOpen(true);
      setTimeout(() => load(true), 2500);
    } catch (e: any) {
      setCollectMsg(e.message);
    } finally {
      setCollectBusy(false);
    }
  }
  useEffect(() => {
    try {
      const w = localStorage.getItem('th_research_window');
      if (w === 'week' || w === 'month' || w === 'all') setWin(w);
    } catch {}
  }, []);
  const load = (silent = false) => {
    if (!silent) setResp(null);
    return api.get<ResearchResp>(`/api/searches/${searchId}/research?window=${win}`).then(setResp).catch(() => setResp({ posts: [], running: false, lastAt: null }));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId, win]);
  // Пока идёт сбор — мягко опрашиваем сервер, чтобы статус и ветки обновлялись вживую.
  useEffect(() => {
    if (!resp?.running) return;
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp?.running, searchId, win]);

  const posts = resp?.posts ?? [];
  const winLabel = RESEARCH_WINDOWS.find((w) => w.value === win)?.label.toLowerCase();
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setOpen((v) => !v)} className="flex flex-1 items-center gap-2 text-left">
          <span className="text-accent-ink">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
          <TrendingUp size={16} className="shrink-0 text-accent-ink" />
          <span className="font-semibold">Топ веток · {winLabel}</span>
          {posts.length > 0 && <span className="text-xs text-muted">· {posts.length}</span>}
          {resp?.running ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-ink">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> идёт сбор…
            </span>
          ) : resp?.lastAt ? (
            <span className="text-xs text-muted">· обновлено {relTime(resp.lastAt)}</span>
          ) : null}
        </button>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-line">
          {RESEARCH_WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => {
                setWin(w.value as any);
                try { localStorage.setItem('th_research_window', w.value); } catch {}
              }}
              className={`px-2.5 py-1 text-xs transition-colors ${win === w.value ? 'bg-accent text-on-accent' : 'text-muted hover:bg-panel-2'}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={collectNow} disabled={collectBusy || resp?.running} className="shrink-0">
          <TrendingUp size={14} /> {collectBusy || resp?.running ? 'Собираю…' : 'Собрать сейчас'}
        </Button>
      </div>
      {collectMsg && <p className="mt-2 text-xs text-muted">{collectMsg}</p>}

      {/* Авто-сбор раз в ~12ч (перенесено из «Отбивки»). */}
      {rEnabled !== null && (
        <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={rEnabled} onChange={(e) => { setREnabled(e.target.checked); void saveResearch({ researchEnabled: e.target.checked }); }} />
          Авто-сбор раз в ~12 ч
          {rEnabled && (
            <>
              <span>· искать по</span>
              <Select
                size="sm"
                className="w-44"
                value={rByKw ? 'keywords' : 'role'}
                onChange={(v) => { const kw = v === 'keywords'; setRByKw(kw); void saveResearch({ researchByKeywords: kw }); }}
                options={[{ value: 'role', label: 'названию роли' }, { value: 'keywords', label: 'кодовым словам' }]}
              />
            </>
          )}
        </label>
      )}
      {resp !== null && open && (
        <div className="mt-3">
          {/* Живой индикатор сбора + полоса прогресса */}
          {resp.running && (
            <div className="mb-3 rounded-xl border border-accent/30 bg-accent-soft/50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm text-accent-ink">
                <Loader2 size={15} className="animate-spin" />
                <span>Идёт сбор веток из Threads… 1–3 минуты. Список и метрики обновляются сами.</span>
              </div>
              <div className="th-progress mt-2 h-1 w-full rounded-full bg-accent/15" />
            </div>
          )}
          {posts.length === 0 ? (
            !resp.running && (
              <p className="text-sm text-muted">
                {resp.lastRunAt
                  ? `Последний сбор был ${relTime(resp.lastRunAt)}, но Threads не отдал ветки в этом окне. Попробуй сменить окно на «Всё время» или запусти ещё раз.`
                  : 'Пока пусто. Включи Research во вкладке «Отбивка» и нажми «Собрать топ-ветки сейчас» (нужен залогиненный Threads в браузере).'}
              </p>
            )
          ) : (
            <div className="space-y-2.5">
              {posts.map((r, i) => (
                <div key={r.id} className="rounded-2xl border border-line bg-bg p-3.5">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel-2 text-sm font-bold text-muted">{(r.author || '?').charAt(0).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="truncate font-semibold">@{r.author || '—'}</span>
                        {r.postedAt && <span className="shrink-0 text-xs text-muted">· {fmtPostDate(r.postedAt)}</span>}
                        {i < 3 && <span className="ml-auto shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">🔥 топ</span>}
                      </div>
                      <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-snug text-text">{r.text}</p>
                      <div className="mt-2.5 flex items-center gap-4 text-xs text-muted">
                        <span className="inline-flex items-center gap-1"><Heart size={13} /> {fmtNum(r.likes)}</span>
                        <span className="inline-flex items-center gap-1"><MessageSquare size={13} /> {fmtNum(r.replies)}</span>
                        <span className="inline-flex items-center gap-1"><Repeat2 size={13} /> {fmtNum(r.reposts)}</span>
                        <div className="ml-auto flex items-center gap-3">
                          {r.permalink && (
                            <a href={r.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted hover:text-text">
                              Открыть <ExternalLink size={11} />
                            </a>
                          )}
                          <button onClick={() => onUse(r.text)} className="font-medium text-accent-ink hover:underline">
                            в ИИ-бриф →
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {resp.diag && (
            <details className="mt-3 rounded-xl border border-line bg-bg p-3 text-xs">
              <summary className="cursor-pointer font-medium text-muted">Диагностика сбора (для разработчика)</summary>
              <div className="mt-2 space-y-1 text-muted">
                <div>Версия расширения: <b className="text-text">{resp.diag.ext || '—'}</b> · Страница: <code className="text-text">{resp.diag.url}</code></div>
                <div>
                  Ссылок на пост: <b className="text-text">{resp.diag.postLinks}</b> · @-пост: <b className="text-text">{resp.diag.userPostLinks}</b> · pressable: <b className="text-text">{resp.diag.pressable}</b> · article: <b className="text-text">{resp.diag.articles}</b> · всего ссылок: <b className="text-text">{resp.diag.anchors}</b> · текст: <b className="text-text">{resp.diag.bodyLen}</b> · собрано: <b className="text-text">{resp.diag.collected}</b>
                </div>
                {resp.diag.buttons && resp.diag.buttons.length > 0 && (
                  <div className="mt-1">
                    <div className="font-medium text-text">Кнопки первого поста (label → текст → сосед):</div>
                    <div className="mt-1 space-y-0.5">
                      {resp.diag.buttons.map((b, i) => (
                        <div key={i} className="break-all">
                          <code className="text-accent-ink">{b.label || '∅'}</code> → <code className="text-text">{b.text || '∅'}</code> → <code className="text-muted">{b.next || '∅'}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {resp.diag.sample && resp.diag.sample.length > 0 && (
                  <div className="break-all">Примеры ссылок: <code className="text-text">{resp.diag.sample.join('  ·  ')}</code></div>
                )}
                {resp.diag.htmlSample && (
                  <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-panel-2 p-2 text-[10px] text-text">{resp.diag.htmlSample}</pre>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// Здравый предел на файл (защита от случайного выбора гигантского файла). При R2 большие
// видео грузятся напрямую в облако; если R2 нет — api.upload сам отклонит файлы >100 МБ
// с понятной подсказкой. 1.5 ГБ — потолок видео в Threads.
const MAX_UPLOAD_MB = 1500;

function MediaEditor({
  media,
  onChange,
  onApplyAll,
  applyAllCount,
}: {
  media: MediaItem[];
  onChange: (m: MediaItem[]) => void;
  onApplyAll?: (m: MediaItem[]) => void; // «применить это медиа ко всем постам»
  applyAllCount?: number; // сколько постов всего (для подписи кнопки)
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progLabel, setProgLabel] = useState('');
  const [err, setErr] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState('');
  const [urlType, setUrlType] = useState<'image' | 'video'>('image');
  const [lightbox, setLightbox] = useState<MediaItem | null>(null); // открытое на просмотр медиа
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(files: FileList | null) {
    if (!files || !files.length) return;
    const arr = Array.from(files);
    // Заранее отсекаем слишком тяжёлые файлы — с понятным сообщением, не доводя до 500.
    const tooBig = arr.find((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    if (tooBig) {
      setErr(`«${tooBig.name}» — ${(tooBig.size / 1024 / 1024).toFixed(0)} МБ. Слишком большой файл — сожми видео (HandBrake/CapCut, 1080p, H.264) и загрузи снова.`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    setErr('');
    try {
      const added: MediaItem[] = [];
      for (let i = 0; i < arr.length; i++) {
        setProgLabel(arr.length > 1 ? `Файл ${i + 1} из ${arr.length}` : '');
        setProgress(0);
        const r = await api.upload(arr[i], setProgress);
        added.push({ url: r.url, type: r.type });
      }
      onChange([...media, ...added]);
    } catch (e: any) {
      setErr(e.message || 'Не удалось загрузить');
    } finally {
      setUploading(false);
      setProgress(0);
      setProgLabel('');
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
        {/* Продублировать это медиа во все посты — чтобы не грузить одно и то же под каждым. */}
        {onApplyAll && media.length > 0 && !uploading && (
          <button
            type="button"
            onClick={() => onApplyAll(media)}
            title="Поставить это же фото/видео во все посты этого поиска"
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline"
          >
            <Copy size={13} /> Применить ко всем постам{applyAllCount && applyAllCount > 1 ? ` (${applyAllCount})` : ''}
          </button>
        )}
      </div>

      {/* Реальный прогресс загрузки (XHR upload.onprogress). */}
      {uploading && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between text-xs text-muted">
            <span>{progLabel || 'Загрузка…'}</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-accent transition-all duration-150" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

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
  // Предзаполняем поле фиксированной даты из сохранённого дедлайна (иначе автосейв
  // мог бы затереть сохранённую дату пустым значением).
  const [dlLocal, setDlLocal] = useState(() => (s.obDeadlineMode === 'fixed' && s.obDeadlineAt ? utcToZonedLocal(s.obDeadlineAt, s.obTimezone || '') : ''));
  const [tz, setTz] = useState(s.obTimezone || '');
  const [reminders, setReminders] = useState(s.obRemindersEnabled ?? true);
  const [linkInReply, setLinkInReply] = useState(s.obLinkInReply ?? false);
  const [device, setDevice] = useState<'phone' | 'desktop'>('phone'); // режим живого превью
  // Для предпросмотра «О компании» / «Другие вакансии» — реальные данные бренда и позиций.
  const [brand, setBrand] = useState<CompanyProfile | null>(null);
  const [positions, setPositions] = useState<string[]>([]);
  useEffect(() => {
    api.get<BrandProfile>('/api/brand-profile').then((b) => setBrand({ name: b.companyName, niche: b.niche, about: b.about, perks: b.perks, social: b.social })).catch(() => {});
    api.get<SearchSummary[]>('/api/searches').then((rows) => setPositions(rows.filter((r) => r.id !== s.id && r.status === 'ACTIVE').map((r) => r.title))).catch(() => {});
  }, [s.id]);

  // Правка блока прямо из живого превью (клик по тексту/заголовку → редактирование на месте).
  const editBlock = (blockId: string, patch: Partial<Block>) =>
    setFlow((f) => ({ ...f, pages: f.pages.map((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) })) }));

  // Гибкая структура прямо в превью: подвинуть/удалить/добавить блок, добавить шаг.
  const flowControls = {
    move: (blockId: string, dir: -1 | 1) =>
      setFlow((f) => ({
        ...f,
        pages: f.pages.map((p) => {
          const i = p.blocks.findIndex((b) => b.id === blockId);
          if (i < 0) return p;
          const j = i + dir;
          if (j < 0 || j >= p.blocks.length) return p;
          const blocks = [...p.blocks];
          [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
          return { ...p, blocks };
        }),
      })),
    remove: (blockId: string) => setFlow((f) => ({ ...f, pages: f.pages.map((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== blockId) })) })),
    add: (afterBlockId: string, type: BlockType) =>
      setFlow((f) => ({
        ...f,
        pages: f.pages.map((p) => {
          const i = p.blocks.findIndex((b) => b.id === afterBlockId);
          if (i < 0) return p;
          const blocks = [...p.blocks];
          blocks.splice(i + 1, 0, newBlock(type));
          return { ...p, blocks };
        }),
      })),
  };
  const addBlockToPage = (pageIdx: number, type: BlockType) =>
    setFlow((f) => ({ ...f, pages: f.pages.map((p, i) => (i === pageIdx ? { ...p, blocks: [...p.blocks, newBlock(type)] } : p)) }));
  const addPage = () => setFlow((f) => ({ ...f, pages: [...f.pages, newPage(`Шаг ${f.pages.length + 1}`)] }));
  // Drag-and-drop: перенос блока относительно целевого (в пределах текущей страницы).
  const reorderBlock = (fromId: string, toId: string, before: boolean) =>
    setFlow((f) => ({
      ...f,
      pages: f.pages.map((p) => {
        if (!p.blocks.some((b) => b.id === fromId) || !p.blocks.some((b) => b.id === toId)) return p;
        const blocks = p.blocks.slice();
        const [moved] = blocks.splice(blocks.findIndex((b) => b.id === fromId), 1);
        const t = blocks.findIndex((b) => b.id === toId);
        blocks.splice(before ? t : t + 1, 0, moved);
        return { ...p, blocks };
      }),
    }));
  // Поставить блок-таймер на первую и последнюю страницу (если ещё нет).
  const ensureDeadlineBlocks = () =>
    setFlow((f) => {
      if (!f.pages.length) return f;
      const last = f.pages.length - 1;
      return {
        ...f,
        pages: f.pages.map((p, i) => {
          const edge = i === 0 || i === last;
          if (!edge || p.blocks.some((b) => b.type === 'deadline')) return p;
          const blk = newBlock('deadline');
          return { ...p, blocks: i === 0 ? [blk, ...p.blocks] : [...p.blocks, blk] };
        }),
      };
    });

  // Демо-дедлайн для живого превью (из текущих настроек срока сдачи). Считаем в эффекте,
  // чтобы не было рассинхрона SSR/CSR из-за Date.now().
  const [previewDeadline, setPreviewDeadline] = useState<string | null>(null);
  useEffect(() => {
    const hrs = dlUnit === 'd' ? dlValue * 24 : dlValue;
    if (dlMode === 'relative' && hrs > 0) setPreviewDeadline(new Date(Date.now() + hrs * 3_600_000).toISOString());
    else if (dlMode === 'fixed' && dlLocal) {
      try {
        setPreviewDeadline(zonedToUtc(dlLocal, tz).toISOString());
      } catch {
        setPreviewDeadline(null);
      }
    } else setPreviewDeadline(null);
  }, [dlMode, dlUnit, dlValue, dlLocal, tz]);

  // Единый сериализатор онбординга для сохранения.
  const buildPayload = (v: { enabled: boolean; flow: Flow; dlMode: typeof dlMode; dlUnit: typeof dlUnit; dlValue: number; dlLocal: string; tz: string; reminders: boolean; linkInReply: boolean }) => {
    const hours = v.dlUnit === 'd' ? v.dlValue * 24 : v.dlValue;
    const obDeadlineAt = v.dlMode === 'fixed' && v.dlLocal ? zonedToUtc(v.dlLocal, v.tz).toISOString() : null;
    return {
      obEnabled: v.enabled,
      obFlow: JSON.stringify(v.flow),
      obDeadlineMode: v.dlMode,
      obDeadlineHours: Math.min(720, Math.max(1, hours)),
      obDeadlineAt,
      obTimezone: v.tz,
      obRemindersEnabled: v.reminders,
      obLinkInReply: v.linkInReply,
    };
  };

  // Автосохранение всего онбординга (флоу + дедлайн + напоминания). Никаких потерь
  // при переключении вкладок.
  const autosave = useAutosave({ enabled, flow, dlMode, dlUnit, dlValue, dlLocal, tz, reminders, linkInReply }, async (v) => {
    await api.put(`/api/searches/${s.id}/onboarding`, buildPayload(v));
  }, { delay: 1200 });

  async function save() {
    await api.put(`/api/searches/${s.id}/onboarding`, buildPayload({ enabled, flow, dlMode, dlUnit, dlValue, dlLocal, tz, reminders, linkInReply }));
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
      // Преднастроенная страница презентации компании — всегда первой.
      if (built.pages.length) {
        built.pages.unshift({ ...newPage('О компании'), blocks: [newBlock('company'), newBlock('positions')] });
        setFlow(built);
      }
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
    <div className="lg:flex lg:gap-6">
      <div className="min-w-0 space-y-5 lg:flex-1">
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted">Ссылку выдашь из карточки лида во вкладке «Лиды».</div>
          <div className="flex shrink-0 items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setShowPreview(true)} className="lg:hidden">
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
          <MicButton onText={(t) => setAiBrief((v) => appendDictation(v, t))} />
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
          <button onClick={ensureDeadlineBlocks} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-medium text-accent-ink hover:bg-accent-soft">
            <Clock size={13} /> Поставить таймер на первую и последнюю страницу
          </button>
        )}

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

      {/* Персональная ссылка онбординга в ответ директа */}
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">Ссылка онбординга в ответе директа</div>
            <div className="mt-0.5 text-sm text-muted">
              Когда бот отвечает на кодовое слово, в конец сообщения автоматически добавится <b>персональная</b> ссылка на эту анкету — у каждого кандидата своя. Прогресс по нему виден в «Лидах» и воронке.
            </div>
          </div>
          <Toggle checked={linkInReply} onChange={setLinkInReply} />
        </div>
        {linkInReply && !enabled && <p className="mt-2 text-xs text-warning">Включите сам онбординг выше — иначе ссылку прикреплять некуда.</p>}
        {linkInReply && enabled && (
          <p className="mt-2 text-xs text-muted">Кандидату уйдёт, напр.: «…ваш текст…\n\n→ Заполни короткую анкету: …/c/ob_xxx». Ссылка резолвится по человеку автоматически — вручную ничего не нужно.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить онбординг'}</Button>
        <AutosaveBadge status={autosave} />
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Название шаблона" className="w-48" />
        <Button variant="ghost" onClick={saveTemplate} disabled={!tplName.trim()}>
          {saved2 ? 'В библиотеке ✓' : 'Сохранить как шаблон'}
        </Button>
      </div>

      <OnboardingFunnelBlock id={s.id} />
      </div>

      {/* ── ПРАВО: живое превью (десктоп) — обновляется на каждое изменение слева.
          Ширина колонки зависит от устройства: телефон ~380, компьютер ~760. ── */}
      <div className="mt-6 hidden shrink-0 lg:mt-0 lg:block" style={{ width: device === 'desktop' ? 760 : 380 }}>
        <div className="sticky top-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Превью вживую</div>
            <div className="flex rounded-full border border-line p-0.5 text-xs">
              <button onClick={() => setDevice('phone')} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${device === 'phone' ? 'bg-accent-soft text-accent-ink' : 'text-muted'}`}>
                <Smartphone size={13} /> Телефон
              </button>
              <button onClick={() => setDevice('desktop')} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${device === 'desktop' ? 'bg-accent-soft text-accent-ink' : 'text-muted'}`}>
                <Monitor size={13} /> Комп
              </button>
            </div>
          </div>

          {/* Палитра акцентного цвета — перекрашивает превью на лету */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">Цвет:</span>
            {['#6d5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#111827'].map((c) => (
              <button key={c} onClick={() => setFlow({ ...flow, accent: c })} style={{ background: c }} className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${flow.accent === c ? 'border-text' : 'border-transparent'}`} title={c} />
            ))}
            <input type="color" value={flow.accent || '#6d5cf6'} onChange={(e) => setFlow({ ...flow, accent: e.target.value })} className="h-6 w-6 cursor-pointer rounded-full border border-line bg-transparent p-0" title="Свой цвет" />
            {flow.accent && (
              <button onClick={() => setFlow({ ...flow, accent: undefined })} className="text-xs text-muted hover:text-text">
                сброс
              </button>
            )}
          </div>

          {/* Кадр устройства */}
          {device === 'phone' ? (
            <div className="mx-auto w-[360px] overflow-hidden rounded-[2.4rem] border-[7px] border-neutral-800 bg-bg shadow-xl">
              <div className="h-[620px] overflow-y-auto">
                <FlowPreview flow={flow} role={s.title} company={brand} positions={positions} device="phone" onEdit={editBlock} controls={flowControls} onAddPage={addPage} onAddBlockToPage={addBlockToPage} onReorder={reorderBlock} deadline={previewDeadline} timezone={tz} />
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-bg shadow-xl">
              <div className="flex items-center gap-1.5 border-b border-line bg-panel-2 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
                <span className="ml-3 truncate rounded bg-bg px-3 py-0.5 text-[11px] text-muted">{s.title} · отклик на роль</span>
              </div>
              <div className="h-[620px] overflow-y-auto">
                <FlowPreview flow={flow} role={s.title} company={brand} positions={positions} device="desktop" onEdit={editBlock} controls={flowControls} onAddPage={addPage} onAddBlockToPage={addBlockToPage} onReorder={reorderBlock} deadline={previewDeadline} timezone={tz} />
              </div>
            </div>
          )}
          <p className="text-center text-[11px] text-muted">Клик по тексту — правка · наведи на блок: ↑↓ порядок, 🗑 удалить, «+ блок» — добавить вопрос · цифры сверху — шаги</p>
        </div>
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-6 backdrop-blur-sm" onClick={() => setShowPreview(false)}>
          <div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex w-full items-center justify-between text-sm text-white/90">
              <span>Так увидит кандидат · мобильный вид</span>
              <button onClick={() => setShowPreview(false)} className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20">Закрыть ✕</button>
            </div>
            <IphoneMock>
              <FlowPreview flow={flow} role={s.title} company={brand} positions={positions} />
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
// Статус-бар iPhone: время слева, сигнал/wifi/батарея справа (как на реальном экране).
function PhoneStatusBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-7 pt-3.5 text-text">
      <span className="text-[13px] font-semibold tracking-tight">9:41</span>
      <div className="flex items-center gap-1.5">
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden>
          <rect x="0" y="7.5" width="3" height="3.5" rx="1" />
          <rect x="4.7" y="5" width="3" height="6" rx="1" />
          <rect x="9.4" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="14" y="0" width="3" height="11" rx="1" />
        </svg>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor" aria-hidden>
          <path d="M8 2c2.3 0 4.4.85 6 2.25l-1.3 1.5A7 7 0 0 0 8 4a7 7 0 0 0-4.7 1.75L2 4.25A9 9 0 0 1 8 2Z" />
          <path d="M8 5.7c1.25 0 2.4.45 3.25 1.2l-1.4 1.55A2.6 2.6 0 0 0 8 7.7c-.65 0-1.3.27-1.75.75L4.85 6.9A4.6 4.6 0 0 1 8 5.7Z" />
          <circle cx="8" cy="9.6" r="1.15" />
        </svg>
        <span className="relative inline-block h-[11px] w-[22px] rounded-[3px] border-[1.5px] border-current">
          <span className="absolute inset-y-[1.5px] left-[1.5px] w-[12px] rounded-[1px] bg-current" />
          <span className="absolute -right-[3px] top-1/2 h-[4px] w-[2px] -translate-y-1/2 rounded-r-sm bg-current opacity-70" />
        </span>
      </div>
    </div>
  );
}

function IphoneMock({ children }: { children: React.ReactNode }) {
  // ФИКСИРОВАННЫЙ размер и пропорции (≈ iPhone Pro 9:19.5). Не растягивается и не
  // сжимается под контент/экран — контент прокручивается внутри. Модалка вокруг
  // скроллится, если телефон выше окна.
  const W = 300;
  const H = Math.round(W * 2.165); // ≈ 650
  return (
    <div className="relative shrink-0" style={{ width: W, height: H }}>
      {/* боковые кнопки (тонкие) */}
      <div className="absolute -left-[2px] top-[96px] h-6 w-[2px] rounded-l bg-neutral-500/70" />
      <div className="absolute -left-[2px] top-[140px] h-11 w-[2px] rounded-l bg-neutral-500/70" />
      <div className="absolute -left-[2px] top-[188px] h-11 w-[2px] rounded-l bg-neutral-500/70" />
      <div className="absolute -right-[2px] top-[150px] h-16 w-[2px] rounded-r bg-neutral-500/70" />
      {/* тонкая титановая рамка → экран почти в край */}
      <div className="h-full w-full rounded-[2.9rem] bg-gradient-to-b from-neutral-300 via-neutral-400 to-neutral-500 p-[3px] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.45)]">
        <div className="h-full w-full overflow-hidden rounded-[2.75rem] bg-black p-[2px]">
          <div className="relative h-full w-full overflow-hidden rounded-[2.65rem] bg-bg">
            <PhoneStatusBar />
            {/* Dynamic Island */}
            <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex h-[26px] w-[88px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-2.5">
              <span className="h-2 w-2 rounded-full bg-neutral-800 ring-1 ring-neutral-700" />
            </div>
            <div className="h-full overflow-y-auto pt-12">{children}</div>
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
