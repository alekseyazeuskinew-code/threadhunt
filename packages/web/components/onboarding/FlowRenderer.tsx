'use client';
import { useRef, useState, useEffect, type CSSProperties } from 'react';
import { Check, ArrowRight, ImagePlus, ChevronUp, ChevronDown, Trash2, Plus, GripVertical, Clock, X } from 'lucide-react';
import type { Block, Flow, BlockType } from '@/lib/flow';
import { BLOCK_LABELS } from '@/lib/flow';
import type { CompanyProfile } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { fmtInTz } from '@/lib/timezones';

// Маркетинговый сайт — вирусный хук: кандидат видит, чем собрали отклик, и идёт к нам.
export const THREADHUNT_SITE = 'https://threadhunt.app';

// Тонкий прогресс-бар шагов.
export function OnbProgress({ step, total }: { step: number; total: number }) {
  const pct = total ? Math.round((Math.min(step, total) / total) * 100) : 0;
  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
        <span>Шаг {Math.min(step + 1, total)} из {total}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Ненавязчивый бейдж-подпись (как «Made with Typeform/Tally»): маленькая
// кликабельная пилюля внизу. Вирусный механизм работает тихо — это не баннер.
export function PoweredBy() {
  return (
    <div className="mt-5 flex justify-center">
      <a
        href={THREADHUNT_SITE}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg px-2.5 py-1 text-[11px] text-muted transition-colors hover:text-text"
      >
        <span className="font-display text-accent-ink">⟋⟋</span>
        Сделано в <span className="font-semibold text-text">Threadhunt</span>
      </a>
    </div>
  );
}

// Экран успеха — спокойный, без рекламного баннера. Бренд несёт тихий бейдж снизу.
export function CompletionView({ onRestart }: { onRestart?: () => void }) {
  return (
    <div className="py-8 text-center">
      <div className="anim-check mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Check size={32} strokeWidth={2.5} />
      </div>
      <div className="anim-up mt-4 text-xl font-semibold">Готово! Мы всё получили 🎉</div>
      <p className="anim-up mt-1.5 text-sm text-muted">Свяжемся с тобой по оставленным контактам.</p>
      {onRestart && (
        <button onClick={onRestart} className="mt-5 text-sm text-muted hover:text-text">
          Пройти заново
        </button>
      )}
    </div>
  );
}

// Рендер одного блока онбординга. Общий для публичной страницы кандидата и для
// предпросмотра в конструкторе — чтобы превью было 1:1 тем, что увидит кандидат.
// Редактируемый текст «на месте» (для живого превью в конструкторе). Обновляет
// по blur, чтобы не сбивать курсор при наборе. innerText сохраняет переносы строк.
function Editable({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => {
        const t = e.currentTarget.innerText.replace(/ /g, ' ');
        if (t !== value) onChange(t);
      }}
      title="Нажми, чтобы отредактировать"
      className={`-mx-1 min-h-[1.2em] cursor-text whitespace-pre-wrap rounded px-1 outline-none transition-colors hover:bg-accent-soft/40 focus:bg-accent-soft/60 ${className || ''}`}
    >
      {value}
    </div>
  );
}

// Управление структурой прямо в превью (конструктор): подвинуть/удалить блок и
// добавить новый под ним. Появляется по наведению.
export interface BlockControls {
  move: (blockId: string, dir: -1 | 1) => void;
  remove: (blockId: string) => void;
  add: (afterBlockId: string, type: BlockType) => void;
}

// Палитра типов для быстрого добавления из превью: основные + дополнительные («Ещё»).
const ADD_PRIMARY: BlockType[] = ['heading', 'text', 'field', 'choice', 'submit'];
const ADD_MORE: BlockType[] = ['deadline', 'multi', 'scale', 'image', 'video', 'file', 'faq', 'consent', 'support'];

