'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminStats, AdminUser } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/ui/Stat';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';

// Админ-панель: все аккаунты + сводная аналитика. Гейт по роли (сервер отдаёт 403).
export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [denied, setDenied] = useState(false);

  function load() {
    api.get<AdminStats>('/api/admin/stats').then(setStats).catch(() => setDenied(true));
    api.get<AdminUser[]>('/api/admin/users').then(setUsers).catch(() => setDenied(true));
  }
  useEffect(() => {
    load();
  }, []);

  async function update(id: string, data: { plan?: string; role?: string; subStatus?: string }) {
    setUsers((prev) =>
      prev!.map((u) =>
        u.id === id
          ? ({
              ...u,
              ...(data.plan ? { plan: data.plan } : {}),
              ...(data.role ? { role: data.role } : {}),
              ...(data.subStatus ? { subscription: { status: data.subStatus, currentPeriodEnd: u.subscription?.currentPeriodEnd ?? null } } : {}),
            } as AdminUser)
          : u,
      ),
    );
    await api.patch(`/api/admin/users/${id}`, data);
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
      <PageHeader title="Админка" subtitle="Все аккаунты сервиса и сводная аналитика." />
      <div className="space-y-6 p-8">
        {/* KPI сервиса */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Аккаунтов" value={stats?.users ?? '—'} accent hint={stats ? `+${stats.new7} за 7 дней` : ''} />
          <Stat label="Поисков" value={stats?.searches ?? '—'} />
          <Stat label="Лидов всего" value={stats?.leads ?? '—'} />
          <Stat label="ИИ-генераций сегодня" value={stats?.aiToday ?? '—'} hint="по всему сервису" />
        </div>

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
                <th className="px-4 py-3 font-medium">Подписка</th>
                <th className="px-4 py-3 font-medium">Роль</th>
              </tr>
            </thead>
            <tbody>
              {users === null ? (
                <tr><td className="px-4 py-4 text-muted" colSpan={8}>Загрузка…</td></tr>
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
