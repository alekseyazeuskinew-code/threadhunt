'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/auth/forgot', { email });
      setSent(true);
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
          {sent ? (
            <div className="text-center">
              <div className="text-xl font-semibold">Проверь почту 📬</div>
              <p className="mt-2 text-sm text-muted">
                Если аккаунт с таким email есть, мы отправили ссылку для сброса пароля. Она действует 1 час.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold">Сброс пароля</h1>
              <p className="mt-1 text-sm text-muted">Укажи email — пришлём ссылку для нового пароля.</p>
              <form onSubmit={submit} className="mt-6 space-y-3">
                <Input type="email" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                {error && <div className="text-sm text-danger">{error}</div>}
                <Button type="submit" className="w-full" disabled={loading || !email}>
                  {loading ? '...' : 'Прислать ссылку'}
                </Button>
              </form>
            </>
          )}
        </div>
        <div className="mt-4 text-center text-sm text-muted">
          <Link href="/login" className="text-accent-ink hover:underline">
            ← Вернуться ко входу
          </Link>
        </div>
      </div>
    </div>
  );
}
