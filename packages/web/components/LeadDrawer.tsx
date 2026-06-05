'use client';
import { useEffect, useState } from 'react';
import { X, Send, Clock, Check } from 'lucide-react';
import { api } from '@/lib/api';
import type { LeadDetail, Stage } from '@/lib/types';
import { STAGES } from '@/lib/stages';
import { RatingStars } from './RatingStars';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { cn } from '@/lib/cn';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

// Боковая карточка кандидата: стадия, рейтинг, БЛОК ЦИКЛА под текущую стадию, таймлайн.
export function LeadDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [body, setBody] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setLead(null);
    if (id) api.get<LeadDetail>(`/api/leads/${id}`).then(setLead);
  }, [id]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // закрытие по Esc
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, onClose]);

  if (!id) return null;

  async function reload() {
    if (id) setLead(await api.get<LeadDetail>(`/api/leads/${id}`));
    onChanged();
  }
  // optimistic + сохранить + перечитать (чтобы подтянулись системные события)
  async function patch(data: Record<string, any>) {
    if (!lead) return;
    setLead({ ...lead, ...data });
    await api.patch(`/api/leads/${lead.id}`, data);
    await reload();
  }
  async function addComment() {
    if (!lead || !body.trim()) return;
    await api.post(`/api/leads/${lead.id}/comments`, { body: body.trim() });
    setBody('');
    reload();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="anim-fade absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-pop relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line p-5">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{lead?.fromUsername || '—'}</div>
            {lead && <div className="text-sm text-muted">{lead.search?.title}</div>}
          </div>
          <button onClick={onClose} className="text-muted hover:text-text">
            <X size={20} />
          </button>
        </div>

        {!lead ? (
          <div className="p-5 text-muted">Загрузка…</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-4 border-b border-line p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{lead.matchedKeyword}</Badge>
                {lead.section && <Badge>{lead.section === 'requests' ? 'Запросы' : lead.section === 'hidden' ? 'Скрытые' : 'Основной'}</Badge>}
              </div>

              {/* стадия */}
              <div>
                <div className="mb-1.5 text-xs text-muted">Стадия</div>
                <div className="flex flex-wrap gap-1.5">
                  {STAGES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => patch({ stage: s.key })}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition-colors',
                        lead.stage === s.key ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:text-text',
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* рейтинг */}
              <div>
                <div className="mb-1.5 text-xs text-muted">Оценка</div>
                <RatingStars value={lead.rating} onChange={(v) => patch({ rating: v })} size={20} />
              </div>

              {/* БЛОК ЦИКЛА под текущую стадию */}
              <Lifecycle lead={lead} now={now} patch={patch} />

              {/* Онбординг-ссылка кандидата */}
              <OnboardLink leadId={lead.id} obStep={lead.obStep || 0} contact={lead.candidateContact} />
            </div>

            {/* таймлайн */}
            <div className="space-y-3 p-5">
              <div className="text-xs uppercase tracking-wide text-muted">Таймлайн</div>
              {lead.comments.length === 0 && <div className="text-sm text-muted">Пока пусто.</div>}
              {lead.comments.map((c) => (
                <div key={c.id} className={cn('rounded-xl p-3', c.author === 'система' ? 'bg-accent-soft/40' : 'bg-bg')}>
                  <div className="text-sm">{c.body}</div>
                  <div className="mt-1 text-xs text-muted">
                    {c.author} · {new Date(c.createdAt).toLocaleString('ru-RU')}
                  </div>
                </div>
              ))}
            </div>
            </div>

            <div className="flex items-center gap-2 border-t border-line p-4">
              <input
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addComment()}
                placeholder="Заметка по кандидату…"
                className="flex-1 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
              <Button size="sm" onClick={addComment} disabled={!body.trim()}>
                <Send size={15} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Уникальная онбординг-ссылка кандидата + прогресс прохождения.
function OnboardLink({ leadId, obStep, contact }: { leadId: string; obStep: number; contact?: string | null }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  async function getLink() {
    const r = await api.post<{ url: string }>(`/api/leads/${leadId}/onboard-link`);
    setUrl(r.url);
    try {
      await navigator.clipboard.writeText(r.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-muted">Онбординг-ссылка</span>
        {obStep > 0 && <span className="text-xs text-accent-ink">прошёл {Math.min(obStep, 4)}/4 шага</span>}
      </div>
      {contact && <div className="mb-2 text-xs text-muted">Оставил контакт: {contact}</div>}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="soft" onClick={getLink}>
          {copied ? 'Скопировано ✓' : url ? 'Скопировать ещё раз' : 'Ссылка кандидату'}
        </Button>
        {url && <span className="flex-1 truncate font-mono text-xs text-muted">{url}</span>}
      </div>
    </div>
  );
}

// Действия и поля, зависящие от стадии — оцифровка реального процесса найма.
function Lifecycle({ lead, now, patch }: { lead: LeadDetail; now: number; patch: (d: Record<string, any>) => void }) {
  const nowIso = () => new Date().toISOString();
  const [dlVal, setDlVal] = useState(2);
  const [dlUnit, setDlUnit] = useState<'h' | 'd'>('h');
  const deadlineIso = () => new Date(Date.now() + dlVal * (dlUnit === 'd' ? 24 : 1) * 3600_000).toISOString();
  const Wrap = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-xl border border-line bg-bg p-3">{children}</div>
  );
  // Выбор дедлайна при ручной выдаче теста.
  const DeadlinePick = () => (
    <div className="mb-2 flex items-center gap-2 text-xs text-muted">
      <span>дедлайн через</span>
      <Input type="number" className="w-16" value={dlVal} onChange={(e) => setDlVal(Math.max(1, +e.target.value))} />
      <Select size="sm" className="w-24" value={dlUnit} onChange={(v) => setDlUnit(v as any)} options={[{ value: 'h', label: 'часов' }, { value: 'd', label: 'дней' }]} />
    </div>
  );

  if (lead.stage === 'NEW') {
    return (
      <Wrap>
        <div className="mb-2 text-sm text-muted">Новый отклик. Взять в работу?</div>
        <Button size="sm" onClick={() => patch({ stage: 'CONTACTED' })}>
          На связь →
        </Button>
      </Wrap>
    );
  }

  if (lead.stage === 'CONTACTED') {
    return (
      <Wrap>
        <div className="mb-2 text-xs text-muted">Куда увели кандидата</div>
        <Input defaultValue={lead.contact || ''} placeholder="@telegram ассистента" onBlur={(e) => patch({ contact: e.target.value })} />
        <div className="mt-3 flex flex-wrap gap-2">
          {lead.conditionsSentAt ? (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <Check size={13} /> условия отправлены {fmt(lead.conditionsSentAt)}
            </span>
          ) : (
            <Button size="sm" variant="soft" onClick={() => patch({ conditionsSentAt: nowIso() })}>
              Условия отправлены
            </Button>
          )}
        </div>
        <div className="mt-3">
          <DeadlinePick />
          <Button size="sm" onClick={() => patch({ stage: 'SCREENING', testSentAt: nowIso(), testDeadlineAt: deadlineIso() })}>
            Выдать тестовое →
          </Button>
        </div>
      </Wrap>
    );
  }

  if (lead.stage === 'SCREENING') {
    return (
      <Wrap>
        {lead.testSentAt ? (
          <div className="space-y-2">
            <Countdown deadline={lead.testDeadlineAt} now={now} submitted={lead.testSubmittedAt} />
            {!lead.testSubmittedAt && (
              <div>
                <DeadlinePick />
                <button onClick={() => patch({ testDeadlineAt: deadlineIso() })} className="text-xs text-accent-ink hover:underline">
                  изменить дедлайн
                </button>
              </div>
            )}
          </div>
        ) : (
          <div>
            <DeadlinePick />
            <Button size="sm" variant="soft" onClick={() => patch({ testSentAt: nowIso(), testDeadlineAt: deadlineIso() })}>
              Выдать тестовое
            </Button>
          </div>
        )}
        <div className="mt-3 text-xs text-muted">Ссылка на сданное тестовое</div>
        <Input
          defaultValue={lead.testSubmittedUrl || ''}
          placeholder="https://…"
          onBlur={(e) => patch({ testSubmittedUrl: e.target.value, ...(e.target.value && !lead.testSubmittedAt ? { testSubmittedAt: nowIso() } : {}) })}
        />
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => patch({ stage: 'HIRED' })}>
            ✓ В команду
          </Button>
          <Button size="sm" variant="danger" onClick={() => patch({ stage: 'REJECTED' })}>
            ✗ Отказ
          </Button>
        </div>
      </Wrap>
    );
  }

  if (lead.stage === 'HIRED') {
    return (
      <Wrap>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-xs text-muted">Роль</div>
            <Input defaultValue={lead.role || ''} placeholder="Монтажёр" onBlur={(e) => patch({ role: e.target.value })} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">Ставка</div>
            <Input defaultValue={lead.rate || ''} placeholder="500₽/ролик" onBlur={(e) => patch({ rate: e.target.value })} />
          </div>
        </div>
        {lead.startedAt && <div className="mt-2 text-xs text-success">В команде с {fmt(lead.startedAt)}</div>}
      </Wrap>
    );
  }

  if (lead.stage === 'BENCH') {
    const dateVal = lead.nextTouchAt ? lead.nextTouchAt.slice(0, 10) : '';
    return (
      <Wrap>
        <div className="mb-1 text-xs text-muted">Следующее касание (разогрев резерва)</div>
        <input
          type="date"
          defaultValue={dateVal}
          onChange={(e) => patch({ nextTouchAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
          className="rounded-xl border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
      </Wrap>
    );
  }

  if (lead.stage === 'REJECTED') {
    const reasons = ['Тест слабый', 'Долго отвечает', 'Дорого', 'Не тот скилл', 'Передумал', 'Другое'];
    return (
      <Wrap>
        <div className="mb-1.5 text-xs text-muted">Причина отказа</div>
        <Select
          value={lead.decisionReason || ''}
          onChange={(v) => patch({ decisionReason: v })}
          options={[{ value: '', label: '— выбери —' }, ...reasons.map((r) => ({ value: r, label: r }))]}
        />
      </Wrap>
    );
  }
  return null;
}

// Таймер дедлайна по тестовому.
function Countdown({ deadline, now, submitted }: { deadline?: string | null; now: number; submitted?: string | null }) {
  if (submitted) {
    return (
      <div className="inline-flex items-center gap-1.5 text-sm text-success">
        <Check size={15} /> тест сдан {fmt(submitted)}
      </div>
    );
  }
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  const overdue = ms <= 0;
  const h = Math.floor(Math.abs(ms) / 3600_000);
  const m = Math.floor((Math.abs(ms) % 3600_000) / 60_000);
  return (
    <div className={cn('inline-flex items-center gap-1.5 text-sm', overdue ? 'text-danger' : 'text-warning')}>
      <Clock size={15} /> {overdue ? `просрочено на ${h}ч ${m}м` : `на тест осталось ${h}ч ${m}м`}
    </div>
  );
}
