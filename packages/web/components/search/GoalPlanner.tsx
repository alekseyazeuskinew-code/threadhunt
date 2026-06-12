'use client';
import { useEffect, useState } from 'react';
import { Target, TrendingUp, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import type { GoalState } from '@/lib/types';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { useAutosave, AutosaveBadge } from '@/components/ui/Autosave';

// Автопланировщик: цель найма + конверсия → нужно лидов; прогресс + флаг застоя.
export function GoalPlanner({ searchId, onRewrite }: { searchId: string; onRewrite?: () => void }) {
  const [g, setG] = useState<GoalState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hires, setHires] = useState(3);
  const [conv, setConv] = useState(10);
  const [due, setDue] = useState('');
  const [ready, setReady] = useState(false);

  function apply(s: GoalState) {
    setG(s);
    setEnabled(s.config.goalEnabled);
    setHires(s.config.goalHires || 3);
    setConv(s.config.goalConversion || 10);
    setDue(s.config.goalDueAt ? s.config.goalDueAt.slice(0, 10) : '');
  }
  useEffect(() => {
    api
      .get<GoalState>(`/api/searches/${searchId}/goal`)
      .then(apply)
      .catch(() => {})
      .finally(() => setReady(true));
  }, [searchId]);

  // Автосохранение цели (с обновлением расчётных полей из ответа).
  const autosave = useAutosave(
    { enabled, hires, conv, due },
    async (v) => {
      const r = await api.put<GoalState>(`/api/searches/${searchId}/goal`, {
        goalEnabled: v.enabled,
        goalHires: v.hires,
        goalConversion: v.conv,
        goalDueAt: v.due ? new Date(v.due + 'T23:59:59').toISOString() : null,
      });
      setG(r); // только производные данные, чтобы не перебить ввод
    },
    { enabled: ready }
  );

  // живой расчёт нужного числа лидов (до сохранения)
  const requiredPreview = conv > 0 ? Math.ceil(hires / (conv / 100)) : 0;
  const leadPct = g && g.requiredLeads > 0 ? Math.min(100, Math.round((g.leads / g.requiredLeads) * 100)) : 0;
  const hirePct = hires > 0 && g ? Math.min(100, Math.round((g.hires / hires) * 100)) : 0;

  return (
    <div className="space-y-5">
      {/* Настройка цели */}
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-accent-ink" />
            <div>
              <div className="font-medium">Цель найма</div>
              <div className="text-sm text-muted">Посчитаем, сколько нужно лидов, и проследим за прогрессом.</div>
            </div>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>

        {enabled && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted">
              <label className="flex items-center gap-2">
                нанять
                <Input type="number" className="w-20" value={hires} onChange={(e) => setHires(+e.target.value)} />
                чел.
              </label>
              <label className="flex items-center gap-2">
                конверсия лид→найм
                <Input type="number" className="w-20" value={conv} onChange={(e) => setConv(+e.target.value)} />
                %
              </label>
              <label className="flex items-center gap-2">
                к дате
                <Input type="date" className="w-44" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
            </div>
            <div className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent-ink">
              Чтобы нанять <b>{hires}</b> при конверсии <b>{conv}%</b>, нужно собрать ≈ <b>{requiredPreview} лидов</b>.
            </div>
          </>
        )}

        <div className="mt-3">
          <AutosaveBadge status={autosave} />
        </div>
      </div>

      {/* Прогресс */}
      {g && enabled && g.config.goalEnabled && (
        <div className="space-y-4 rounded-2xl border border-line bg-panel p-4">
          {g.stale && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
              <div className="flex-1">
                <div className="font-medium text-warning">Лиды перестали приходить</div>
                <div className="mt-0.5 text-muted">
                  Новых откликов нет 3+ дня, а цель ещё не закрыта. Скорее всего, выгорели текстовки постов — обнови их или сгенерируй новые.
                </div>
                {onRewrite && (
                  <button onClick={onRewrite} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
                    <RefreshCw size={13} /> Переписать тексты постов
                  </button>
                )}
              </div>
            </div>
          )}

          <Bar label="Лиды" value={g.leads} target={g.requiredLeads} pct={leadPct} hint={`нужно ${g.requiredLeads}`} />
          <Bar label="Найм" value={g.hires} target={g.config.goalHires} pct={hirePct} hint={`цель ${g.config.goalHires}`} accent />

          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
            {g.daysLeft !== null && (
              <span className="text-muted">
                Осталось дней: <b className={g.daysLeft < 0 ? 'text-danger' : 'text-text'}>{g.daysLeft < 0 ? 'просрочено' : g.daysLeft}</b>
              </span>
            )}
            {g.onPace !== null && (
              <span className={`inline-flex items-center gap-1 ${g.onPace ? 'text-success' : 'text-warning'}`}>
                {g.onPace ? <Check size={14} /> : <TrendingUp size={14} />}
                {g.onPace ? 'в графике' : `отстаём от темпа${g.expectedLeads != null ? ` (нужно было ≈${g.expectedLeads} лидов)` : ''}`}
              </span>
            )}
            <span className="text-muted">Новых за 3 дня: <b className="text-text">{g.leadsLast3d}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ label, value, target, pct, hint, accent }: { label: string; value: number; target: number; pct: number; hint: string; accent?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">
          {value} / {target} <span className="text-xs">· {hint}</span>
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-panel-2">
        <div className={`h-full rounded-full ${accent ? 'bg-accent' : 'bg-accent/60'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
