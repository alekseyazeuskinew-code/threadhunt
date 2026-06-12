'use client';
import { useState } from 'react';
import { Check, ArrowRight } from 'lucide-react';
import type { Block, Flow } from '@/lib/flow';
import type { CompanyProfile } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';

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
export function BlockView({
  b,
  values,
  setVal,
  consents,
  setConsents,
  company,
  positions,
}: {
  b: Block;
  values: Record<string, string>;
  setVal: (k: string, v: string) => void;
  consents: Record<string, boolean>;
  setConsents: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  company?: CompanyProfile | null;
  positions?: string[];
}) {
  if (b.type === 'company') return <CompanyCard company={company} block={b} />;
  if (b.type === 'positions') return <PositionsList positions={positions} />;
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

// Пресеты оформления обложки блока «О компании».
const COVER_PRESET: Record<string, string> = {
  minimal: 'h-16 bg-panel-2',
  gradient: 'h-24 th-grad',
  dark: 'h-20 bg-neutral-900',
  bold: 'h-28 th-grad',
};
export const COMPANY_STYLES = [
  { value: 'minimal', label: 'Минимал' },
  { value: 'gradient', label: 'Градиент' },
  { value: 'dark', label: 'Тёмный' },
  { value: 'bold', label: 'Яркий' },
];

// Презентация компании: данные из «Голоса бренда», но название/«о компании»/логотип/
// обложку/стиль можно переопределить в блоке (поля logo/cover/style/label/text).
function CompanyCard({ company, block }: { company?: CompanyProfile | null; block?: Block }) {
  const name = (block?.label || company?.name || '').trim() || 'Ваша компания';
  const about = (block?.text || company?.about || '').trim();
  const initial = name.charAt(0).toUpperCase();
  const logo = block?.logo;
  const cover = block?.cover;
  const style = block?.style || 'minimal';
  const perks = (company?.perks || '')
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  let social = (company?.social || '').trim();
  if (social && !/^https?:\/\//i.test(social)) social = social.startsWith('@') ? `https://t.me/${social.slice(1)}` : `https://${social}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg">
      {/* Обложка (картинка или пресет-фон) */}
      <div
        className={`w-full ${COVER_PRESET[style] || COVER_PRESET.minimal}`}
        style={cover ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      />
      <div className="px-4 pb-4">
        {/* Логотип «наезжает» на обложку */}
        <div className="-mt-7 flex items-end gap-3">
          {logo ? (
            <img src={logo} alt="" className="h-14 w-14 shrink-0 rounded-2xl border-4 border-bg bg-panel object-cover" />
          ) : (
            <div className="th-grad flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-4 border-bg text-lg font-bold">{initial}</div>
          )}
          <div className="min-w-0 pb-1">
            <div className="truncate font-semibold">{name}</div>
            {company?.niche && <div className="truncate text-xs text-muted">{company.niche}</div>}
          </div>
        </div>
        {about && <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{about}</p>}
        {perks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {perks.map((p, i) => (
              <span key={i} className="rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent-ink">{p}</span>
            ))}
          </div>
        )}
        {social && (
          <a href={social} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
            Соцсети компании <ArrowRight size={13} />
          </a>
        )}
      </div>
    </div>
  );
}

// Другие активные вакансии компании — тёплый кросс-сейл («ещё нанимаем»).
function PositionsList({ positions }: { positions?: string[] }) {
  const list = (positions || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="rounded-2xl border border-line bg-bg p-4">
      <div className="text-xs uppercase tracking-wide text-muted">Компания также нанимает</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {list.map((t, i) => (
          <span key={i} className="rounded-full border border-line px-3 py-1 text-sm">{t}</span>
        ))}
      </div>
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
export function FlowPreview({ flow, role, company, positions }: { flow: Flow; role: string; company?: CompanyProfile | null; positions?: string[] }) {
  const [idx, setIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const pages = flow.pages || [];
  const total = pages.length;
  const done = idx >= total;
  const page = pages[idx];
  const setVal = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <div className="th-aurora relative flex min-h-full w-full flex-col">
      <div className="th-grid pointer-events-none absolute inset-0 opacity-[0.25]" />
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-7">
        <div className="th-rise rounded-3xl border border-line bg-panel/90 p-6 shadow-2xl shadow-black/[0.06] backdrop-blur sm:p-7">
          <div className="text-xs font-medium uppercase tracking-wide text-accent-ink">{company?.name ? company.name : 'Отклик на роль'}</div>
          <h1 className="mt-1 text-2xl font-semibold leading-tight">{role || 'Роль'}</h1>

          {total === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Пока нет страниц. Добавь блоки в конструкторе слева.</p>
          ) : done ? (
            <CompletionView onRestart={() => setIdx(0)} />
          ) : (
            <div className="mt-5">
              <OnbProgress step={idx} total={total} />
              <div key={idx} className="anim-up space-y-4">
                {page.blocks.map((b) => (
                  <BlockView key={b.id} b={b} values={values} setVal={setVal} consents={consents} setConsents={setConsents} company={company} positions={positions} />
                ))}
              </div>
              <div className="mt-6 flex gap-2">
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
