'use client';
import { useEffect, useState } from 'react';
import { Megaphone, Trash2 } from 'lucide-react';
import { confirmDialog } from '@/components/ui/confirm';
import { api } from '@/lib/api';
import type { Announcement } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

// Публикация объявлений основателя. Видны всем пользователям в колокольчике.
export function AnnouncementsAdmin() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<'info' | 'update' | 'important'>('update');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      setItems(await api.get<Announcement[]>('/api/admin/announcements'));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function publish() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      await api.post('/api/admin/announcements', { title: title.trim(), body: body.trim(), level });
      setTitle('');
      setBody('');
      setMsg('Опубликовано — увидят все пользователи в колокольчике.');
      load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!(await confirmDialog({ message: 'Удалить объявление?', confirmText: 'Удалить', danger: true }))) return;
    await api.del(`/api/admin/announcements/${id}`);
    load();
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 text-base font-semibold">
        <Megaphone size={18} className="text-accent-ink" /> Объявления пользователям
      </div>
      <p className="mb-3 text-xs text-muted">Новости, обновления и важные сообщения. Появятся у всех в колокольчике (сайдбар).</p>

      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок объявления" />
        <Select
          value={level}
          onChange={(v) => setLevel(v as any)}
          options={[
            { value: 'info', label: '📣 Новость' },
            { value: 'update', label: '✨ Обновление' },
            { value: 'important', label: '⚠️ Важное' },
          ]}
        />
      </div>
      <Textarea className="mt-3" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Текст: что нового, что изменилось, что важно знать…" />
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={publish} disabled={busy || !title.trim() || !body.trim()}>
          {busy ? 'Публикую…' : 'Опубликовать'}
        </Button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>

      {items.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          {items.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl bg-bg px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{a.title}</div>
                <div className="truncate text-xs text-muted">{a.body}</div>
                <div className="text-xs text-muted">{new Date(a.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <button onClick={() => remove(a.id)} className="shrink-0 text-muted hover:text-danger" title="Удалить">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
