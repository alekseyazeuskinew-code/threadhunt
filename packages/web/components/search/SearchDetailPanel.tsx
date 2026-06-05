'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, Sparkles, ShieldAlert, FlaskConical, Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { SearchDetail, ReplyTemplate, PostTemplate, Lead, SearchStats, TestPublishResult } from '@/lib/types';
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
import { type Flow, defaultFlow, FLOW_TEMPLATES } from '@/lib/flow';
import { TIMEZONES, zonedToUtc } from '@/lib/timezones';

type TabKey = 'keywords' | 'replies' | 'posts' | 'ads' | 'goal' | 'onboarding' | 'leads';

// Деталь поиска как переиспользуемая панель: и в split-view (справа), и как deep-link.
// onChanged — чтобы левый список обновился при смене статуса/контента.
export function SearchDetailPanel({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [s, setS] = useState<SearchDetail | null>(null);
  const [tab, setTab] = useState<TabKey>('keywords');

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
              <Badge tone={s.status === 'ACTIVE' ? 'accent' : 'neutral'}>
                {s.status === 'ACTIVE' ? '● активен' : '○ пауза'}
              </Badge>
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
              { key: 'keywords', label: 'Кодовые слова', count: s.keywords.length },
              { key: 'replies', label: 'Отбивка', count: s.replyTemplates.length },
              { key: 'posts', label: 'Посты', count: s.postTemplates.length },
              { key: 'ads', label: 'Реклама' },
              { key: 'goal', label: 'Цель' },
              { key: 'onboarding', label: 'Онбординг' },
              { key: 'leads', label: 'Лиды', count: s._count?.leads ?? 0 },
            ]}
          />
        </div>
      </header>

      <div className="max-w-3xl p-6">
        {tab === 'keywords' && <KeywordsTab s={s} reload={reload} />}
        {tab === 'replies' && <RepliesTab s={s} reload={reload} />}
        {tab === 'posts' && <PostsTab s={s} reload={reload} />}
        {tab === 'ads' && <CampaignsManager fixedSearchId={s.id} searches={[{ id: s.id, title: s.title } as any]} />}
        {tab === 'goal' && <GoalPlanner searchId={s.id} onRewrite={() => setTab('posts')} />}
        {tab === 'onboarding' && <OnboardingTab s={s} reload={reload} />}
        {tab === 'leads' && <LeadsTab id={id} />}
      </div>
    </div>
  );
}

