'use client';
import { useEffect, useState } from 'react';
import { Check, Gift, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { PLANS, CURRENCIES, formatPrice, monthlyOf, annualOf, savingsOf, savingsPctOf, type Plan, type Currency } from '@/lib/plans';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export default function BillingPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [period, setPeriod] = useState<'monthly' | 'annual'>('annual');
  const [currency, setCurrency] = useState<Currency>('RUB');

  useEffect(() => {
    api.get<Me>('/api/auth/me').then(setMe).catch(() => {});
    const saved = localStorage.getItem('th_currency') as Currency | null;
    if (saved && CURRENCIES.some((c) => c.code === saved)) setCurrency(saved);
  }, []);
  function pickCurrency(c: Currency) {
    setCurrency(c);
    localStorage.setItem('th_currency', c);
  }

  return (
    <>
      <PageHeader
        title="Тариф"
        subtitle="Оплата на год — два месяца бесплатно и бонусы. Найм выгоднее держать на постоянке."
        action={
          <div className="flex items-center gap-2">
            {/* переключатель валют */}
            <div className="flex rounded-full border border-line p-0.5">
              {CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  onClick={() => pickCurrency(c.code)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-sm transition-colors',
                    currency === c.code ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-text',
                  )}
                >
                  {c.symbol}
                </button>
              ))}
            </div>
            {/* период */}
            <div className="flex rounded-full border border-line p-0.5">
              <PeriodBtn active={period === 'monthly'} onClick={() => setPeriod('monthly')} label="Помесячно" />
              <PeriodBtn active={period === 'annual'} onClick={() => setPeriod('annual')} label="На год · −17%" />
            </div>
          </div>
        }
      />

      <div className="grid gap-4 p-8 md:grid-cols-3">
        {PLANS.map((p) => (
          <PlanCard key={p.key} plan={p} period={period} currency={currency} current={me?.plan === p.key} />
        ))}
      </div>

      <p className="px-8 pb-8 text-sm text-muted">
        Оплата через Stripe появится здесь. Годовой тариф можно поставить на паузу — данные, лиды и резерв сохранятся.
      </p>
    </>
  );
}

function PlanCard({ plan, period, currency, current }: { plan: Plan; period: 'monthly' | 'annual'; currency: Currency; current: boolean }) {
  const annual = period === 'annual';
  const free = plan.prices[currency].monthly === 0;
  const price = free ? formatPrice(0, currency) : formatPrice(monthlyOf(plan, currency, annual), currency);

  return (
    <div className={cn('flex flex-col rounded-2xl border bg-panel p-6', plan.highlight ? 'border-accent' : 'border-line')}>
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">{plan.name}</div>
        {current && <span className="text-xs text-accent-ink">текущий</span>}
      </div>
      <div className="mt-0.5 text-sm text-muted">{plan.tagline}</div>

      <div className="mt-4 flex items-end gap-1.5">
        <span className="font-display text-3xl font-semibold tabular-nums">{price}</span>
        {!free && <span className="pb-1 text-sm text-muted">/ мес</span>}
      </div>
      {annual && !free ? (
        <div className="mt-1 text-xs text-muted">
          {formatPrice(annualOf(plan, currency), currency)} в год · экономия {formatPrice(savingsOf(plan, currency), currency)} ({savingsPctOf(plan, currency)}%)
        </div>
      ) : (
        <div className="mt-1 text-xs text-muted">&nbsp;</div>
      )}

      <ul className="mt-5 space-y-2 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-muted">
            <Check size={15} className="shrink-0 text-accent-ink" /> {f}
          </li>
        ))}
      </ul>

      {annual && plan.annualBonuses.length > 0 && (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-accent-ink">
            <Gift size={13} /> Бонусы за год
          </div>
          <ul className="space-y-1.5 text-sm">
            {plan.annualBonuses.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <Sparkles size={13} className="mt-0.5 shrink-0 text-accent-ink" /> {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button className="mt-6 w-full" variant={plan.highlight ? 'primary' : 'ghost'} disabled={current}>
        {current ? 'Активен' : free ? 'Остаться на Free' : annual ? 'Оформить на год' : 'Оформить'}
      </Button>
    </div>
  );
}

function PeriodBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn('rounded-full px-3.5 py-1.5 text-sm transition-colors', active ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-text')}
    >
      {label}
    </button>
  );
}
