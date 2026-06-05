'use client';
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') || '';
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/auth/reset', { token, newPassword: pw });
      setDone(true);
      setTimeout(() => router.push('/'), 1200);
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
          {!token ? (
            <p className="text-center text-sm text-muted">Ссылка неполная. Запроси сброс заново.</p>
          ) : done ? (
            <div className="text-center">
              <div className="text-xl font-semibold text-success">Пароль обновлён ✓</div>
              <p className="mt-2 text-sm text-muted">Входим в кабинет…</p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold">Новый пароль</h1>
              <p className="mt-1 text-sm text-muted">Придумай новый пароль (от 8 символов).</p>
              <form onSubmit={submit} className="mt-6 space-y-3">
                <Input type="password" placeholder="Новый пароль" value={pw} onChange={(e) => setPw(e.target.value)} required />
                {error && <div className="text-sm text-danger">{error}</div>}
                <Button type="submit" className="w-full" disabled={loading || pw.length < 8}>
                  {loading ? '...' : 'Сохранить пароль'}
                </Button>
              </form>
            </>
          )}
        </div>
        <div className="mt-4 text-center text-sm text-muted">
          <Link href="/login" className="text-accent-ink hover:underline">
            ← Ко входу
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted">Загрузка…</div>}>
      <ResetInner />
    </Suspense>
  );
}
