'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Search, KanbanSquare, Plug, CreditCard, Users2, LogOut, Settings, Shield, Send, Megaphone, type LucideIcon } from 'lucide-react';
import { Wordmark } from './Wordmark';
import { ThemeToggle } from './ThemeToggle';
import { api } from '@/lib/api';
import type { Me, Workspace } from '@/lib/types';
import { cn } from '@/lib/cn';

type NavItem = { href: string; label: string; icon: LucideIcon };

// Навигация владельца и приглашённого участника (ограниченный доступ).
const OWNER_NAV: NavItem[] = [
  { href: '/', label: 'Обзор', icon: LayoutDashboard },
  { href: '/searches', label: 'Поиски', icon: Search },
  { href: '/posts', label: 'Публикации', icon: Send },
  { href: '/campaigns', label: 'Кампании', icon: Megaphone },
  { href: '/leads', label: 'Кандидаты', icon: KanbanSquare },
  { href: '/connections', label: 'Подключения', icon: Plug },
  { href: '/team', label: 'Команда', icon: Users2 },
  { href: '/billing', label: 'Тариф', icon: CreditCard },
];
const MEMBER_NAV: NavItem[] = [{ href: '/leads', label: 'Кандидаты', icon: KanbanSquare }];

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ws, setWs] = useState<Workspace | null>(null);
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  useEffect(() => {
    api.get<Me>('/api/auth/me').then(setMe).catch(() => {});
    api.get<Workspace>('/api/workspace').then(setWs).catch(() => {});
  }, []);

  async function logout() {
    await api.post('/api/auth/logout');
    router.push('/login');
  }

  const nav = ws?.isMember ? MEMBER_NAV : OWNER_NAV;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel/40 p-4">
      <Link href={ws?.isMember ? '/leads' : '/'} className="px-2 py-2 text-lg">
        <Wordmark />
      </Link>
      {ws?.company && (
        <div className="mx-2 mt-1 rounded-lg bg-panel-2 px-2.5 py-1.5 text-xs">
          <div className="truncate text-text">{ws.company}</div>
          {ws.isMember && <div className="text-accent-ink">{ws.role === 'MANAGER' ? 'менеджер' : 'наблюдатель'} · чужое пространство</div>}
        </div>
      )}

      <nav className="mt-6 flex flex-col gap-1">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
              isActive(href) ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-panel-2 hover:text-text',
            )}
          >
            <Icon size={18} strokeWidth={2} />
            {label}
          </Link>
        ))}
        {!ws?.isMember && me?.role === 'ADMIN' && (
          <Link
            href="/admin"
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
              isActive('/admin') ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-panel-2 hover:text-text',
            )}
          >
            <Shield size={18} strokeWidth={2} /> Админка
          </Link>
        )}
      </nav>

      <div className="mt-auto">
        <div className="flex items-center justify-between rounded-xl border border-line bg-panel p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{me?.email || '—'}</div>
            <div className="text-xs text-accent-ink">{me ? `тариф ${me.plan}` : ''}</div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/settings" title="Настройки" className="text-muted hover:text-text">
              <Settings size={17} />
            </Link>
            <button onClick={logout} title="Выйти" className="text-muted hover:text-danger">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