function KeywordsTab({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const [value, setValue] = useState(s.keywords.map((k) => k.text).join(', '));
  const [saved, setSaved] = useState(false);
  async function save() {
    await api.put(`/api/searches/${s.id}/keywords`, {
      keywords: value.split(',').map((t) => t.trim()).filter(Boolean).map((text) => ({ text, mode: 'root' })),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    reload();
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Сообщения с этими словами в директе ловятся автоматически. Ищется по корню: «монтаж» поймает и «монтажёр».
      </p>
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="монтаж, монтажёр, video editor" />
      <div className="flex flex-wrap gap-2">
        {value.split(',').map((t) => t.trim()).filter(Boolean).map((t, i) => (
          <Badge key={i} tone="accent">{t}</Badge>
        ))}
      </div>
      <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить'}</Button>
    </div>
  );
}

function RepliesTab({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const [list, setList] = useState<ReplyTemplate[]>(s.replyTemplates.length ? s.replyTemplates : [{ text: '', redirectTarget: '' }]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const set = (i: number, patch: Partial<ReplyTemplate>) => setList((l) => l.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  async function save() {
    await api.put(`/api/searches/${s.id}/reply-templates`, {
      templates: list.filter((t) => t.text.trim()).map((t) => ({ text: t.text, redirectTarget: t.redirectTarget })),
    });
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Ответ кандидату, поймавшему кодовое слово. Несколько — ротация / A-B.</p>
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
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setList((l) => [...l, { text: '', redirectTarget: '' }])}>
          <Plus size={16} /> Добавить
        </Button>
        <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить'}</Button>
      </div>
    </div>
  );
}

function PostsTab({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const [list, setList] = useState<PostTemplate[]>(s.postTemplates.length ? s.postTemplates : [{ text: '' }]);
  const [cfg, setCfg] = useState(s.publishConfig ?? { enabled: false, intervalMinutes: 240, maxPerDay: 5, rotation: 'sequential' as const });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestPublishResult | null>(null);
  const set = (i: number, patch: Partial<PostTemplate>) => setList((l) => l.map((t, j) => (j === i ? { ...t, ...patch } : t)));

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

  async function save() {
    await api.put(`/api/searches/${s.id}/post-templates`, {
      templates: list.filter((t) => t.text.trim() || t.mediaUrl).map((t) => ({ text: t.text, mediaUrl: t.mediaUrl || '', mediaType: t.mediaType || undefined })),
    });
    await api.patch(`/api/searches/${s.id}/publish-config`, cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    reload();
  }
  async function generate() {
    setBusy(true);
    setGenMsg('');
    try {
      const { result, source } = await api.post<{ result: string[]; source?: string }>(`/api/searches/${s.id}/generate`, { kind: 'posts', count: 5 });
      setList((l) => [...l, ...(result || []).map((text) => ({ text }))]);
      if (source === 'demo') setGenMsg('Сгенерировано демо-движком (ИИ-ключ не подключён).');
    } catch (e: any) {
      setGenMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Автопубликация</div>
            <div className="text-sm text-muted">Бот сам постит приманки по расписанию через официальный API.</div>
          </div>
          <Toggle checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted">
          <label className="flex items-center gap-2">
            раз в
            <Input type="number" className="w-20" value={cfg.intervalMinutes} onChange={(e) => setCfg({ ...cfg, intervalMinutes: +e.target.value })} />
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

        {/* Тест публикации — прогон без реальной отправки */}
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <div className="font-medium">Тест публикации</div>
              <div className="text-xs text-muted">Проверит подключение, токен и шаблоны — ничего не публикуя.</div>
            </div>
            <Button variant="ghost" size="sm" onClick={runTest} disabled={testing}>
              <FlaskConical size={14} /> {testing ? 'Проверяю…' : 'Запустить тест'}
            </Button>
          </div>
          {test && (
            <div className={`mt-3 rounded-xl border p-3 ${test.ready ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'}`}>
              <div className="mb-2 text-sm font-medium">
                {test.ready ? '✓ Готово к публикации — всё на месте (тест, без отправки)' : '⚠ Публикация не пройдёт — есть незакрытые пункты'}
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
                  <div className="mb-1 text-xs text-muted">Следующим выйдет ({test.wouldPost.rotation}):</div>
                  <p className="whitespace-pre-wrap">{test.wouldPost.text}</p>
                  {test.wouldPost.mediaUrl && <div className="mt-1 text-xs text-muted truncate">📎 {test.wouldPost.mediaType}: {test.wouldPost.mediaUrl}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Тексты постов. Можно добавить картинку/видео по публичной ссылке.</p>
        <Button variant="soft" size="sm" onClick={generate} disabled={busy}>
          <Sparkles size={14} /> {busy ? 'Генерирую…' : 'Сгенерировать ИИ'}
        </Button>
      </div>
      {genMsg && <p className="text-xs text-warning">{genMsg}</p>}

      {list.map((t, i) => (
        <div key={i} className="rounded-2xl border border-line bg-panel p-4">
          <Textarea value={t.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="Ищу монтажёра Reels…" />
          <div className="mt-2 flex items-center gap-2">
            <Input className="flex-1" value={t.mediaUrl || ''} onChange={(e) => set(i, { mediaUrl: e.target.value })} placeholder="URL картинки/видео (необязательно)" />
            <Select
              size="sm"
              className="w-28"
              value={t.mediaType || ''}
              onChange={(v) => set(i, { mediaType: (v || null) as any })}
              options={[{ value: '', label: 'текст' }, { value: 'image', label: 'фото' }, { value: 'video', label: 'видео' }]}
            />
            <button onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="text-muted hover:text-danger">
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setList((l) => [...l, { text: '' }])}>
          <Plus size={16} /> Добавить
        </Button>
        <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить'}</Button>
      </div>
    </div>
  );
}

// Онбординг: конструктор страниц/блоков публичной ссылки кандидата.
function OnboardingTab({ s, reload }: { s: SearchDetail; reload: () => void }) {
  const [enabled, setEnabled] = useState(s.obEnabled);
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
  // дедлайн
  const [dlMode, setDlMode] = useState<'none' | 'relative' | 'fixed'>(s.obDeadlineMode || 'none');
  const initHours = s.obDeadlineHours || 48;
  const [dlUnit, setDlUnit] = useState<'h' | 'd'>(initHours % 24 === 0 ? 'd' : 'h');
  const [dlValue, setDlValue] = useState(initHours % 24 === 0 ? initHours / 24 : initHours);
  const [dlLocal, setDlLocal] = useState('');
  const [tz, setTz] = useState(s.obTimezone || '');

  async function save() {
    const hours = dlUnit === 'd' ? dlValue * 24 : dlValue;
    const obDeadlineAt = dlMode === 'fixed' && dlLocal ? zonedToUtc(dlLocal, tz).toISOString() : null;
    await api.put(`/api/searches/${s.id}/onboarding`, {
      obEnabled: enabled,
      obFlow: JSON.stringify(flow),
      obDeadlineMode: dlMode,
      obDeadlineHours: Math.max(1, hours),
      obDeadlineAt,
      obTimezone: tz,
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

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Онбординг по ссылке</div>
            <div className="text-sm text-muted">
              Собери страницы и блоки, по которым пройдёт кандидат. Ссылку выдашь из карточки во вкладке «Лиды».
            </div>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>
      </div>

      {/* Загрузить готовый шаблон под роль */}
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

      <FlowBuilder value={flow} onChange={setFlow} />

      {/* Дедлайн сдачи тестового */}
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
              <Select
                className="w-28"
                value={dlUnit}
                onChange={(v) => setDlUnit(v as any)}
                options={[{ value: 'h', label: 'часов' }, { value: 'd', label: 'дней' }]}
              />
              <span>с момента, как кандидат откроет ссылку</span>
            </>
          )}

          {dlMode === 'fixed' && (
            <input
              type="datetime-local"
              value={dlLocal}
              onChange={(e) => setDlLocal(e.target.value)}
              className="rounded-xl border border-line bg-bg px-3 py-2 text-text"
            />
          )}
        </div>

        {dlMode !== 'none' && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <span>Часовой пояс:</span>
            <Select className="w-72" value={tz} onChange={setTz} options={TIMEZONES.map((t) => ({ value: t.tz, label: t.label }))} />
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Кандидат увидит дедлайн и обратный отсчёт. По истечении — в канбане «тест просрочен».</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить онбординг'}</Button>
        <span className="mx-1 text-muted">·</span>
        <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Название шаблона" className="w-48" />
        <Button variant="ghost" onClick={saveTemplate} disabled={!tplName.trim()}>
          {saved2 ? 'В библиотеке ✓' : 'Сохранить как шаблон'}
        </Button>
      </div>

      <OnboardingFunnelBlock id={s.id} />
    </div>
  );
}

// Аналитика отвалов по шагам онбординга.
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

function LeadsTab({ id }: { id: string }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  useEffect(() => {
    api.get<Lead[]>(`/api/searches/${id}/leads`).then(setLeads);
  }, [id]);
  if (!leads) return <div className="text-muted">Загрузка…</div>;
  if (!leads.length) return <div className="text-muted">Пока лидов нет. Появятся, как только кто-то напишет кодовое слово.</div>;
  return <LeadTable leads={leads} showSearch={false} />;
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
