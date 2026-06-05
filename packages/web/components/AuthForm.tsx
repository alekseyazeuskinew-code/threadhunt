'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Wordmark } from './Wordmark';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isSignup = mode === 'signup';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isSignup && !accept) {
      setError('Нужно принять условия использования');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.post(isSignup ? '/api/auth/signup' : '/api/auth/login', { email, password, acceptTerms: accept });
      router.push(isSignup ? '/onboarding' : '/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center text-xl">
          <Wordmark />
        </div>
        <div className="rounded-2xl border border-line bg-panel p-6">
          <h1 className="text-xl font-semibold">{isSignup ? 'Создать аккаунт' : 'С возвращением'}</h1>
          <p className="mt-1 text-sm text-muted">
            {isSignup ? 'Запусти найм через Threads за пару минут.' : 'Войди в свой кабинет Threadhunt.'}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-3">
            <Input type="email" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input
              type="password"
              placeholder="Пароль (от 8 символов)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {isSignup && (
              <label className="flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={accept}
                  onChange={(e) => setAccept(e.target.checked)}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  Принимаю{' '}
                  <Link href="/terms" target="_blank" className="text-accent-ink hover:underline">
                    условия использования
                  </Link>{' '}
                  и{' '}
                  <Link href="/privacy" target="_blank" className="text-accent-ink hover:underline">
                    политику конфиденциальности
                  </Link>
                  , понимаю, что автоматизация Threads — на моей ответственности.
                </span>
              </label>
            )}
            {error && <div className="text-sm text-danger">{error}</div>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '...' : isSignup ? 'Зарегистрироваться' : 'Войти'}
            </Button>
          </form>
        </div>
        <div className="mt-4 text-center text-sm text-muted">
          {isSignup ? (
            <>
              Уже есть аккаунт?{' '}
              <Link href="/login" className="text-accent-ink hover:underline">
                Войти
              </Link>
            </>
          ) : (
            <>
              Нет аккаунта?{' '}
              <Link href="/signup" className="text-accent-ink hover:underline">
                Создать
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
