'use client';
import { useEffect, useState } from 'react';
import { ShieldAlert, Clock, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import type { Limits } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { useAutosave, AutosaveBadge } from '@/components/ui/Autosave';

// Лимиты авто-отбивки (защита Threads-аккаунта). Используется в Настройках.
export function LimitsSettings() {
  const [l, setL] = useState<Limits | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .get<Limits>('/api/limits')
      .then(setL)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const autosave = useAutosave(
    l,
    async (v) => {
      if (!v) return;
      const { caps, ...payload } = v;
      await api.put<Limits>('/api/limits', payload);
    },
    { enabled: ready }
  );

  if (!l) return <Card><div className="text-muted">Загрузка…</div></Card>;
  const set = (patch: Partial<Limits>) => setL({ ...l, ...patch });

  const risky = l.replyDelaySec < 5 || l.maxRepliesPerDay > 60 || l.maxDialogsPerSweep > 60;

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2 text-base font-semibold">
        <SlidersHorizontal size={18} className="text-accent-ink" /> Лимиты авто-отбивки
      </div>
      <p className="mb-4 text-sm text-muted">Насколько активно расширение работает в директе. Бережёт аккаунт от ограничений Threads.</p>

      {/* Рабочие часы */}
      <div className="rounded-xl border border-line bg-bg p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Clock size={15} className="text-muted" /> Только в рабочие часы
          </div>
          <Toggle checked={l.workingHoursEnabled} onChange={(v) => set({ workingHoursEnabled: v })} />
        </div>
        {l.workingHoursEnabled && (
          <div className="mt-3 flex items-center gap-3 text-sm text-muted">
            с
            <Input type="time" className="w-32" value={l.activeFrom} onChange={(e) => set({ activeFrom: e.target.value })} />
            до
            <Input type="time" className="w-32" value={l.activeTo} onChange={(e) => set({ activeTo: e.target.value })} />
          </div>
        )}
      </div>

      <div className="mt-4 space-y-4">
        <Row label="Пауза между ответами" hint={`секунд (минимум ${l.caps?.replyDelayMin ?? 3})`}>
          <Input type="number" className="w-24" value={l.replyDelaySec} onChange={(e) => set({ replyDelaySec: +e.target.value })} />
        </Row>
        <Row label="Максимум сообщений в день" hint={`до ${l.caps?.repliesMax ?? 100}`}>
          <Input type="number" className="w-24" value={l.maxRepliesPerDay} onChange={(e) => set({ maxRepliesPerDay: +e.target.value })} />
        </Row>
        <Row label="Максимум диалогов за проход" hint={`до ${l.caps?.dialogsMax ?? 100}`}>
          <Input type="number" className="w-24" value={l.maxDialogsPerSweep} onChange={(e) => set({ maxDialogsPerSweep: +e.target.value })} />
        </Row>
      </div>

      {risky && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-warning">
          <ShieldAlert size={13} /> Агрессивные настройки повышают риск ограничений. Безопасно: пауза 6–15 c, до 40–60 сообщений в день.
        </p>
      )}

      <div className="mt-5">
        <AutosaveBadge status={autosave} />
      </div>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
