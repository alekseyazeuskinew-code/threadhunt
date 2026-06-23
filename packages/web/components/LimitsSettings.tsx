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
  const [showLegal, setShowLegal] = useState(false); // модал соглашения о рисках
  const [agree, setAgree] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const reload = () => api.get<Limits>('/api/limits').then(setL).catch(() => {});
  useEffect(() => {
    reload().finally(() => setReady(true));
  }, []);

  const autosave = useAutosave(
    l,
    async (v) => {
      if (!v) return;
      const { caps, safe, riskAcceptedAt, ...payload } = v;
      try {
        await api.put<Limits>('/api/limits', payload);
      } catch (e: any) {
        // Сервер требует принять соглашение о рисках (повышение лимитов за безопасный коридор).
        if (e?.message === 'RISK_NOT_ACCEPTED') setShowLegal(true);
        throw e;
      }
    },
    { enabled: ready }
  );

  // Принять соглашение → зафиксировать на сервере → повторить сохранение лимитов.
  async function acceptRisk() {
    if (!agree || !l) return;
    setAccepting(true);
    try {
      await api.post('/api/account/accept-risk');
      const { caps, safe, riskAcceptedAt, ...payload } = l;
      await api.put<Limits>('/api/limits', payload);
      setL({ ...l, riskAcceptedAt: new Date().toISOString() });
      setShowLegal(false);
      setAgree(false);
    } catch {
      /* оставляем модал открытым */
    } finally {
      setAccepting(false);
    }
  }
  // Отказ → откат лимитов к сохранённым серверным значениям.
  function declineRisk() {
    setShowLegal(false);
    setAgree(false);
    void reload();
  }

  if (!l) return <Card><div className="text-muted">Загрузка…</div></Card>;
  const set = (patch: Partial<Limits>) => setL({ ...l, ...patch });

  const safe = l.safe || { replyDelayMin: 6, repliesMax: 40, dialogsMax: 40, intervalMin: 60 };
  // «Рискованно» = выход за безопасный коридор (совпадает с серверным гейтом).
  const risky = l.replyDelaySec < safe.replyDelayMin || l.maxRepliesPerDay > safe.repliesMax || l.maxDialogsPerSweep > safe.dialogsMax;

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
          <ShieldAlert size={13} /> Повышенные лимиты за безопасным коридором. Требуют соглашения о рисках. Безопасно: пауза ≥ {safe.replyDelayMin} c, до {safe.repliesMax} сообщений в день, до {safe.dialogsMax} диалогов за проход.
        </p>
      )}
      {risky && l.riskAcceptedAt && (
        <p className="mt-1 text-xs text-muted">Соглашение о рисках принято {new Date(l.riskAcceptedAt).toLocaleDateString('ru-RU')}.</p>
      )}

      <div className="mt-5">
        <AutosaveBadge status={autosave} />
      </div>

      {showLegal && <RiskAgreementModal agree={agree} setAgree={setAgree} onAccept={acceptRisk} onDecline={declineRisk} busy={accepting} safe={safe} />}
    </Card>
  );
}

// Юридическое соглашение о рисках при повышении лимитов за безопасный коридор.
// ВНИМАНИЕ: это шаблон — для юридической силы в конкретной юрисдикции дайте проверить юристу.
function RiskAgreementModal({
  agree,
  setAgree,
  onAccept,
  onDecline,
  busy,
  safe,
}: {
  agree: boolean;
  setAgree: (v: boolean) => void;
  onAccept: () => void;
  onDecline: () => void;
  busy: boolean;
  safe: { replyDelayMin: number; repliesMax: number; dialogsMax: number; intervalMin: number };
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onDecline}>
      <div className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-panel p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2 text-lg font-semibold text-warning">
          <ShieldAlert size={20} /> Соглашение о рисках при повышенных лимитах
        </div>
        <div className="space-y-3 text-sm leading-relaxed text-text">
          <p>
            Вы изменяете лимиты авто-отбивки за пределы безопасного коридора (пауза ≥ {safe.replyDelayMin} c, до {safe.repliesMax} сообщений/день, до {safe.dialogsMax} диалогов за проход).
            Автоматизация действий выполняется в вашем браузере под вашей учётной записью и может нарушать правила Meta Platforms, Inc. (Threads/Instagram). Это
            способно привести к временному ограничению либо постоянной блокировке вашего аккаунта.
          </p>
          <p className="font-medium">Нажимая «Принимаю», вы подтверждаете, что:</p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>действуете осознанно, добровольно и на свой страх и риск;</li>
            <li>несёте полную и единоличную ответственность за любые последствия использования повышенных лимитов, включая ограничение, блокировку или потерю аккаунта и связанных данных;</li>
            <li>
              не имеете и не будете иметь к сервису ThreadHunt, его владельцам, разработчикам, операторам и аффилированным лицам никаких претензий, требований, исков
              или притязаний имущественного или неимущественного характера, связанных с блокировкой, ограничением, приостановкой аккаунта либо иным прямым или
              косвенным ущербом;
            </li>
            <li>сервис предоставляется «как есть» (as is), без каких-либо гарантий, и не несёт ответственности за упущенную выгоду, убытки и иной ущерб;</li>
            <li>в максимально допустимой применимым правом степени отказываетесь от любых претензий к сервису по указанным основаниям.</li>
          </ol>
          <p className="text-xs text-muted">Дата и факт принятия фиксируются в системе как подтверждение вашего согласия.</p>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>Я прочитал(а) и принимаю условия соглашения о рисках, претензий к сервису не имею.</span>
        </label>

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onDecline} className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-muted hover:text-text">
            Отмена
          </button>
          <button
            onClick={onAccept}
            disabled={!agree || busy}
            className="rounded-xl bg-warning px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Сохраняю…' : 'Принимаю и повышаю лимиты'}
          </button>
        </div>
      </div>
    </div>
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
