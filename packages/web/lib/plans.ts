// Тарифы, валюты и бонусы. Годовая оплата = 2 месяца бесплатно (~17% выгоды) + бонусы.
// Цены заданы явно по каждой валюте (не конвертация флоатом) — реальную оплату подключит Stripe.

export type Currency = 'RUB' | 'USD' | 'EUR';

export const CURRENCIES: { code: Currency; symbol: string; label: string }[] = [
  { code: 'RUB', symbol: '₽', label: '₽ RUB' },
  { code: 'USD', symbol: '$', label: '$ USD' },
  { code: 'EUR', symbol: '€', label: '€ EUR' },
];

export interface Plan {
  key: 'FREE' | 'PRO' | 'VIP';
  name: string;
  tagline: string;
  features: string[];
  annualBonuses: string[]; // что доп. даём при оплате на год
  highlight?: boolean;
  prices: Record<Currency, { monthly: number; annual: number }>;
}

export const PLANS: Plan[] = [
  {
    key: 'FREE',
    name: 'Free',
    tagline: 'Попробовать',
    features: ['1 поиск', 'Отбивка вручную', 'Без ИИ-генерации', '1 Threads-аккаунт'],
    annualBonuses: [],
    prices: { RUB: { monthly: 0, annual: 0 }, USD: { monthly: 0, annual: 0 }, EUR: { monthly: 0, annual: 0 } },
  },
  {
    key: 'PRO',
    name: 'Pro',
    tagline: 'Для соло и небольших команд',
    features: ['10 поисков', 'Автопостинг по расписанию', 'ИИ-генерация постов и отбивки', 'Отбивка в директе', 'до 5 постов/день'],
    annualBonuses: ['🎁 2 месяца бесплатно', '+50 ИИ-генераций в месяц', 'Доп. Threads-аккаунт', 'Ранний доступ к новым фичам'],
    prices: { RUB: { monthly: 1490, annual: 14900 }, USD: { monthly: 19, annual: 190 }, EUR: { monthly: 18, annual: 180 } },
  },
  {
    key: 'VIP',
    name: 'VIP',
    tagline: 'Для агентств и активного найма',
    features: [
      'Безлимит поисков',
      'Несколько Threads-аккаунтов',
      'Приоритетная отбивка',
      'Отбивка в комментариях',
      'до 15 постов/день',
      'Поддержка 24/7',
    ],
    annualBonuses: ['🎁 2 месяца бесплатно', 'Безлимит ИИ-генераций', 'Персональный онбординг (concierge)', 'Личный менеджер', 'Приоритет в очереди отбивки'],
    highlight: true,
    prices: { RUB: { monthly: 4900, annual: 49000 }, USD: { monthly: 59, annual: 590 }, EUR: { monthly: 55, annual: 550 } },
  },
];

export const CUR_SYMBOL: Record<Currency, string> = { RUB: '₽', USD: '$', EUR: '€' };

// Форматирование суммы с символом валюты (₽ — после, $/€ — перед).
export function formatPrice(amount: number, c: Currency): string {
  if (c === 'RUB') return `${amount.toLocaleString('ru-RU')} ₽`;
  return `${CUR_SYMBOL[c]}${amount.toLocaleString('en-US')}`;
}

export const monthlyOf = (p: Plan, c: Currency, annual: boolean) => (annual ? Math.round(p.prices[c].annual / 12) : p.prices[c].monthly);
export const annualOf = (p: Plan, c: Currency) => p.prices[c].annual;
export const savingsOf = (p: Plan, c: Currency) => p.prices[c].monthly * 12 - p.prices[c].annual;
export const savingsPctOf = (p: Plan, c: Currency) =>
  p.prices[c].monthly ? Math.round((savingsOf(p, c) / (p.prices[c].monthly * 12)) * 100) : 0;