function BlockWrap({ children, first, last, c, id, dragId, setDragId, onReorder }: { children: React.ReactNode; first: boolean; last: boolean; c: BlockControls; id: string; dragId: string | null; setDragId: (v: string | null) => void; onReorder: (fromId: string, toId: string, before: boolean) => void }) {
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const [over, setOver] = useState<null | 'before' | 'after'>(null);
  const dragging = dragId === id;
  const btn = 'flex h-6 w-6 items-center justify-center rounded-md border border-line bg-panel text-muted shadow-sm hover:text-text disabled:opacity-30';
  return (
    <div
      onDragOver={(e) => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setOver(e.clientY < r.top + r.height / 2 ? 'before' : 'after');
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        if (dragId && dragId !== id) onReorder(dragId, id, over !== 'after');
        setOver(null);
        setDragId(null);
      }}
      className={`group/blk relative rounded-xl transition ${dragging ? 'opacity-40' : ''} ${
        over === 'before' ? 'before:absolute before:-top-1 before:left-0 before:right-0 before:h-0.5 before:rounded-full before:bg-accent before:content-[""]' : ''
      } ${over === 'after' ? 'after:absolute after:-bottom-1 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-accent after:content-[""]' : ''}`}
    >
      {/* Ручка перетаскивания (drag-and-drop меняет порядок) */}
      <div
        draggable
        onDragStart={() => setDragId(id)}
        onDragEnd={() => {
          setDragId(null);
          setOver(null);
        }}
        title="Перетащить"
        className="absolute -left-2.5 top-0 z-20 flex h-6 w-6 cursor-grab items-center justify-center rounded-md border border-line bg-panel text-muted shadow-sm opacity-0 transition hover:text-text group-hover/blk:opacity-100 active:cursor-grabbing"
      >
        <GripVertical size={13} />
      </div>
      {/* Тулбар блока */}
      <div className="absolute -right-2.5 top-0 z-20 flex flex-col gap-0.5 opacity-0 transition group-hover/blk:opacity-100">
        <button onClick={() => c.move(id, -1)} disabled={first} className={btn} title="Выше">
          <ChevronUp size={14} />
        </button>
        <button onClick={() => c.move(id, 1)} disabled={last} className={btn} title="Ниже">
          <ChevronDown size={14} />
        </button>
        <button onClick={() => c.remove(id)} className={`${btn} hover:text-danger`} title="Удалить">
          <Trash2 size={13} />
        </button>
      </div>
      {children}
      {/* Добавить блок под этим */}
      <div className="relative mt-1.5 flex justify-center">
        <button
          onClick={() => setMenu((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-0.5 text-[11px] text-muted opacity-0 transition hover:border-accent/50 hover:text-accent-ink group-hover/blk:opacity-100"
        >
          <Plus size={11} /> блок
        </button>
        {menu && (
          <div className="absolute top-7 z-30 grid w-56 grid-cols-2 gap-1 rounded-xl border border-line bg-panel p-2 shadow-2xl">
            {(more ? [...ADD_PRIMARY, ...ADD_MORE] : ADD_PRIMARY).map((t) => (
              <button
                key={t}
                onClick={() => {
                  c.add(id, t);
                  setMenu(false);
                  setMore(false);
                }}
                className="rounded-lg px-2 py-1.5 text-left text-xs hover:bg-panel-2"
              >
                {BLOCK_LABELS[t]}
              </button>
            ))}
            {!more && (
              <button onClick={() => setMore(true)} className="col-span-2 rounded-lg border border-dashed border-line px-2 py-1.5 text-center text-xs text-muted hover:text-accent-ink">
                Ещё {ADD_MORE.length}…
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Стили блока-таймера (хранятся в block.style).
export const DEADLINE_STYLES = [
  { value: 'card', label: 'Карточки' },
  { value: 'minimal', label: 'Строка' },
  { value: 'bold', label: 'Крупный' },
];

// Таймер обратного отсчёта до дедлайна сдачи — тикает каждую секунду.
// Заголовок и стиль оформления редактируются прямо в конструкторе.
function DeadlineCountdown({ deadline, timezone, label, block, onEdit }: { deadline?: string | null; timezone?: string; label?: string; block?: Block; onEdit?: (id: string, patch: Partial<Block>) => void }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const edit = !!(onEdit && block);
  const dstyle = block?.style || 'card';
  const title = label || 'До дедлайна сдачи';
  const titleEl = edit ? (
    <Editable className="text-xs font-medium uppercase tracking-wide text-accent-ink" value={title} onChange={(t) => onEdit!(block!.id, { text: t })} />
  ) : (
    <div className="text-xs font-medium uppercase tracking-wide text-accent-ink">{title}</div>
  );
  // Переключатель стиля (только в конструкторе). onDark — для тёмного/градиентного фона
  // («Крупный»), чтобы кнопки были видны и контрастны.
  const picker = (onDark: boolean) =>
    edit && (
      <div className={`mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5 ${onDark ? 'border-white/25' : 'border-line/60'}`}>
        <span className={`text-[11px] ${onDark ? 'text-on-accent/80' : 'text-muted'}`}>Стиль таймера:</span>
        {DEADLINE_STYLES.map((st) => {
          const active = dstyle === st.value;
          const cls = onDark
            ? active
              ? 'border-white bg-white/25 text-on-accent'
              : 'border-white/40 text-on-accent/80 hover:bg-white/10'
            : active
              ? 'border-accent bg-accent-soft text-accent-ink'
              : 'border-line text-muted hover:bg-panel-2';
          return (
            <button key={st.value} onClick={() => onEdit!(block!.id, { style: st.value })} className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${cls}`}>
              {st.label}
            </button>
          );
        })}
      </div>
    );

  if (!deadline) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-bg p-4">
        {titleEl}
        <p className="mt-1 text-sm text-muted">Включите «Срок сдачи» в настройках онбординга — здесь появится живой таймер обратного отсчёта.</p>
        {picker(false)}
      </div>
    );
  }

  const ms = now == null ? null : new Date(deadline).getTime() - now;
  const overdue = ms != null && ms <= 0;
  const a = ms == null ? 0 : Math.abs(ms);
  const dd = Math.floor(a / 86_400_000);
  const hh = Math.floor((a % 86_400_000) / 3_600_000);
  const mm = Math.floor((a % 3_600_000) / 60_000);
  const ss = Math.floor((a % 60_000) / 1000);
  const pad = (v: number) => (ms == null ? '--' : String(v).padStart(2, '0'));
  const dueLine = (
    <div className={`text-xs ${dstyle === 'bold' ? 'text-on-accent/80' : 'text-muted'}`}>
      Сдать до: <b className={dstyle === 'bold' ? 'text-on-accent' : 'text-text'}>{fmtInTz(deadline, timezone || '')}</b>
    </div>
  );

  // Просрочено — общий вид для любого стиля.
  if (overdue) {
    return (
      <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4">
        <div className="flex items-center gap-1.5">
          <Clock size={13} className="text-danger" />
          {titleEl}
        </div>
        <p className="mt-2 text-sm font-semibold text-danger">Дедлайн прошёл{dd > 0 ? ` ${dd} дн` : ''} {hh} ч {mm} мин назад</p>
        <div className="mt-2.5">{dueLine}</div>
        {picker(false)}
      </div>
    );
  }

  // Стиль «Строка» — компактный однострочный отсчёт.
  if (dstyle === 'minimal') {
    return (
      <div className="rounded-xl border border-accent/25 bg-accent-soft/40 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Clock size={14} className="shrink-0 text-accent-ink" />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs text-accent-ink">{title}:</span>
              <span className="tabular-nums text-sm font-bold">
                {dd > 0 ? `${dd}д ` : ''}
                {pad(hh)}:{pad(mm)}:{pad(ss)}
              </span>
            </div>
            <div className="text-[11px] text-muted">
              до {fmtInTz(deadline, timezone || '')}
            </div>
          </div>
        </div>
        {picker(false)}
      </div>
    );
  }

  // Стиль «Крупный» — заметный акцентный баннер. Короткие подписи + компактные отступы,
  // чтобы 4 ячейки гарантированно влезали в узкое превью телефона.
  if (dstyle === 'bold') {
    const bcell = (v: number, lbl: string) => (
      <div className="flex min-w-0 flex-col items-center">
        <span className="tabular-nums text-2xl font-extrabold leading-none text-on-accent">{pad(v)}</span>
        <span className="mt-1 text-[9px] uppercase tracking-wide text-on-accent/70">{lbl}</span>
      </div>
    );
    const bsep = <span className="self-start pt-0.5 text-xl leading-none text-on-accent/50">:</span>;
    return (
      <div className="th-grad overflow-hidden rounded-2xl p-4 text-on-accent shadow-lg shadow-accent/20">
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="shrink-0 text-on-accent" />
          <div className="min-w-0 text-xs font-semibold uppercase tracking-wide text-on-accent">{edit ? <Editable className="text-on-accent" value={title} onChange={(t) => onEdit!(block!.id, { text: t })} /> : title}</div>
        </div>
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {dd > 0 && (
            <>
              {bcell(dd, 'дн')}
              {bsep}
            </>
          )}
          {bcell(hh, 'ч')}
          {bsep}
          {bcell(mm, 'мин')}
          {bsep}
          {bcell(ss, 'сек')}
        </div>
        <div className="mt-2.5">{dueLine}</div>
        {picker(true)}
      </div>
    );
  }

  // Стиль «Карточки» (по умолчанию).
  const cell = (v: number, lbl: string) => (
    <div className="flex flex-col items-center rounded-lg bg-panel px-2.5 py-1.5 shadow-sm">
      <span className="tabular-nums text-2xl font-bold leading-none">{pad(v)}</span>
      <span className="mt-1 text-[10px] uppercase tracking-wide text-muted">{lbl}</span>
    </div>
  );
  return (
    <div className="rounded-2xl border border-accent/25 bg-accent-soft/40 p-4">
      <div className="flex items-center gap-1.5">
        <Clock size={13} className="text-accent-ink" />
        {titleEl}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {dd > 0 && cell(dd, 'дней')}
        {cell(hh, 'часов')}
        {cell(mm, 'минут')}
        {cell(ss, 'секунд')}
      </div>
      <div className="mt-2.5">{dueLine}</div>
      {picker(false)}
    </div>
  );
}

export function BlockView({
  b,
  values,
  setVal,
  consents,
  setConsents,
  company,
  positions,
  onEdit,
  deadline,
  timezone,
}: {
  b: Block;
  values: Record<string, string>;
  setVal: (k: string, v: string) => void;
  consents: Record<string, boolean>;
  setConsents: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  company?: CompanyProfile | null;
  positions?: string[];
  onEdit?: (blockId: string, patch: Partial<Block>) => void;
  deadline?: string | null;
  timezone?: string;
}) {
  if (b.type === 'company') return <CompanyCard company={company} block={b} onEdit={onEdit} />;
  if (b.type === 'positions') return <PositionsList positions={positions} block={b} onEdit={onEdit} />;
  if (b.type === 'deadline')
    return <DeadlineCountdown deadline={deadline} timezone={timezone} label={b.text} block={b} onEdit={onEdit} />;
  if (b.type === 'heading')
    return onEdit ? (
      <Editable className="text-base font-semibold" value={b.text || ''} onChange={(t) => onEdit(b.id, { text: t })} />
    ) : (
      <div className="text-base font-semibold">{b.text}</div>
    );
  if (b.type === 'text')
    return onEdit ? (
      <Editable className="text-sm text-muted" value={b.text || ''} onChange={(t) => onEdit(b.id, { text: t })} />
    ) : (
      <p className="whitespace-pre-wrap text-sm text-muted">{b.text}</p>
    );

  if (b.type === 'image') return b.url ? <img src={b.url} alt="" className="w-full rounded-xl border border-line" /> : null;
  if (b.type === 'video') {
    if (!b.url) return null;
    const embed = ytEmbed(b.url);
    return embed ? (
      <div className="aspect-video overflow-hidden rounded-xl border border-line">
        <iframe src={embed} className="h-full w-full" allowFullScreen title="video" />
      </div>
    ) : (
      <video src={b.url} controls className="w-full rounded-xl border border-line" />
    );
  }
  if (b.type === 'file')
    return b.url ? (
      <a href={b.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-line bg-bg px-4 py-2.5 text-sm hover:border-accent/40">
        📎 {b.label || 'Скачать материалы'}
      </a>
    ) : null;
  if (b.type === 'faq')
    return (
      <div className="space-y-1.5">
        {(b.faq || []).map((it, i) => (
          <details key={i} className="rounded-xl border border-line bg-bg px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">{it.q}</summary>
            <p className="mt-1.5 whitespace-pre-wrap text-muted">{it.a}</p>
          </details>
        ))}
      </div>
    );
  if (b.type === 'support') {
    const href = b.url ? (b.url.startsWith('@') ? `https://t.me/${b.url.slice(1)}` : b.url.includes('@') && !b.url.startsWith('http') ? `mailto:${b.url}` : b.url) : '';
    return (
      <div className="rounded-xl border border-line bg-bg p-3 text-sm">
        <span className="text-muted">{b.text}</span>{' '}
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="font-medium text-accent-ink hover:underline">
            {b.label || 'Написать'}
          </a>
        )}
      </div>
    );
  }
  if (b.type === 'consent')
    return (
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" checked={!!consents[b.id]} onChange={(e) => setConsents((s) => ({ ...s, [b.id]: e.target.checked }))} className="mt-0.5 accent-accent" />
        {b.text}
      </label>
    );
  if (b.type === 'submit') {
    const k = b.key || 'work_url';
    return (
      <div>
        {onEdit ? (
          <Editable className="mb-1.5 text-sm" value={b.label || ''} onChange={(t) => onEdit(b.id, { label: t })} />
        ) : (
          <label className="mb-1.5 block text-sm">{b.label || 'Ссылка на работу'}</label>
        )}
        <Input placeholder="https://…" value={values[k] || ''} onChange={(e) => setVal(k, e.target.value)} />
      </div>
    );
  }
  if (b.type === 'choice') {
    const k = b.key || b.id;
    return (
      <div>
        {onEdit ? (
          <div className="mb-2 flex items-center gap-1 text-sm">
            <Editable value={b.label || ''} onChange={(t) => onEdit(b.id, { label: t })} />
            {b.required && <span className="text-danger">*</span>}
          </div>
        ) : (
          <label className="mb-2 block text-sm">
            {b.label} {b.required && <span className="text-danger">*</span>}
          </label>
        )}
        <div className="flex flex-col gap-2">
          {(b.options || []).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setVal(k, o)}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${values[k] === o ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:border-accent/40'}`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (b.type === 'multi') {
    const k = b.key || b.id;
    const sel = (values[k] || '').split('|').filter(Boolean);
    const toggle = (o: string) => {
      const next = sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o];
      setVal(k, next.join('|'));
    };
    return (
      <div>
        <label className="mb-2 block text-sm">{b.label}</label>
        <div className="flex flex-wrap gap-2">
          {(b.options || []).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${sel.includes(o) ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:border-accent/40'}`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (b.type === 'scale') {
    const k = b.key || b.id;
    const max = b.max || 5;
    const cur = values[k] ? +values[k] : 0;
    return (
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label className="text-sm">
            {b.label} {b.required && <span className="text-danger">*</span>}
          </label>
          <span className="font-display text-lg font-semibold tabular-nums text-accent-ink">
            {cur || '—'}
            <span className="text-xs text-muted">/{max}</span>
          </span>
        </div>
        <input type="range" min={1} max={max} value={cur || 1} onChange={(e) => setVal(k, e.target.value)} className="w-full accent-accent" />
        <div className="mt-1 flex justify-between text-xs text-muted">
          <span>{b.minLabel || '1'}</span>
          <span>{b.maxLabel || max}</span>
        </div>
      </div>
    );
  }
  // field
  const k = b.key || b.id;
  return (
    <div>
      {onEdit ? (
        <div className="mb-1.5 flex items-center gap-1 text-sm">
          <Editable value={b.label || ''} onChange={(t) => onEdit(b.id, { label: t })} />
          {b.required && <span className="text-danger">*</span>}
        </div>
      ) : (
        <label className="mb-1.5 block text-sm">
          {b.label} {b.required && <span className="text-danger">*</span>}
        </label>
      )}
      {b.input === 'textarea' ? (
        <Textarea value={values[k] || ''} onChange={(e) => setVal(k, e.target.value)} />
      ) : (
        <Input type={b.input === 'email' ? 'email' : 'text'} value={values[k] || ''} onChange={(e) => setVal(k, e.target.value)} />
      )}
    </div>
  );
}

// Пресеты оформления обложки блока «О компании».
// Пресеты оформления карточки компании. Меняют ВСЮ карточку (фон, текст, чипы,
// обложку), а не только высоту обложки — чтобы переключение было заметным даже с
// загруженными лого/обложкой.
interface CompanyTheme {
  card: string; // корень карточки
  coverH: string; // высота обложки
  coverBg: string; // фон обложки, когда нет картинки
  coverTint: string; // затемнение/тон поверх картинки-обложки
  logoBorder: string; // рамка логотипа (под фон карточки)
  name: string; // название
  sub: string; // ниша/«о компании»
  chip: string; // перк-чип
}
const COMPANY_THEME: Record<string, CompanyTheme> = {
  minimal: { card: 'border border-line bg-bg', coverH: 'h-16', coverBg: 'bg-panel-2', coverTint: '', logoBorder: 'border-bg', name: 'text-text', sub: 'text-muted', chip: 'bg-accent-soft text-accent-ink' },
  gradient: { card: 'border border-accent/25 bg-bg', coverH: 'h-24', coverBg: 'th-grad', coverTint: 'bg-gradient-to-t from-black/25 to-transparent', logoBorder: 'border-bg', name: 'text-text', sub: 'text-muted', chip: 'bg-accent-soft text-accent-ink' },
  dark: { card: 'border border-neutral-800 bg-neutral-900 text-neutral-100', coverH: 'h-20', coverBg: 'bg-neutral-800', coverTint: 'bg-neutral-950/40', logoBorder: 'border-neutral-900', name: 'text-white', sub: 'text-neutral-400', chip: 'bg-white/10 text-white' },
  bold: { card: 'border-0 bg-bg ring-2 ring-accent/40 shadow-lg shadow-accent/10', coverH: 'h-28', coverBg: 'th-grad', coverTint: 'bg-gradient-to-t from-black/30 to-transparent', logoBorder: 'border-bg', name: 'text-lg font-bold text-text', sub: 'text-muted', chip: 'bg-accent text-on-accent' },
};
export const COMPANY_STYLES = [
  { value: 'minimal', label: 'Минимал' },
  { value: 'gradient', label: 'Градиент' },
  { value: 'dark', label: 'Тёмный' },
  { value: 'bold', label: 'Яркий' },
];

// Презентация компании: данные из «Голоса бренда» + переопределения. В режиме
// конструктора (onEdit) логотип/обложку/стиль/тексты можно менять прямо в карточке.
function CompanyCard({ company, block, onEdit }: { company?: CompanyProfile | null; block?: Block; onEdit?: (blockId: string, patch: Partial<Block>) => void }) {
  const edit = !!(onEdit && block);
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'logo' | 'cover' | null>(null);

  const name = (block?.label || company?.name || '').trim() || 'Ваша компания';
  const about = (block?.text || company?.about || '').trim();
  const initial = name.charAt(0).toUpperCase();
  const logo = block?.logo;
  const cover = block?.cover;
  const style = block?.style || 'minimal';
  const theme = COMPANY_THEME[style] || COMPANY_THEME.minimal;
  // Перки-чипы: если в блоке задано переопределение — берём его, иначе из «Голоса бренда».
  const perks = (
    block?.perks ??
    (company?.perks || '')
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  ).slice(0, 8);
  const setPerks = (next: string[]) => onEdit!(block!.id, { perks: next });
  let social = (company?.social || '').trim();
  if (social && !/^https?:\/\//i.test(social)) social = social.startsWith('@') ? `https://t.me/${social.slice(1)}` : `https://${social}`;

  async function upload(kind: 'logo' | 'cover', f: File) {
    if (!edit) return;
    setBusy(kind);
    try {
      const r = await api.upload(f);
      onEdit!(block!.id, kind === 'logo' ? { logo: r.url } : { cover: r.url });
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
      if (kind === 'logo' && logoRef.current) logoRef.current.value = '';
      if (kind === 'cover' && coverRef.current) coverRef.current.value = '';
    }
  }

  return (
    <div className={`overflow-hidden rounded-2xl ${theme.card}`}>
      {edit && (
        <>
          <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload('logo', e.target.files[0])} />
          <input ref={coverRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload('cover', e.target.files[0])} />
        </>
      )}

      {/* Обложка (картинка или пресет-фон) + оверлей редактирования */}
      <div
        className={`group/cover relative w-full ${theme.coverH} ${cover ? '' : theme.coverBg}`}
        style={cover ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        {/* Тон поверх картинки-обложки — зависит от стиля */}
        {cover && theme.coverTint && <div className={`pointer-events-none absolute inset-0 ${theme.coverTint}`} />}
        {edit && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition group-hover/cover:bg-black/35 group-hover/cover:opacity-100">
            <button onClick={() => coverRef.current?.click()} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-900 shadow">
              <ImagePlus size={12} /> {busy === 'cover' ? 'Загружаю…' : cover ? 'Сменить обложку' : 'Добавить обложку'}
            </button>
            {cover && (
              <button onClick={() => onEdit!(block!.id, { cover: '' })} className="rounded-full bg-white/25 px-2.5 py-1 text-xs text-white">убрать</button>
            )}
          </div>
        )}
      </div>

      <div className="px-4 pb-4">
        {/* Логотип «наезжает» на обложку (клик → загрузка); название — ПОД ним, чтобы не перекрывалось. */}
        <div className="-mt-7">
          {edit ? (
            <button onClick={() => logoRef.current?.click()} title="Загрузить логотип" className={`group/logo relative h-14 w-14 overflow-hidden rounded-2xl border-4 ${theme.logoBorder}`}>
              {logo ? (
                <img src={logo} alt="" className="h-full w-full bg-panel object-cover" />
              ) : (
                <div className="th-grad flex h-full w-full items-center justify-center text-lg font-bold">{initial}</div>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover/logo:bg-black/45 group-hover/logo:opacity-100">
                {busy === 'logo' ? '…' : <ImagePlus size={16} />}
              </span>
            </button>
          ) : logo ? (
            <img src={logo} alt="" className={`h-14 w-14 rounded-2xl border-4 ${theme.logoBorder} bg-panel object-cover`} />
          ) : (
            <div className={`th-grad flex h-14 w-14 items-center justify-center rounded-2xl border-4 ${theme.logoBorder} text-lg font-bold`}>{initial}</div>
          )}
        </div>
        <div className="mt-2">
          {edit ? (
            <Editable className={`font-semibold ${theme.name}`} value={name} onChange={(t) => onEdit!(block!.id, { label: t })} />
          ) : (
            <div className={`truncate font-semibold ${theme.name}`}>{name}</div>
          )}
          {company?.niche && <div className={`truncate text-xs ${theme.sub}`}>{company.niche}</div>}
        </div>

        {edit ? (
          <Editable className={`mt-3 text-sm ${theme.sub}`} value={about} onChange={(t) => onEdit!(block!.id, { text: t })} />
        ) : (
          about && <p className={`mt-3 whitespace-pre-wrap text-sm ${theme.sub}`}>{about}</p>
        )}

        {edit ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {perks.map((p, i) => (
              <span key={i} className={`group/perk inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${theme.chip}`}>
                <Editable
                  className="min-w-[1ch]"
                  value={p}
                  onChange={(t) => {
                    const next = perks.slice();
                    const v = t.trim();
                    if (v) next[i] = v;
                    else next.splice(i, 1);
                    setPerks(next);
                  }}
                />
                <button onClick={() => setPerks(perks.filter((_, j) => j !== i))} className="opacity-50 hover:text-danger hover:opacity-100" title="Убрать">
                  <X size={11} />
                </button>
              </span>
            ))}
            {perks.length < 8 && (
              <button onClick={() => setPerks([...perks, 'Новое преимущество'])} className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-muted hover:border-accent/50 hover:text-accent-ink">
                <Plus size={11} /> чип
              </button>
            )}
          </div>
        ) : (
          perks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {perks.map((p, i) => (
                <span key={i} className={`rounded-full px-2.5 py-1 text-xs ${theme.chip}`}>{p}</span>
              ))}
            </div>
          )
        )}
        {social && (
          <a href={social} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
            Соцсети компании <ArrowRight size={13} />
          </a>
        )}

        {/* Выбор стиля прямо в карточке (только в конструкторе) */}
        {edit && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
            <span className="text-[11px] text-muted">Стиль:</span>
            {COMPANY_STYLES.map((st) => (
              <button
                key={st.value}
                onClick={() => onEdit!(block!.id, { style: st.value })}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${style === st.value ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-panel-2'}`}
              >
                {st.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Другие активные вакансии компании — тёплый кросс-сейл («ещё нанимаем»).
const EMOJI_PRESETS = ['💼', '🚀', '🎬', '🎨', '✍️', '📈', '💻', '📣', '🎯', '⭐', '🔥', '🧩'];

// Мини-выбор эмодзи для вакансии.
function EmojiPick({ value, onChange }: { value?: string; onChange: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button onClick={() => setOpen((v) => !v)} className="leading-none hover:opacity-70" title="Эмодзи">
        {value || '＋'}
      </button>
      {open && (
        <span className="absolute left-0 top-6 z-30 flex w-44 flex-wrap items-center gap-1 rounded-xl border border-line bg-panel p-2 shadow-2xl">
          {EMOJI_PRESETS.map((e) => (
            <button key={e} onClick={() => { onChange(e); setOpen(false); }} className="text-lg transition-transform hover:scale-125">
              {e}
            </button>
          ))}
          <button onClick={() => { onChange(''); setOpen(false); }} className="ml-1 text-[11px] text-muted hover:text-text">
            убрать
          </button>
        </span>
      )}
    </span>
  );
}

// Другие активные вакансии компании — тёплый кросс-сейл. В конструкторе можно
// выбрать конкретные вакансии из своих поисков и добавить эмодзи; пусто = авто.
function PositionsList({ positions, block, onEdit }: { positions?: string[]; block?: Block; onEdit?: (blockId: string, patch: Partial<Block>) => void }) {
  const edit = !!(onEdit && block);
  const auto = (positions || []).filter(Boolean);
  const picks = block?.picks;
  // Что показываем: ручной список (если задан) либо авто-вакансии.
  const using: { label: string; emoji?: string }[] = picks && picks.length ? picks : auto.map((t) => ({ label: t }));
  const setPicks = (next: { label: string; emoji?: string }[]) => onEdit!(block!.id, { picks: next });

  if (!edit && !using.length) return null;

  const pickedLabels = new Set((picks || []).map((p) => p.label));
  const available = auto.filter((t) => !pickedLabels.has(t));

  return (
    <div className="rounded-2xl border border-line bg-bg p-4">
      <div className="text-xs uppercase tracking-wide text-muted">Компания также нанимает</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {using.map((p, i) =>
          edit ? (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-sm">
              <EmojiPick value={p.emoji} onChange={(e) => setPicks(using.map((x, j) => (j === i ? { ...x, emoji: e } : x)))} />
              <Editable className="min-w-[2ch]" value={p.label} onChange={(t) => setPicks(using.map((x, j) => (j === i ? { ...x, label: t.trim() } : x)))} />
              <button onClick={() => setPicks(using.filter((_, j) => j !== i))} className="opacity-50 hover:text-danger hover:opacity-100" title="Убрать">
                <X size={11} />
              </button>
            </span>
          ) : (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-sm">
              {p.emoji && <span>{p.emoji}</span>}
              {p.label}
            </span>
          )
        )}
        {edit && (
          <button onClick={() => setPicks([...using, { label: 'Новая вакансия', emoji: '💼' }])} className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-line px-2.5 py-1 text-sm text-muted hover:border-accent/50 hover:text-accent-ink">
            <Plus size={12} /> вакансия
          </button>
        )}
      </div>
      {edit && available.length > 0 && (
        <div className="mt-2.5 flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">Добавить из моих:</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setPicks([...using, { label: e.target.value, emoji: '💼' }]);
            }}
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1 text-text"
          >
            <option value="">выбрать вакансию…</option>
            {available.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// Преобразует ссылку YouTube/Vimeo в embed-URL (иначе null → <video>).
export function ytEmbed(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

// Интерактивный предпросмотр всего флоу (как увидит кандидат), без API и без
// записи ответов. Можно листать страницы вперёд/назад, заполнять поля.
// Hex → rgba с альфой (для --accent-soft).
function hexToRgba(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return `rgba(109,92,246,${a})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function FlowPreview({ flow, role, company, positions, device = 'phone', onEdit, controls, onAddPage, onAddBlockToPage, onReorder, deadline, timezone }: { flow: Flow; role: string; company?: CompanyProfile | null; positions?: string[]; device?: 'phone' | 'desktop'; onEdit?: (blockId: string, patch: Partial<Block>) => void; controls?: BlockControls; onAddPage?: () => void; onAddBlockToPage?: (pageIdx: number, type: BlockType) => void; onReorder?: (fromId: string, toId: string, before: boolean) => void; deadline?: string | null; timezone?: string }) {
  const [idx, setIdx] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const pages = flow.pages || [];
  const total = pages.length;
  const done = idx >= total;
  const page = pages[idx];
  const setVal = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  // Акцентный цвет страницы кандидата — перекрашивает кнопки/прогресс/чипы.
  const accentStyle = flow.accent
    ? ({ '--accent': flow.accent, '--accent-press': flow.accent, '--accent-ink': flow.accent, '--accent-soft': hexToRgba(flow.accent, 0.14), '--on-accent': '#ffffff' } as CSSProperties)
    : undefined;
  const widthClass = device === 'desktop' ? 'max-w-2xl' : 'max-w-md';

  return (
    <div className="th-aurora relative flex min-h-full w-full flex-col" style={accentStyle}>
      <div className="th-grid pointer-events-none absolute inset-0 opacity-[0.25]" />
      <div className={`relative mx-auto flex w-full ${widthClass} flex-1 flex-col justify-center px-4 py-6`}>
        <div className="th-rise rounded-3xl border border-line bg-panel/90 p-5 shadow-2xl shadow-black/[0.06] backdrop-blur">
          <div className="text-xs font-medium uppercase tracking-wide text-accent-ink">{company?.name ? company.name : 'Отклик на роль'}</div>
          <h1 className="mt-1 text-2xl font-semibold leading-tight">{role || 'Роль'}</h1>

          {total === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Пока нет страниц. Добавь блоки в конструкторе слева.</p>
          ) : done ? (
            <CompletionView onRestart={() => setIdx(0)} />
          ) : (
            <div className="mt-5">
              {/* Навигация по шагам в конструкторе: переключай/добавляй страницы прямо в превью */}
              {controls && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  {pages.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setIdx(i)}
                      className={`h-6 min-w-6 rounded-full px-2 text-xs font-medium transition ${i === idx ? 'bg-accent text-on-accent' : 'border border-line text-muted hover:text-text'}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  {onAddPage && (
                    <button onClick={onAddPage} className="inline-flex h-6 items-center gap-0.5 rounded-full border border-dashed border-line px-2 text-xs text-muted hover:border-accent/50 hover:text-accent-ink" title="Добавить шаг">
                      <Plus size={11} /> шаг
                    </button>
                  )}
                </div>
              )}
              <OnbProgress step={idx} total={total} />
              <div key={idx} className="anim-up relative z-10 space-y-4">
                {page.blocks.map((b, bi) =>
                  controls && onReorder ? (
                    <BlockWrap key={b.id} id={b.id} first={bi === 0} last={bi === page.blocks.length - 1} c={controls} dragId={dragId} setDragId={setDragId} onReorder={onReorder}>
                      <BlockView b={b} values={values} setVal={setVal} consents={consents} setConsents={setConsents} company={company} positions={positions} onEdit={onEdit} deadline={deadline} timezone={timezone} />
                    </BlockWrap>
                  ) : (
                    <BlockView key={b.id} b={b} values={values} setVal={setVal} consents={consents} setConsents={setConsents} company={company} positions={positions} onEdit={onEdit} deadline={deadline} timezone={timezone} />
                  )
                )}
                {/* Добавить блок в конец пустой/любой страницы */}
                {controls && page.blocks.length === 0 && onAddBlockToPage && (
                  <button onClick={() => onAddBlockToPage(idx, 'heading')} className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-line py-3 text-sm text-muted hover:border-accent/50 hover:text-accent-ink">
                    <Plus size={14} /> Добавить блок
                  </button>
                )}
              </div>
              <div className="relative z-0 mt-6 flex gap-2">
                <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
                  Назад
                </Button>
                <Button variant="accent" className="flex-1" onClick={() => setIdx((i) => i + 1)}>
                  {idx === total - 1 ? 'Завершить' : 'Далее'} <ArrowRight size={15} />
                </Button>
              </div>
            </div>
          )}
          <PoweredBy />
        </div>
      </div>
    </div>
  );
}
