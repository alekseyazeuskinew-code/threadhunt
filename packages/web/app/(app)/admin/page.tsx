'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminStats, AdminUser, AdminAnalytics, AdminGrowth, AdminCosts, WaitlistEntry } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/ui/Stat';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';

// Админ-панель: все аккаунты + сводная аналитика. Гейт по роли (сервер отдаёт 403).
export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [growth, setGrowth] = useState<AdminGrowth | null>(null);
  const [costs, setCosts] = useState<AdminCosts | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[] | null>(null);
  const [denied, setDenied] = useState(false);

  function load() {
    api.get<AdminStats>('/api/admin/stats').then(setStats).catch(() => setDenied(true));
    api.get<AdminAnalytics>('/api/admin/analytics').then(setAnalytics).catch(() => {});
    api.get<AdminGrowth>('/api/admin/growth').then(setGrowth).catch(() => {});
    api.get<AdminCosts>('/api/admin/costs').then(setCosts).catch(() => {});
    api.get<AdminUser[]>('/api/admin/users').then(setUsers).catch(() => setDenied(true));
    api.get<WaitlistEntry[]>('/api/admin/waitlist').then(setWaitlist).catch(() => {});
  }
  useEffect(() => {
    load();
  }, []);

  async function update(id: string, data: { plan?: string; role?: string; subStatus?: string; extraSeats?: number }) {
    setUsers((prev) =>
      prev!.map((u) =>
        u.id === id
          ? ({
              ...u,
              ...(data.plan ? { plan: data.plan } : {}),
              ...(data.role ? { role: data.role } : {}),
              ...(data.extraSeats !== undefined ? { extraSeats: data.extraSeats } : {}),
              ...(data.subStatus ? { subscription: { status: data.subStatus, currentPeriodEnd: u.subscription?.currentPeriodEnd ?? null } } : {}),
            } as AdminUser)
          : u,
      ),
    );
    await api.patch(`/api/admin/users/${id}`, data);
  }

  async function setWaitStatus(id: string, status: string) {
    setWaitlist((prev) => prev!.map((w) => (w.id === id ? { ...w, status: status as WaitlistEntry['status'] } : w)));
    await api.patch(`/api/admin/waitlist/${id}`, { status });
  }
  async function removeWait(id: string) {
    setWaitlist((prev) => prev!.filter((w) => w.id !== id));
    await api.del(`/api/admin/waitlist/${id}`);
  }

  if (denied) {
    return (
      <>
        <PageHeader title="Админка" />
        <div className="p-8 text-muted">Доступ только для администраторов.</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Админка"
        subtitle="Все аккаунты сервиса и сводная аналитика."
        action={
          <a href="/admin/emails" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm hover:bg-panel-2">
            ✉️ Email-цепочки
          </a>
        }
      />
      <div className="space-y-6 p-8">
        {/* KPI сервиса */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Аккаунтов" value={stats?.users ?? '—'} accent hint={stats ? `+${stats.new7} за 7 дней` : ''} />
          <Stat label="Поисков" value={stats?.searches ?? '—'} />
          <Stat label="Лидов всего" value={stats?.leads ?? '—'} />
          <Stat label="ИИ-генераций сегодня" value={stats?.aiToday ?? '—'} hint="по всему сервису" />
        </div>

        {/* Лист ожидания (заявки с лендинга) */}
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Лист ожидания</div>
              <div className="text-xs text-muted">Заявки с лендинга на ранний доступ.{waitlist ? ` Всего: ${waitlist.length}` : ''}</div>
            </div>
            <a href="/api/admin/waitlist.csv" className="shrink-0 rounded-full border border-line px-3 py-1.5 text-sm text-text hover:bg-panel-2">Экспорт CSV</a>
          </div>
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-panel text-left text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Имя</th>
                  <th className="px-3 py-2 font-medium">Источник</th>
                  <th className="px-3 py-2 font-medium">Дата</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {waitlist === null ? (
                  <tr><td className="px-3 py-3 text-muted" colSpan={6}>Загрузка…</td></tr>
                ) : waitlist.length === 0 ? (
                  <tr><td className="px-3 py-3 text-muted" colSpan={6}>Пока никто не записался.</td></tr>
                ) : (
                  waitlist.map((w) => (
                    <tr key={w.id} className="border-t border-line">
                      <td className="px-3 py-2">{w.email}</td>
                      <td className="px-3 py-2 text-muted">{w.name || '—'}</td>
                      <td className="px-3 py-2 text-muted">{w.source || '—'}</td>
                      <td className="px-3 py-2 text-muted">{new Date(w.createdAt).toLocaleDateString('ru-RU')}</td>
                      <td className="px-3 py-2">
                        <Select
                          size="sm"
                          value={w.status}
                          onChange={(v) => setWaitStatus(w.id, v)}
                          options={[
                            { value: 'new', label: 'новый' },
                            { value: 'invited', label: 'приглашён' },
                            { value: 'converted', label: 'оплатил' },
                          ]}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => removeWait(w.id)} className="text-muted hover:text-danger" title="Удалить">✕</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {stats && (
          <Card>
            <div className="text-sm text-muted">Распределение по тарифам</div>
            <div className="mt-2 flex gap-6 text-sm">
              <span>Free: <b>{stats.byPlan.FREE}</b></span>
              <span className="text-accent-ink">Pro: <b>{stats.byPlan.PRO}</b></span>
              <span className="text-accent-ink">VIP: <b>{stats.byPlan.VIP}</b></span>
              <span className="text-muted">Постов опубликовано: <b>{stats.posts}</b></span>
            </div>
          </Card>
        )}

        {/* Оплаты и подписки */}
        {stats && (
          <Card>
            <div className="mb-3 text-base font-semibold">Оплаты и подписки</div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="MRR (оценка)" value={`${stats.mrr.toLocaleString('ru-RU')} ₽`} accent hint="по активным тарифам" />
              <Stat label="Платящих" value={stats.payingUsers} hint="Pro + VIP" />
              <Stat label="Активных подписок" value={stats.subs.active ?? 0} />
              <Stat label="Отменены / пауза" value={(stats.subs.canceled ?? 0) + (stats.subs.paused ?? 0)} />
            </div>
            <p className="mt-3 text-xs text-muted">
              Суммы — оценка по назначенным тарифам. Точные платежи, продления и отмены подтянутся после подключения Stripe
              (вебхуки обновят статусы автоматически).
            </p>
          </Card>
        )}

        {/* Рост и здоровье SaaS */}
        {growth && (
          <Card>
            <div className="mb-1 text-base font-semibold">Рост и здоровье продукта</div>
            <p className="mb-3 text-xs text-muted">Актуальный SaaS-набор: воронка активации (ведущий индикатор удержания), рост, активные, выручка, adoption.</p>

            {/* Выручка / ключевые KPI */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="MRR (оценка)" value={`${growth.revenue.mrr.toLocaleString('ru-RU')} ₽`} accent />
              <Stat label="ARR (оценка)" value={`${growth.revenue.arr.toLocaleString('ru-RU')} ₽`} />
              <Stat label="ARPU" value={`${growth.revenue.arpu.toLocaleString('ru-RU')} ₽`} hint="на платящего" />
              <Stat label="Активных за 7д (WAU)" value={growth.engagement.wau} />
            </div>

            {/* Воронка активации (PLG) */}
            <div className="mt-5 text-sm font-medium">Воронка активации</div>
            <div className="mt-2 space-y-1.5">
              {[
                { label: 'Зарегистрировались', v: growth.activation.total },
                { label: 'Подключили аккаунт', v: growth.activation.connected },
                { label: 'Создали поиск', v: growth.activation.withSearch },
                { label: 'Получили лид (aha)', v: growth.activation.withLead },
                { label: 'Платят', v: growth.activation.paying },
              ].map((row, i) => {
                const pct = growth.activation.total ? Math.round((row.v / growth.activation.total) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-44 shrink-0 text-muted">{row.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right tabular-nums">{row.v} · {pct}%</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-muted">
              Конверсия в оплату: <b>{growth.revenue.payingPct}%</b> · отток (отменены/просрочка): <b>{growth.revenue.churnedSubs}</b>
            </div>

            {/* Регистрации по неделям */}
            <div className="mt-5 text-sm font-medium">Регистрации по неделям</div>
            <div className="mt-2 flex items-end gap-1.5" style={{ height: 64 }}>
              {(() => {
                const max = Math.max(1, ...growth.signupsByWeek.map((w) => w.count));
                return growth.signupsByWeek.map((w, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <div className="w-full rounded-t bg-accent" style={{ height: `${(w.count / max) * 48}px` }} title={`${w.count}`} />
                    <span className="text-[10px] text-muted">{w.count}</span>
                  </div>
                ));
              })()}
            </div>

            {/* Adoption фич */}
            <div className="mt-5 flex flex-wrap gap-4 text-sm">
              <span className="text-muted">Используют:</span>
              <span>отбивку: <b>{growth.adoption.otbivka}</b></span>
              <span>автопостинг: <b>{growth.adoption.autopost}</b></span>
              <span>онбординг: <b>{growth.adoption.onboarding}</b></span>
              <span>кампании: <b>{growth.adoption.campaigns}</b></span>
            </div>

            {/* Power users */}
            {growth.powerUsers.length > 0 && (
              <div className="mt-5">
                <div className="text-sm font-medium">Power users (по лидам)</div>
                <div className="mt-2 space-y-1 text-sm">
                  {growth.powerUsers.map((p, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-bg px-3 py-1.5">
                      <span className="truncate">{p.email}</span>
                      <span className="shrink-0 text-muted tabular-nums">{p.leads} лидов · {p.hired} найм.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Расходники и баланс */}
        {costs && (
          <Card>
            <div className="mb-1 text-base font-semibold">Расходники и баланс</div>
            <p className="mb-3 text-xs text-muted">Расход ИИ и сервисы, которые надо держать пополненными. Балансы провайдеров проверяй по ссылкам — авто-чтение добавим позже.</p>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="ИИ-генераций сегодня" value={costs.ai.today} />
              <Stat label="ИИ за 30 дней" value={costs.ai.month} />
              <Stat label="Оценка $ / 30 дней" value={`$${costs.ai.estMonthUsd}`} accent hint={`~$${costs.ai.costPerGenUsd}/ген`} />
              <Stat label="ИИ всего" value={costs.ai.all} />
            </div>

            {/* расход ИИ за 14 дней */}
            <div className="mt-4 text-sm font-medium">ИИ-генерации за 14 дней</div>
            <div className="mt-2 flex items-end gap-1.5" style={{ height: 56 }}>
              {(() => {
                const max = Math.max(1, ...costs.series.map((d) => d.count));
                return costs.series.map((d, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center justify-end" title={`${d.day}: ${d.count}`}>
                    <div className="w-full rounded-t bg-accent" style={{ height: `${(d.count / max) * 44}px` }} />
                  </div>
                ));
              })()}
            </div>

            {/* чек-лист сервисов с биллингом */}
            <div className="mt-5 text-sm font-medium">Держать пополненным</div>
            <div className="mt-2 space-y-2">
              {[
                { name: 'Anthropic (ИИ-ключ)', what: 'ИИ-генерация постов и ответов', url: 'https://console.anthropic.com/settings/billing' },
                { name: 'Railway (сервер + Postgres)', what: 'API, планировщик, база', url: 'https://railway.app/' },
                { name: 'Netlify (фронт)', what: 'дашборд и лендинг', url: 'https://app.netlify.com/' },
                { name: 'Stripe (оплаты)', what: 'приём подписок (после подключения)', url: 'https://dashboard.stripe.com/' },
              ].map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5 text-sm">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted">{s.what}</div>
                  </div>
                  <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs hover:bg-panel-2">
                    Открыть биллинг →
                  </a>
                </div>
              ))}
            </div>
            {costs.ai.month > 1000 && (
              <p className="mt-3 rounded-lg bg-warning/5 px-3 py-2 text-xs text-warning">
                ⚠️ Высокий расход ИИ за месяц ({costs.ai.month} генераций) — проверь баланс Anthropic.
              </p>
            )}
          </Card>
        )}

        {/* Аналитика найма (обезличенные агрегаты) */}
        {analytics && (
          <Card>
            <div className="mb-1 text-base font-semibold">Аналитика найма</div>
            <p className="mb-3 text-xs text-muted">Обезличенные агрегаты по всем поискам — для внутреннего анализа эффективности.</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Лидов всего" value={analytics.totalLeads} />
              <Stat label="Нанято" value={analytics.totalHired} accent />
              <Stat label="Конверсия лид→наём" value={`${analytics.convToHire}%`} accent />
              <Stat label="Лидов на пост" value={analytics.leadsPerPost} hint={`постов: ${analytics.totalPosts}`} />
            </div>

            {/* Воронка стадий */}
            <div className="mt-5 text-sm font-medium">Воронка по стадиям</div>
            <div className="mt-2 space-y-1.5">
              {(['NEW', 'CONTACTED', 'SCREENING', 'HIRED', 'BENCH', 'REJECTED'] as const).map((st) => {
                const labels: Record<string, string> = { NEW: 'Новые', CONTACTED: 'Контакт', SCREENING: 'Скрининг', HIRED: 'Наняты', BENCH: 'Резерв', REJECTED: 'Отказ' };
                const v = analytics.funnel[st] || 0;
                const pct = analytics.totalLeads ? Math.round((v / analytics.totalLeads) * 100) : 0;
                return (
                  <div key={st} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 text-muted">{labels[st]}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right tabular-nums">{v} · {pct}%</span>
                  </div>
                );
              })}
            </div>

            {/* По разделам директа */}
            <div className="mt-5 flex flex-wrap gap-4 text-sm">
              <span className="text-muted">Откуда лиды:</span>
              <span>Запросы: <b>{analytics.bySection.requests || 0}</b></span>
              <span>Скрытые: <b>{analytics.bySection.hidden || 0}</b></span>
              <span>Основной: <b>{analytics.bySection.main || 0}</b></span>
            </div>

            {/* По профессиям (название поиска) */}
            {analytics.byProfession.length > 0 && (
              <div className="mt-5">
                <div className="text-sm font-medium">По профессиям (название поиска)</div>
                <div className="mt-2 overflow-hidden rounded-xl border border-line">
                  <table className="w-full text-sm">
                    <thead className="bg-panel text-left text-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Профессия</th>
                        <th className="px-3 py-2 font-medium tabular-nums">Лиды</th>
                        <th className="px-3 py-2 font-medium tabular-nums">Наняты</th>
                        <th className="px-3 py-2 font-medium tabular-nums">Конверсия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.byProfession.map((p, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="px-3 py-2">{p.title}</td>
                          <td className="px-3 py-2 tabular-nums">{p.leads}</td>
                          <td className="px-3 py-2 tabular-nums">{p.hired}</td>
                          <td className="px-3 py-2 tabular-nums">{p.conv}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-muted">«Профессия» ≈ название поиска. Связь «какой пост привёл лида» — на уровне поиска (постов↔лидов); точная атрибуция по конкретному посту появится позже.</p>
              </div>
            )}
          </Card>
        )}

        {/* Таблица аккаунтов */}
        <div className="overflow-hidden rounded-2xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Аккаунт</th>
                <th className="px-4 py-3 font-medium">Поиски</th>
                <th className="px-4 py-3 font-medium">Лиды</th>
                <th className="px-4 py-3 font-medium">Подкл.</th>
                <th className="px-4 py-3 font-medium">Регистрация</th>
                <th className="px-4 py-3 font-medium">Тариф</th>
                <th className="px-4 py-3 font-medium">Доп-места</th>
                <th className="px-4 py-3 font-medium">Подписка</th>
                <th className="px-4 py-3 font-medium">Роль</th>
              </tr>
            </thead>
            <tbody>
              {users === null ? (
                <tr><td className="px-4 py-4 text-muted" colSpan={9}>Загрузка…</td></tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.email}</div>
                      {u.name && <div className="text-xs text-muted">{u.name}</div>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{u._count.searches}</td>
                    <td className="px-4 py-3 tabular-nums">{u._count.leads}</td>
                    <td className="px-4 py-3 tabular-nums">{u._count.connections + u._count.devices}</td>
                    <td className="px-4 py-3 text-muted">{new Date(u.createdAt).toLocaleDateString('ru-RU')}</td>
                    <td className="px-4 py-3">
                      <Select
                        size="sm"
                        value={u.plan}
                        onChange={(v) => update(u.id, { plan: v })}
                        options={[
                          { value: 'FREE', label: 'FREE' },
                          { value: 'PRO', label: 'PRO' },
                          { value: 'VIP', label: 'VIP' },
                        ]}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        value={u.extraSeats ?? 0}
                        onChange={(e) => update(u.id, { extraSeats: Math.max(0, +e.target.value) })}
                        className="w-16 rounded-lg border border-line bg-bg px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        size="sm"
                        value={u.subscription?.status || 'inactive'}
                        onChange={(v) => update(u.id, { subStatus: v })}
                        options={[
                          { value: 'active', label: 'активна' },
                          { value: 'past_due', label: 'просрочка' },
                          { value: 'paused', label: 'пауза' },
                          { value: 'canceled', label: 'отменена' },
                          { value: 'inactive', label: 'нет' },
                        ]}
                      />
                      {u.subscription?.currentPeriodEnd && (
                        <div className="mt-1 text-xs text-muted">до {new Date(u.subscription.currentPeriodEnd).toLocaleDateString('ru-RU')}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        size="sm"
                        value={u.role}
                        onChange={(v) => update(u.id, { role: v })}
                        options={[
                          { value: 'USER', label: 'USER' },
                          { value: 'ADMIN', label: 'ADMIN' },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
