'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, GripVertical, ArrowUp, ArrowDown, Clock, Mail } from 'lucide-react';
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
  EMAIL_BLOCK_LABELS,
  newBlock,
  newStep,
  emptySequence,
  delayLabel,
} from '@/lib/email';

const BLOCK_PALETTE: EmailBlockType[] = ['heading', 'text', 'button', 'image', 'divider', 'spacer'];

export function EmailSequenceBuilder() {
  const [list, setList] = useState<EmailSequence[] | null>(null);
  const [seq, setSeq] = useState<EmailSequence | null>(null);
  const [denied, setDenied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [drag, setDrag] = useState<{ stepId: string; index: number } | null>(null);
  const [testMsg, setTestMsg] = useState<{ stepId: string; ok: boolean; text: string } | null>(null);

  async function testStep(st: EmailStep) {
    setTestMsg({ stepId: st.id, ok: true, text: 'Отправляю…' });
    try {
      const r = await api.post<{ to: string }>('/api/admin/email-test', { subject: st.subject, blocks: st.blocks });
      setTestMsg({ stepId: st.id, ok: true, text: `Отправлено на ${r.to} ✓` });
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
    await api.put(`/api/admin/email-sequences/${seq.id}`, { name: seq.name, audience: seq.audience, enabled: seq.enabled, steps: seq.steps });
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
              <button
                key={sq.id}
                onClick={() => setSeq(sq)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm ${seq?.id === sq.id ? 'bg-accent-soft text-accent-ink' : 'hover:bg-panel-2'}`}
              >
                <span className="truncate">
                  <Mail size={13} className="mr-1.5 inline" />
                  {sq.name}
                </span>
                <span className={`shrink-0 text-xs ${sq.enabled ? 'text-success' : 'text-muted'}`}>{sq.enabled ? '● вкл' : '○ выкл'}</span>
              </button>
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
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить цепочку'}</Button>
              <Button variant="ghost" onClick={() => remove(seq.id)}>
                <Trash2 size={15} /> Удалить
              </Button>
              <span className="text-xs text-muted">Отправка включится после подключения Resend. Сейчас — конструктор и расписание.</span>
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
                    <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:bg-panel-2 disabled:opacity-30"><ArrowUp size={15} /></button>
                    <button onClick={() => moveStep(i, 1)} disabled={i === seq.steps.length - 1} className="rounded p-1 text-muted hover:bg-panel-2 disabled:opacity-30"><ArrowDown size={15} /></button>
                    <button onClick={() => removeStep(st.id)} className="rounded p-1 text-muted hover:text-danger"><Trash2 size={15} /></button>
                  </div>
                </div>

                <label className="mb-1.5 block text-sm">Тема письма</label>
                <Input value={st.subject} onChange={(e) => patchStep(st.id, { subject: e.target.value })} placeholder="Тема" />

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {/* Редактор блоков (drag-and-drop) */}
                  <div>
                    <div className="mb-2 text-xs font-medium text-muted">Блоки письма (тяни, чтобы менять порядок)</div>
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
                      <button onClick={() => testStep(st)} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-panel-2">
                        Тест себе
                      </button>
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
      {b.type === 'image' && <Input value={b.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="URL картинки https://…" />}
      {(b.type === 'heading' || b.type === 'text' || b.type === 'button') && (
        <Select
          size="sm"
          value={b.align || 'left'}
          onChange={(v) => onChange({ align: v as 'left' | 'center' })}
          options={[
            { value: 'left', label: 'по левому краю' },
            { value: 'center', label: 'по центру' },
          ]}
        />
      )}
    </div>
  );
}

// Превью письма (как примерно увидит получатель).
export function EmailPreview({ subject, blocks }: { subject: string; blocks: EmailBlock[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white text-[#111]">
      <div className="border-b border-black/10 bg-black/[0.03] px-4 py-2 text-xs text-black/50">Тема: {subject || '—'}</div>
      <div className="space-y-3 p-5">
        {blocks.length === 0 && <div className="text-center text-sm text-black/40">Пустое письмо — добавь блоки.</div>}
        {blocks.map((b) => {
          const al = b.align === 'center' ? 'text-center' : 'text-left';
          if (b.type === 'heading') return <div key={b.id} className={`text-lg font-bold ${al}`}>{b.text}</div>;
          if (b.type === 'text') return <p key={b.id} className={`whitespace-pre-wrap text-sm leading-relaxed text-black/80 ${al}`}>{b.text}</p>;
          if (b.type === 'button')
            return (
              <div key={b.id} className={al}>
                <span className="inline-block rounded-lg bg-[#c6f24e] px-4 py-2 text-sm font-semibold text-[#0b0b0f]">{b.text || 'Кнопка'}</span>
              </div>
            );
          if (b.type === 'image') return b.url ? <img key={b.id} src={b.url} alt="" className="w-full rounded-lg" /> : <div key={b.id} className="rounded-lg bg-black/5 py-8 text-center text-xs text-black/30">картинка</div>;
          if (b.type === 'divider') return <hr key={b.id} className="border-black/10" />;
          return <div key={b.id} className="h-4" />; // spacer
        })}
      </div>
    </div>
  );
}
