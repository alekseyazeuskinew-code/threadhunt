'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, ArrowRight, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import type { Flow, Block } from '@/lib/flow';
import { fmtInTz } from '@/lib/timezones';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';

interface FlowResp {
  company: string;
  role: string;
  flow: Flow;
  deadline: string | null;
  timezone: string;
  progress: { obStep: number; responses: Record<string, string> };
}

// Публичный онбординг кандидата: динамический рендер страниц/блоков конструктора.
export default function CandidateFlow() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<FlowResp | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [idx, setIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api
      .get<FlowResp>(`/api/c/${token}`)
      .then((d) => {
        setData(d);
        setValues(d.progress.responses || {});
        setIdx(Math.min(d.progress.obStep, d.flow.pages.length));
      })
      .catch(() => setNotFound(true));
  }, [token]);

  if (notFound) return <Center>Ссылка недействительна или устарела.</Center>;
  if (!data) return <Center>Загрузка…</Center>;

  const pages = data.flow.pages;
  const done = idx >= pages.length;
  const page = pages[idx];
  const total = pages.length;

  const setVal = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));

  async function next() {
    setErr('');
    // валидация полей и согласий на странице
    let workUrl: string | undefined;
    let consentOk = true;
    let hasConsent = false;
    for (const b of page.blocks) {
      if ((b.type === 'field' || b.type === 'choice' || b.type === 'scale') && b.required && !(values[b.key || ''] || '').trim()) {
        setErr('Заполни обязательные поля.');
        return;
      }
      if (b.type === 'submit') {
        const v = (values[b.key || 'work_url'] || '').trim();
        if (!v) {
          setErr('Добавь ссылку на работу.');
          return;
        }
        workUrl = v;
      }
      if (b.type === 'consent') {
        hasConsent = true;
        if (!consents[b.id]) consentOk = false;
      }
    }
    if (hasConsent && !consentOk) {
      setErr('Отметь согласие, чтобы продолжить.');
      return;
    }

    setBusy(true);
    try {
      const last = idx === pages.length - 1;
      await api.post(`/api/c/${token}/step`, { index: idx, values, consent: hasConsent, workUrl, last });
      setIdx((i) => i + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col px-5 py-10">
      <div className="mb-6 text-lg">
        <Wordmark />
      </div>

      <div className="rounded-2xl border border-line bg-panel p-6">
        <div className="text-sm text-muted">{data.company ? `${data.company} · ` : ''}отклик на роль</div>
        <h1 className="mt-0.5 text-2xl font-semibold">{data.role}</h1>

        {done ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
              <Check size={24} />
            </div>
            <div className="mt-3 text-lg font-medium">Спасибо! Мы всё получили.</div>
            <p className="mt-1 text-sm text-muted">Свяжемся с тобой по оставленным контактам.</p>
          </div>
        ) : (
          <>
            {data.deadline && <DeadlineBanner deadline={data.deadline} tz={data.timezone} now={now} />}
            <div className="mt-1 text-xs text-muted">Шаг {idx + 1} из {total} · {page.title}</div>
            <div className="mt-5 space-y-4">
              {page.blocks.map((b) => (
                <BlockView key={b.id} b={b} values={values} setVal={setVal} consents={consents} setConsents={setConsents} />
              ))}
            </div>
            {err && <div className="mt-3 text-sm text-danger">{err}</div>}
            <Button className="mt-5 w-full" disabled={busy} onClick={next}>
              {idx === pages.length - 1 ? 'Завершить' : 'Далее'} <ArrowRight size={15} />
            </Button>
          </>
        )}
      </div>
      <div className="mt-4 text-center text-xs text-muted">Работает на Threadhunt</div>
    </div>
  );
}

function BlockView({
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

  if (b.type === 'image')
    return b.url ? <img src={b.url} alt="" className="w-full rounded-xl border border-line" /> : null;
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
        <label className="mb-2 block text-sm">{b.label} {b.required && <span className="text-danger">*</span>}</label>
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
          <label className="text-sm">{b.label} {b.required && <span className="text-danger">*</span>}</label>
          <span className="font-display text-lg font-semibold tabular-nums text-accent-ink">{cur || '—'}<span className="text-xs text-muted">/{max}</span></span>
        </div>
        {/* бегунок */}
        <input
          type="range"
          min={1}
          max={max}
          value={cur || 1}
          onChange={(e) => setVal(k, e.target.value)}
          className="w-full accent-accent"
        />
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

// Дедлайн сдачи + обратный отсчёт (в выбранном часовом поясе).
function DeadlineBanner({ deadline, tz, now }: { deadline: string; tz: string; now: number }) {
  const ms = new Date(deadline).getTime() - now;
  const overdue = ms <= 0;
  const h = Math.floor(Math.abs(ms) / 3600_000);
  const m = Math.floor((Math.abs(ms) % 3600_000) / 60_000);
  const tzLabel = tz ? '' : ' (твоё время)';
  return (
    <div className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${overdue ? 'border-danger/30 bg-danger/5 text-danger' : 'border-warning/30 bg-warning/5 text-warning'}`}>
      <Clock size={15} className="shrink-0" />
      <span>
        Дедлайн: <b>{fmtInTz(deadline, tz)}</b>{tzLabel} ·{' '}
        {overdue ? `просрочено на ${h}ч ${m}м` : `осталось ${h}ч ${m}м`}
      </span>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-6 text-center text-muted">{children}</div>;
}

// Преобразует ссылку YouTube/Vimeo в embed-URL (иначе вернёт null → отрендерим <video>).
function ytEmbed(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}
