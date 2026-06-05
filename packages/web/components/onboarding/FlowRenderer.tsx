'use client';
import { useState } from 'react';
import { Check, ArrowRight } from 'lucide-react';
import type { Block, Flow } from '@/lib/flow';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';

// Рендер одного блока онбординга. Общий для публичной страницы кандидата и для
// предпросмотра в конструкторе — чтобы превью было 1:1 тем, что увидит кандидат.
export function BlockView({
  b,
  values,
  setVal,
  consents,
  setConsents,
}: {
  b: Block;
  values: Record<string, string>;
  setVal: (k: string, v: string) => void;
  consents: Record<string, boolean>;
  setConsents: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  if (b.type === 'heading') return <div className="text-base font-semibold">{b.text}</div>;
  if (b.type === 'text') return <p className="whitespace-pre-wrap text-sm text-muted">{b.text}</p>;

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
        <label className="mb-1.5 block text-sm">{b.label || 'Ссылка на работу'}</label>
        <Input placeholder="https://…" value={values[k] || ''} onChange={(e) => setVal(k, e.target.value)} />
      </div>
    );
  }
  if (b.type === 'choice') {
    const k = b.key || b.id;
    return (
      <div>
        <label className="mb-2 block text-sm">
          {b.label} {b.required && <span className="text-danger">*</span>}
        </label>
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
      <label className="mb-1.5 block text-sm">
        {b.label} {b.required && <span className="text-danger">*</span>}
      </label>
      {b.input === 'textarea' ? (
        <Textarea value={values[k] || ''} onChange={(e) => setVal(k, e.target.value)} />
      ) : (
        <Input type={b.input === 'email' ? 'email' : 'text'} value={values[k] || ''} onChange={(e) => setVal(k, e.target.value)} />
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
export function FlowPreview({ flow, role, company }: { flow: Flow; role: string; company?: string }) {
  const [idx, setIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const pages = flow.pages || [];
  const total = pages.length;
  const done = idx >= total;
  const page = pages[idx];
  const setVal = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-line bg-panel p-6">
        <div className="text-sm text-muted">{company ? `${company} · ` : ''}отклик на роль</div>
        <h1 className="mt-0.5 text-2xl font-semibold">{role || 'Роль'}</h1>

        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Пока нет страниц. Добавь блоки в конструкторе слева.</p>
        ) : done ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
              <Check size={24} />
            </div>
            <div className="mt-3 text-lg font-medium">Спасибо! Мы всё получили.</div>
            <p className="mt-1 text-sm text-muted">Свяжемся с тобой по оставленным контактам.</p>
            <Button variant="ghost" className="mt-4" onClick={() => setIdx(0)}>
              Пройти заново
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-1 text-xs text-muted">
              Шаг {idx + 1} из {total} · {page.title}
            </div>
            <div className="mt-5 space-y-4">
              {page.blocks.map((b) => (
                <BlockView key={b.id} b={b} values={values} setVal={setVal} consents={consents} setConsents={setConsents} />
              ))}
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
                Назад
              </Button>
              <Button className="flex-1" onClick={() => setIdx((i) => i + 1)}>
                {idx === total - 1 ? 'Завершить' : 'Далее'} <ArrowRight size={15} />
              </Button>
            </div>
          </>
        )}
      </div>
      <div className="mt-3 text-center text-xs text-muted">Предпросмотр — так страницу увидит кандидат. Ответы не сохраняются.</div>
    </div>
  );
}
