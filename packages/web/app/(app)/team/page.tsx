'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserPlus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { TeamInfo } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

const ROLE_OPTS = [
  { value: 'MANAGER', label: 'Менеджер' },
  { value: 'VIEWER', label: 'Наблюдатель' },
];

// Команда: владелец приглашает участников с ограниченными правами. Места — по тарифу.
export default function TeamPage() {
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [denied, setDenied] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'MANAGER' | 'VIEWER'>('MANAGER');
  const [error, setError] = useState('');

  const load = () => api.get<TeamInfo>('/api/team').then(setInfo).catch(() => setDenied(true));
  useEffect(() => {
    load();
  }, []);

  async function invite() {
    setError('');
    try {
      await api.post('/api/team/invite', { email: email.trim(), role });
      setEmail('');
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (denied) {
    return (
      <>
        <PageHeader title="Команда" />
        <div className="p-8 text-muted">Управление командой доступно только владельцу пространства.</div>
      </>
    );
  }

  const full = info ? info.used >= info.seats : false;

  return (
    <>
      <PageHeader title="Команда" subtitle="Пригласи HR или партнёра с ограниченным доступом — только то, что нужно." />
      <div className="max-w-2xl space-y-5 p-8">
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <div className="text-base font-semibold">Пригласить участника</div>
            {info && (
              <span className="text-xs text-muted">
                мест занято {info.used}/{info.seats}
              </span>
            )}
          </div>
          <p className="mb-4 text-sm text-muted">
            <b>Менеджер (HR)</b> — ведёт входящих кандидатов (стадии, заметки, ссылки). <b>Наблюдатель</b> — только
            смотрит.
          </p>
          {full ? (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
              Мест больше нет на текущем тарифе.{' '}
              <Link href="/billing" className="underline">
                Расширить команду
              </Link>{' '}
              на Pro/VIP.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input className="flex-1" type="email" placeholder="email@команды.рф" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Select className="w-40" value={role} onChange={(v) => setRole(v as any)} options={ROLE_OPTS} />
              <Button onClick={invite} disabled={!email}>
                <UserPlus size={16} /> Пригласить
              </Button>
            </div>
          )}
          {error && <div className="mt-2 text-sm text-danger">{error}</div>}
        </Card>

        <Card>
          <div className="mb-3 text-base font-semibold">Участники</div>
          {!info ? (
            <div className="text-sm text-muted">Загрузка…</div>
          ) : info.members.length === 0 ? (
            <div className="text-sm text-muted">Пока только ты. Пригласи команду выше.</div>
          ) : (
            <div className="space-y-2">
              {info.members.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5 text-sm">
                  <div>
                    <div className="font-medium">{m.email}</div>
                    <div className="text-xs text-muted">{m.linked ? 'активен' : 'приглашён — ждёт входа'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select size="sm" value={m.role} onChange={(v) => api.patch(`/api/team/${m.id}`, { role: v }).then(load)} options={ROLE_OPTS} />
                    <button onClick={() => api.del(`/api/team/${m.id}`).then(load)} className="text-muted hover:text-danger">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
