'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { Plus, Trash2, GripVertical, ArrowUp, ArrowDown, Clock, Mail, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import {
  type EmailSequence,
  type EmailStep,
  type EmailBlock,
  type EmailBlockType,
  type EmailSegment,
  type EmailFont,
  EMAIL_BLOCK_LABELS,
  EMAIL_FONTS,
  EMAIL_FONT_CSS,
  newBlock,
  newStep,
  emptySequence,
  delayLabel,
  eid,
} from '@/lib/email';

// Ответ ИИ-генератора письма (драфт-блоки без id).
interface EmailGenResponse {
  subject: string;
  blocks: Array<{ type: EmailBlockType; text?: string; url?: string; align?: 'left' | 'center' | 'right'; width?: 'full' | 'half' | 'small' }>;
  imageIdea?: string;
  source: 'ai' | 'demo';
}

const BLOCK_PALETTE: EmailBlockType[] = ['heading', 'text', 'button', 'image', 'divider', 'spacer'];

export function EmailSequenceBuilder() {
  const [list, setList] = useState<EmailSequence[] | null>(null);
  const [seq, setSeq] = useState<EmailSequence | null>(null);
  const [denied, setDenied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [drag, setDrag] = useState<{ stepId: string; index: number } | null>(null);
  const [testMsg, setTestMsg] = useState<{ stepId: string; ok: boolean; text: string } | null>(null);
  const [stats, setStats] = useState<{ perStep: Record<number, number>; started: number } | null>(null);
  const [genBrief, setGenBrief] = useState<Record<string, string>>({});
  const [gen, setGen] = useState<{ stepId: string; busy: boolean; msg: string; ok: boolean; idea: string } | null>(null);
  const [audCount, setAudCount] = useState<{ count: number; describe: string; sample: string[] } | null>(null);

  // Живой пересчёт «кому уйдёт» при смене аудитории/сегмента.
  useEffect(() => {
    if (!seq) {
      setAudCount(null);
      return;
    }
    let alive = true;
    api
      .post<{ count: number; describe: string; sample: string[] }>('/api/admin/email-audience-count', { audience: seq.audience, segment: seq.segment || {} })
      .then((r) => alive && setAudCount(r))
      .catch(() => alive && setAudCount(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq?.id, seq?.audience, JSON.stringify(seq?.segment)]);

  const patchSeg = (p: Partial<EmailSegment>) => setSeq((s) => (s ? { ...s, segment: { ...(s.segment || {}), ...p } } : s));
  const toggleArr = (arr: string[] | undefined, v: string): string[] => {
    const set = new Set(arr || []);
    set.has(v) ? set.delete(v) : set.add(v);
    return [...set];
  };

  // ИИ собирает целое письмо по вводным и раскидывает по блокам выбранного шага.
  async function generateStep(st: EmailStep) {
    if (!seq) return;
    const brief = (genBrief[st.id] || '').trim();
    if (!brief) {
      setGen({ stepId: st.id, busy: false, ok: false, msg: 'Сначала впиши вводные — о чём письмо.', idea: '' });
      return;
    }
    setGen({ stepId: st.id, busy: true, ok: true, msg: 'Генерирую письмо…', idea: '' });
    try {
      const ctaUrl = st.blocks.find((b) => b.type === 'button')?.url || undefined;
      const r = await api.post<EmailGenResponse>('/api/admin/email-generate', { brief, audience: seq.audience, ctaUrl });
      const blocks: EmailBlock[] = r.blocks.map((b) => ({
        id: eid('b'),
        type: b.type,
        ...(b.text !== undefined ? { text: b.text } : {}),
        ...(b.url !== undefined ? { url: b.url } : {}),
        align: b.align || 'left',
        ...(b.width ? { width: b.width } : {}),
      }));
      patchStep(st.id, { subject: r.subject, blocks });
      setGen({
        stepId: st.id,
        busy: false,
        ok: true,
        msg: r.source === 'ai' ? 'Готово ✓ Письмо собрано — проверь и поправь при желании.' : 'Черновик собран (ИИ-ключ не задан на сервере).',
        idea: r.imageIdea || '',
      });
    } catch (e: any) {
      setGen({ stepId: st.id, busy: false, ok: false, msg: e.message, idea: '' });
    }
  }

  async function selectSeq(sq: EmailSequence) {
    setSeq(sq);
    setStats(null);
    try {
      setStats(await api.get<{ perStep: Record<number, number>; started: number }>(`/api/admin/email-sequences/${sq.id}/stats`));
    } catch {}
  }

  async function testStep(st: EmailStep) {
    setTestMsg({ stepId: st.id, ok: true, text: 'Отправляю…' });
    try {
      const r = await api.post<{ to: string }>('/api/admin/email-test', { subject: st.subject, blocks: st.blocks });
      setTestMsg({ stepId: st.id, ok: true, text: `Отправлено на ${r.to} ✓` });
    } catch (e: any) {
      setTestMsg({ stepId: st.id, ok: false, text: e.message });
    }
  }

  async function broadcastStep(st: EmailStep) {
    if (!seq) return;
    const aud = seq.audience === 'waitlist' ? 'листу ожидания' : 'всем зарегистрированным';
    if (!window.confirm(`Отправить это письмо по базе (${aud}) прямо сейчас? Это реальная рассылка.`)) return;
    setTestMsg({ stepId: st.id, ok: true, text: 'Рассылаю…' });
    try {
      const r = await api.post<{ total: number; sent: number; failed: number }>('/api/admin/email-broadcast', {
        subject: st.subject,
        blocks: st.blocks,
        audience: seq.audience,
      });
      setTestMsg({ stepId: st.id, ok: r.failed === 0, text: `Разослано: ${r.sent} из ${r.total}${r.failed ? `, ошибок ${r.failed}` : ' ✓'}` });
    } catch (e: any) {
      setTestMsg({ stepId: st.id, ok: false, text: e.message });
    }
  }

  const load = () => api.get<EmailSequence[]>('/api/admin/email-sequences').then(setList).catch(() => setDenied(true));
  useEffect(() => {
    load();
  }, []);

  async function create() {
    const r = await api.post<EmailSequence>('/api/admin/email-sequences', { name: emptySequence().name });
    const withStep: EmailSequence = { ...r, steps: r.steps?.length ? r.steps : [newStep(true)] };
    setList((l) => (l ? [withStep, ...l] : [withStep]));
    setSeq(withStep);
  }
  async function save() {
    if (!seq) return;
    await api.put(`/api/admin/email-sequences/${seq.id}`, { name: seq.name, audience: seq.audience, enabled: seq.enabled, steps: seq.steps, segment: seq.segment || {} });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    load();
  }
  async function remove(id: string) {
    await api.del(`/api/admin/email-sequences/${id}`);
    if (seq?.id === id) setSeq(null);
    load();
  }

  // ── мутации выбранной цепочки (иммутабельно) ──
  const patchSeq = (p: Partial<EmailSequence>) => setSeq((s) => (s ? { ...s, ...p } : s));
  const patchStep = (sid: string, p: Partial<EmailStep>) =>
    setSeq((s) => (s ? { ...s, steps: s.steps.map((st) => (st.id === sid ? { ...st, ...p } : st)) } : s));
  const patchBlock = (sid: string, bid: string, p: Partial<EmailBlock>) =>
    patchStepBlocks(sid, (bl) => bl.map((b) => (b.id === bid ? { ...b, ...p } : b)));
  const patchStepBlocks = (sid: string, fn: (b: EmailBlock[]) => EmailBlock[]) =>
    setSeq((s) => (s ? { ...s, steps: s.steps.map((st) => (st.id === sid ? { ...st, blocks: fn(st.blocks) } : st)) } : s));

  const addBlock = (sid: string, t: EmailBlockType) => patchStepBlocks(sid, (b) => [...b, newBlock(t)]);
  const removeBlock = (sid: string, bid: string) => patchStepBlocks(sid, (b) => b.filter((x) => x.id !== bid));
  const moveBlock = (sid: string, from: number, to: number) =>
    patchStepBlocks(sid, (b) => {
      if (to < 0 || to >= b.length) return b;
      const copy = [...b];
      const [m] = copy.splice(from, 1);
      copy.splice(to, 0, m);
      return copy;
    });

  const addStep = () => setSeq((s) => (s ? { ...s, steps: [...s.steps, newStep(s.steps.length === 0)] } : s));
  const removeStep = (sid: string) => setSeq((s) => (s ? { ...s, steps: s.steps.filter((st) => st.id !== sid) } : s));
  const moveStep = (idx: number, dir: -1 | 1) =>
    setSeq((s) => {
      if (!s) return s;
      const to = idx + dir;
      if (to < 0 || to >= s.steps.length) return s;
      const copy = [...s.steps];
      const [m] = copy.splice(idx, 1);
      copy.splice(to, 0, m);
      return { ...s, steps: copy };
    });

  if (denied) return <div className="p-8 text-muted">Доступ только для администраторов.</div>;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Список цепочек */}
      <div className="space-y-3">
        <Button className="w-full" onClick={create}>
          <Plus size={16} /> Новая цепочка
        </Button>
        <div className="space-y-1.5">
          {list === null ? (
            <div className="text-sm text-muted">Загрузка…</div>
          ) : list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Цепочек пока нет.</div>
          ) : (
            list.map((sq) => (
              <div
                key={sq.id}
                className={`group flex items-center gap-1 rounded-xl pr-1 text-sm ${seq?.id === sq.id ? 'bg-accent-soft text-accent-ink' : 'hover:bg-panel-2'}`}
              >
                <button onClick={() => selectSeq(sq)} className="flex min-w-0 flex-1 items-center justify-between px-3 py-2.5 text-left">
                  <span className="truncate">
                    <Mail size={13} className="mr-1.5 inline" />
                    {sq.name}
                  </span>
                  <span className={`ml-2 shrink-0 text-xs ${sq.enabled ? 'text-success' : 'text-muted'}`}>{sq.enabled ? '● вкл' : '○ выкл'}</span>
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Удалить цепочку «${sq.name}»?`)) remove(sq.id);
                  }}
                  className="shrink-0 rounded p-1.5 text-muted opacity-0 hover:text-danger group-hover:opacity-100"
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Редактор выбранной цепочки */}
      {!seq ? (
        <Card>
          <div className="py-12 text-center text-muted">Выбери цепочку слева или создай новую.</div>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <label className="mb-1.5 block text-sm">Название цепочки</label>
                <Input value={seq.name} onChange={(e) => patchSeq({ name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm">Аудитория</label>
                <Select
                  value={seq.audience}
                  onChange={(v) => patchSeq({ audience: v as EmailSequence['audience'] })}
                  options={[
                    { value: 'new_users', label: 'Новые пользователи' },
                    { value: 'waitlist', label: 'Лист ожидания' },
                  ]}
                />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <span className={`text-sm ${seq.enabled ? 'text-success' : 'text-muted'}`}>{seq.enabled ? 'Активна' : 'Выключена'}</span>
                <Toggle checked={seq.enabled} onChange={(v) => patchSeq({ enabled: v })} />
              </div>
            </div>
            {/* Кому отправляется: сегмент-фильтры по выбранной аудитории */}
            <div className="mt-4 rounded-xl border border-line bg-bg p-3">
              <div className="mb-2 text-xs font-semibold text-muted">Кому отправляется (сегмент)</div>
              {seq.audience === 'waitlist' ? (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted">статус:</span>
                    {(['new', 'invited', 'converted'] as const).map((st) => {
                      const on = (seq.segment?.statuses || []).includes(st);
                      const lbl: Record<string, string> = { new: 'новый', invited: 'приглашён', converted: 'оплатил' };
                      return (
                        <button key={st} onClick={() => patchSeg({ statuses: toggleArr(seq.segment?.statuses, st) })} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-panel-2'}`}>
                          {lbl[st]}
                        </button>
                      );
                    })}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    источник ~
                    <Input className="w-32" value={seq.segment?.sourceContains || ''} onChange={(e) => patchSeg({ sourceContains: e.target.value })} placeholder="facebook…" />
                  </label>
                  <div className="w-40">
                    <Select
                      size="sm"
                      value={seq.segment?.withPromo || 'any'}
                      onChange={(v) => patchSeg({ withPromo: v as EmailSegment['withPromo'] })}
                      options={[
                        { value: 'any', label: 'промокод: любой' },
                        { value: 'with', label: 'с промокодом' },
                        { value: 'without', label: 'без промокода' },
                      ]}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted">тариф:</span>
                    {(['FREE', 'PRO', 'VIP'] as const).map((pl) => {
                      const on = (seq.segment?.plans || []).includes(pl);
                      return (
                        <button key={pl} onClick={() => patchSeg({ plans: toggleArr(seq.segment?.plans, pl) })} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-panel-2'}`}>
                          {pl}
                        </button>
                      );
                    })}
                  </div>
                  <div className="w-52">
                    <Select
                      size="sm"
                      value={seq.segment?.activation || 'any'}
                      onChange={(v) => patchSeg({ activation: v as EmailSegment['activation'] })}
                      options={[
                        { value: 'any', label: 'активация: любая' },
                        { value: 'connected', label: 'подключили аккаунт' },
                        { value: 'not_connected', label: 'не подключили' },
                        { value: 'with_lead', label: 'есть лид' },
                        { value: 'no_lead', label: 'без лидов' },
                      ]}
                    />
                  </div>
                </div>
              )}
              <label className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                записались за последние
                <Input type="number" min={0} className="w-16" value={seq.segment?.signupWithinDays || 0} onChange={(e) => patchSeg({ signupWithinDays: Math.max(0, +e.target.value) })} />
                дней (0 = все)
              </label>
              <div className="mt-2 text-xs">
                {audCount === null ? (
                  <span className="text-muted">считаю…</span>
                ) : (
                  <span className="text-accent-ink">
                    Уйдёт <b>{audCount.count}</b> адресам · <span className="text-muted">{audCount.describe}</span>
                    {audCount.sample.length > 0 && <span className="text-muted"> · напр.: {audCount.sample.slice(0, 3).join(', ')}</span>}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить цепочку'}</Button>
              <Button variant="ghost" onClick={() => remove(seq.id)}>
                <Trash2 size={15} /> Удалить
              </Button>
              <span className="text-xs text-muted">Если цепочка <b>включена</b> и аудитория «Новые пользователи» — письма уходят автоматически по расписанию (drip): новым после регистрации, дальше по задержкам.</span>
            </div>
          </Card>

          {/* Шаги-цепочка */}
          {seq.steps.map((st, i) => (
            <div key={st.id} className="relative">
              {i > 0 && (
                <div className="mb-2 flex items-center gap-2 pl-2 text-xs text-muted">
                  <Clock size={13} /> через
                  <Input
                    type="number"
                    min={0}
                    className="w-16"
                    value={st.delayHours}
                    onChange={(e) => patchStep(st.id, { delayHours: Math.max(0, +e.target.value) })}
                  />
                  ч после предыдущего письма
                </div>
              )}
              <Card>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs text-on-accent">{i + 1}</span>
                    Письмо · <span className="font-normal text-muted">{delayLabel(st.delayHours, i === 0)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="mr-1 text-xs text-muted">отправлено: {stats?.perStep?.[i] ?? 0}</span>
                    <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:bg-panel-2 disabled:opacity-30"><ArrowUp size={15} /></button>
                    <button onClick={() => moveStep(i, 1)} disabled={i === seq.steps.length - 1} className="rounded p-1 text-muted hover:bg-panel-2 disabled:opacity-30"><ArrowDown size={15} /></button>
                    <button onClick={() => removeStep(st.id)} className="rounded p-1 text-muted hover:text-danger"><Trash2 size={15} /></button>
                  </div>
                </div>

                <label className="mb-1.5 block text-sm">Тема письма</label>
                <Input value={st.subject} onChange={(e) => patchStep(st.id, { subject: e.target.value })} placeholder="Тема" />

                {/* ИИ-генератор всего письма по кратким вводным */}
                <div className="mt-3 rounded-xl border border-accent/30 bg-accent-soft/50 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-accent-ink">
                    <Sparkles size={13} /> Сгенерировать письмо ИИ
                  </div>
                  <Textarea
                    rows={2}
                    value={genBrief[st.id] || ''}
                    onChange={(e) => setGenBrief((g) => ({ ...g, [st.id]: e.target.value }))}
                    placeholder="Вводные: о чём письмо и какая цель. Напр.: «Напомни новым пользователям подключить расширение и запустить первую отбивку, тёплый бодрый тон, упомяни что это 5 минут»"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => generateStep(st)} disabled={!!gen?.busy && gen?.stepId === st.id}>
                      <Sparkles size={14} /> {gen?.busy && gen?.stepId === st.id ? 'Генерирую…' : 'Собрать письмо'}
                    </Button>
                    <span className="text-[11px] text-muted">Заполнит тему и все блоки (заголовок, текст, кнопку) + идею для картинки. Заменит текущее содержимое письма.</span>
                  </div>
                  {gen?.stepId === st.id && gen.msg && <div className={`mt-2 text-xs ${gen.ok ? 'text-success' : 'text-danger'}`}>{gen.msg}</div>}
                  {gen?.stepId === st.id && gen.idea && <div className="mt-1 rounded-lg bg-bg/60 px-2.5 py-1.5 text-[11px] text-muted">💡 Идея для картинки: {gen.idea}</div>}
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {/* Редактор блоков (drag-and-drop) */}
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted">Блоки письма (тяни, чтобы менять порядок)</div>
                    <div className="mb-2 text-[11px] text-muted">
                      Переменные в тексте/ссылках: <code className="rounded bg-panel-2 px-1">{'{{promo}}'}</code> <code className="rounded bg-panel-2 px-1">{'{{name}}'}</code> <code className="rounded bg-panel-2 px-1">{'{{email}}'}</code>. Для листа ожидания <code className="rounded bg-panel-2 px-1">{'{{promo}}'}</code> подставит персональный код (выдаст автоматически, если ещё нет).
                    </div>
                    <div className="space-y-1.5">
                      {st.blocks.map((b, bi) => (
                        <div
                          key={b.id}
                          draggable
                          onDragStart={() => setDrag({ stepId: st.id, index: bi })}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (drag && drag.stepId === st.id) moveBlock(st.id, drag.index, bi);
                            setDrag(null);
                          }}
                          className="rounded-xl border border-line bg-bg p-2.5"
                        >
                          <div className="flex items-center gap-2">
                            <GripVertical size={14} className="shrink-0 cursor-grab text-muted" />
                            <span className="text-xs font-medium text-muted">{EMAIL_BLOCK_LABELS[b.type]}</span>
                            <div className="ml-auto flex items-center gap-1">
                              <button onClick={() => moveBlock(st.id, bi, bi - 1)} disabled={bi === 0} className="rounded p-0.5 text-muted hover:bg-panel-2 disabled:opacity-30"><ArrowUp size={13} /></button>
                              <button onClick={() => moveBlock(st.id, bi, bi + 1)} disabled={bi === st.blocks.length - 1} className="rounded p-0.5 text-muted hover:bg-panel-2 disabled:opacity-30"><ArrowDown size={13} /></button>
                              <button onClick={() => removeBlock(st.id, b.id)} className="rounded p-0.5 text-muted hover:text-danger"><Trash2 size={13} /></button>
                            </div>
                          </div>
                          <BlockFields b={b} onChange={(p) => patchBlock(st.id, b.id, p)} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {BLOCK_PALETTE.map((t) => (
                        <button key={t} onClick={() => addBlock(st.id, t)} className="rounded-full border border-line px-2.5 py-1 text-xs hover:border-accent/50 hover:bg-panel-2">
                          + {EMAIL_BLOCK_LABELS[t]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Превью письма */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">Предпросмотр</span>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => testStep(st)} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-panel-2">
                          Тест себе
                        </button>
                        <button onClick={() => broadcastStep(st)} className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent-press">
                          Отправить по базе
                        </button>
                      </div>
                    </div>
                    <EmailPreview subject={st.subject} blocks={st.blocks} />
                    {testMsg?.stepId === st.id && <div className={`mt-2 text-xs ${testMsg.ok ? 'text-success' : 'text-danger'}`}>{testMsg.text}</div>}
                  </div>
                </div>
              </Card>
            </div>
          ))}

          <Button variant="ghost" onClick={addStep}>
            <Plus size={16} /> Добавить письмо в цепочку
          </Button>
        </div>
      )}
    </div>
  );
}

// Поля редактирования одного блока.
function BlockFields({ b, onChange }: { b: EmailBlock; onChange: (p: Partial<EmailBlock>) => void }) {
  if (b.type === 'divider' || b.type === 'spacer') return null;
  return (
    <div className="mt-2 space-y-2">
      {(b.type === 'heading' || b.type === 'text') && (
        <Textarea value={b.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder={b.type === 'heading' ? 'Заголовок' : 'Текст'} />
      )}
      {b.type === 'button' && (
        <>
          <Input value={b.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Текст кнопки" />
          <Input value={b.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://ссылка" />
        </>
      )}
      {b.type === 'image' && (
        <>
          <Input value={b.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="URL картинки https://…" />
          <Input value={b.linkUrl || ''} onChange={(e) => onChange({ linkUrl: e.target.value })} placeholder="Ссылка по клику (необязательно)" />
          <Select
            size="sm"
            value={b.width || 'full'}
            onChange={(v) => onChange({ width: v as 'full' | 'half' | 'small' })}
            options={[
              { value: 'full', label: 'во всю ширину' },
              { value: 'half', label: 'половина (50%)' },
              { value: 'small', label: 'маленькая (30%)' },
            ]}
          />
        </>
      )}
      {(b.type === 'heading' || b.type === 'text' || b.type === 'button' || b.type === 'image') && (
        <Select
          size="sm"
          value={b.align || 'left'}
          onChange={(v) => onChange({ align: v as 'left' | 'center' | 'right' })}
          options={[
            { value: 'left', label: 'по левому краю' },
            { value: 'center', label: 'по центру' },
            { value: 'right', label: 'по правому краю' },
          ]}
        />
      )}

      {/* Оформление текста: шрифт, размер, стиль, цвет */}
      {(b.type === 'heading' || b.type === 'text' || b.type === 'button') && (
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="min-w-[130px] flex-1">
            <Select
              size="sm"
              value={b.fontFamily || 'system'}
              onChange={(v) => onChange({ fontFamily: v as EmailFont })}
              options={EMAIL_FONTS}
            />
          </div>
          <input
            type="number"
            min={10}
            max={48}
            value={b.fontSize || (b.type === 'heading' ? 22 : 15)}
            onChange={(e) => onChange({ fontSize: Math.max(10, Math.min(48, +e.target.value)) })}
            className="w-16 rounded-lg border border-line bg-bg px-2 py-1 text-sm"
            title="Размер, px"
          />
          <button
            type="button"
            onClick={() => onChange({ bold: !b.bold })}
            className={`h-7 w-7 rounded-lg border text-sm font-bold ${b.bold ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-panel-2'}`}
            title="Жирный"
          >
            B
          </button>
          {b.type !== 'button' && (
            <button
              type="button"
              onClick={() => onChange({ italic: !b.italic })}
              className={`h-7 w-7 rounded-lg border text-sm italic ${b.italic ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-panel-2'}`}
              title="Курсив"
            >
              I
            </button>
          )}
          {b.type !== 'button' && (
            <input
              type="color"
              value={b.color || (b.type === 'heading' ? '#111111' : '#333333')}
              onChange={(e) => onChange({ color: e.target.value })}
              className="h-7 w-8 cursor-pointer rounded-lg border border-line bg-bg"
              title="Цвет текста"
            />
          )}
        </div>
      )}
    </div>
  );
}

// Инлайн-стиль текста блока для превью (зеркалит серверный рендер).
function previewTextStyle(b: EmailBlock, def: { size: number; weight: number; color: string }): CSSProperties {
  return {
    fontSize: (b.fontSize && b.fontSize > 0 ? b.fontSize : def.size) + 'px',
    fontWeight: b.bold === true ? 700 : b.bold === false ? 400 : def.weight,
    fontStyle: b.italic ? 'italic' : undefined,
    fontFamily: b.fontFamily ? EMAIL_FONT_CSS[b.fontFamily] : undefined,
    color: b.color || def.color,
  };
}

// Превью письма (как примерно увидит получатель).
export function EmailPreview({ subject, blocks }: { subject: string; blocks: EmailBlock[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white text-[#111]">
      <div className="border-b border-black/10 bg-black/[0.03] px-4 py-2 text-xs text-black/50">Тема: {subject || '—'}</div>
      <div className="space-y-3 p-5">
        {blocks.length === 0 && <div className="text-center text-sm text-black/40">Пустое письмо — добавь блоки.</div>}
        {blocks.map((b) => {
          const al = b.align === 'center' ? 'text-center' : b.align === 'right' ? 'text-right' : 'text-left';
          if (b.type === 'heading') return <div key={b.id} className={al} style={previewTextStyle(b, { size: 22, weight: 700, color: '#111111' })}>{b.text}</div>;
          if (b.type === 'text') return <p key={b.id} className={`whitespace-pre-wrap leading-relaxed ${al}`} style={previewTextStyle(b, { size: 15, weight: 400, color: '#333333' })}>{b.text}</p>;
          if (b.type === 'button')
            return (
              <div key={b.id} className={al}>
                <span className="inline-block rounded-lg bg-[#6d5cf6] px-4 py-2 font-semibold text-[#ffffff]" style={{ fontSize: (b.fontSize && b.fontSize > 0 ? b.fontSize : 15) + 'px', fontFamily: b.fontFamily ? EMAIL_FONT_CSS[b.fontFamily] : undefined }}>{b.text || 'Кнопка'}</span>
              </div>
            );
          if (b.type === 'image') {
            const w = b.width === 'half' ? '50%' : b.width === 'small' ? '30%' : '100%';
            const img = b.url ? (
              <img src={b.url} alt="" style={{ width: w, borderRadius: 8 }} className="inline-block" />
            ) : (
              <div className="inline-block rounded-lg bg-black/5 py-8 text-center text-xs text-black/30" style={{ width: w }}>картинка</div>
            );
            return (
              <div key={b.id} className={al}>
                {b.linkUrl ? <a href={b.linkUrl}>{img}</a> : img}
              </div>
            );
          }
          if (b.type === 'divider') return <hr key={b.id} className="border-black/10" />;
          return <div key={b.id} className="h-4" />; // spacer
        })}
      </div>
    </div>
  );
}
