'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowRight, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import type { Flow } from '@/lib/flow';
import { fmtInTz } from '@/lib/timezones';
import { Button } from '@/components/ui/Button';
import { BlockView, OnbProgress, CompletionView, PoweredBy } from '@/components/onboarding/FlowRenderer';

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
    <div className="th-aurora relative min-h-screen overflow-hidden">
      <div className="th-grid pointer-events-none fixed inset-0 opacity-[0.3]" />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="mb-6 flex justify-center text-lg">
          <span className="font-display font-semibold tracking-tight">
            <span aria-hidden className="text-accent-ink">⟋⟋</span> <span className="text-text">threadhunt</span>
          </span>
        </div>

        <div className="th-rise rounded-3xl border border-line bg-panel/90 p-6 shadow-2xl shadow-black/[0.08] backdrop-blur sm:p-7">
          <div className="text-xs font-medium uppercase tracking-wide text-accent-ink">{data.company ? data.company : 'Отклик на роль'}</div>
          <h1 className="mt-1 text-2xl font-semibold leading-tight">{data.role}</h1>

          {done ? (
            <CompletionView />
          ) : (
            <div className="mt-5">
              {data.deadline && <DeadlineBanner deadline={data.deadline} tz={data.timezone} now={now} />}
              <OnbProgress step={idx} total={total} />
              <div key={idx} className="anim-up space-y-4">
                {page.blocks.map((b) => (
                  <BlockView key={b.id} b={b} values={values} setVal={setVal} consents={consents} setConsents={setConsents} />
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

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-6 text-center text-muted">{children}</div>;
}
