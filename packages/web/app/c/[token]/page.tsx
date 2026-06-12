'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { ArrowRight, Clock, CalendarPlus } from 'lucide-react';
import { api } from '@/lib/api';
import type { Flow } from '@/lib/flow';
import type { CompanyProfile } from '@/lib/types';
import { fmtInTz } from '@/lib/timezones';
import { Button } from '@/components/ui/Button';
import { BlockView, OnbProgress, CompletionView, PoweredBy } from '@/components/onboarding/FlowRenderer';

interface FlowResp {
  company: string;
  companyProfile?: CompanyProfile;
  positions?: string[];
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
  const [resumedAt, setResumedAt] = useState<number | null>(null); // с какого шага возобновили
  const LS = `th_onb_${token}`; // ключ локального сохранения прогресса

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api
      .get<FlowResp>(`/api/c/${token}`)
      .then((d) => {
        setData(d);
        // Источник правды по завершённым шагам — сервер. Поверх накладываем локально
        // сохранённый ввод (в т.ч. недозаполненную текущую страницу), чтобы НИЧЕГО
        // не потерялось, даже если кандидат закрыл вкладку посреди шага.
        let vals: Record<string, string> = d.progress.responses || {};
        let i = Math.min(d.progress.obStep, d.flow.pages.length);
        try {
          const raw = localStorage.getItem(LS);
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.values) vals = { ...vals, ...saved.values };
            if (typeof saved.idx === 'number') i = Math.min(Math.max(i, saved.idx), d.flow.pages.length);
          }
        } catch {}
        setValues(vals);
        setIdx(i);
        if (i > 0 && i < d.flow.pages.length) setResumedAt(i);
      })
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Мгновенно сохраняем прогресс (ввод + текущий шаг) локально — ничего не теряется.
  useEffect(() => {
    if (!data) return;
    const finished = idx >= data.flow.pages.length;
    try {
      if (finished) localStorage.removeItem(LS);
      else localStorage.setItem(LS, JSON.stringify({ values, idx }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, idx, data]);

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

  // Акцентный цвет страницы (из конструктора) — перекрашивает кнопки/прогресс/чипы.
  const ac = data.flow.accent;
  const accentStyle = ac
    ? ({ '--accent': ac, '--accent-press': ac, '--accent-ink': ac, '--accent-soft': hexToRgba(ac, 0.14), '--on-accent': '#ffffff' } as CSSProperties)
    : undefined;

  return (
    <div className="th-aurora relative min-h-screen overflow-hidden" style={accentStyle}>
      <div className="th-grid pointer-events-none fixed inset-0 opacity-[0.3]" />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="th-rise rounded-3xl border border-line bg-panel/90 p-6 shadow-2xl shadow-black/[0.08] backdrop-blur sm:p-7">
          <div className="text-xs font-medium uppercase tracking-wide text-accent-ink">{data.company ? data.company : 'Отклик на роль'}</div>
          <h1 className="mt-1 text-2xl font-semibold leading-tight">{data.role}</h1>

          {done ? (
            <CompletionView />
          ) : (
            <div className="mt-5">
              {data.deadline && (
                <>
                  {/* Если на странице нет собственного блока-таймера — показываем баннер-дедлайн сверху. */}
                  {!page.blocks.some((b) => b.type === 'deadline') && <DeadlineBanner deadline={data.deadline} tz={data.timezone} now={now} />}
                  <CalendarLinks deadline={data.deadline} role={data.role} token={token} />
                </>
              )}
              {resumedAt != null && idx === resumedAt && (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft/50 px-3 py-2 text-sm text-accent-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Продолжаем с шага {idx + 1} — твои ответы сохранены.
                </div>
              )}
              <OnbProgress step={idx} total={total} />
              <div key={idx} className="anim-up space-y-4">
                {page.blocks.map((b) => (
                  <BlockView key={b.id} b={b} values={values} setVal={setVal} consents={consents} setConsents={setConsents} company={data.companyProfile} positions={data.positions} deadline={data.deadline} timezone={data.timezone} />
                ))}
              </div>
              {err && <div className="mt-3 text-sm text-danger">{err}</div>}
              <Button variant="accent" className="mt-6 w-full" disabled={busy} onClick={next}>
                {busy ? 'Сохраняю…' : idx === pages.length - 1 ? 'Завершить' : 'Далее'} <ArrowRight size={15} />
              </Button>
            </div>
          )}
          <PoweredBy />
        </div>
      </div>
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

// «Добавить в календарь» — поднимает доходимость до сдачи теста: дедлайн всегда
// под рукой. Google Calendar (по клику) + .ics для Apple/Outlook.
function CalendarLinks({ deadline, role, token }: { deadline: string; role: string; token: string }) {
  const start = new Date(deadline);
  const end = new Date(start.getTime() + 30 * 60_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const title = `Сдать тестовое: ${role}`;
  const link = typeof window !== 'undefined' ? `${window.location.origin}/c/${token}` : '';
  const details = `Дедлайн сдачи тестового задания.${link ? '\n' + link : ''}`;
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(details)}`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${title}`, `DESCRIPTION:${details.replace(/\n/g, '\\n')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const icsHref = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted">Не забыть:</span>
      <a href={gcal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 font-medium text-accent-ink transition-colors hover:bg-accent-soft">
        <CalendarPlus size={13} /> В Google Календарь
      </a>
      <a href={icsHref} download={`test-${role}.ics`} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-muted transition-colors hover:text-text">
        .ics (Apple/Outlook)
      </a>
    </div>
  );
}

function hexToRgba(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return `rgba(109,92,246,${a})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-6 text-center text-muted">{children}</div>;
}
