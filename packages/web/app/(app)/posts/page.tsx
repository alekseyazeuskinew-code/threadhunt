'use client';
import { useEffect, useState } from 'react';
import { ExternalLink, ImageIcon, Video, FileText, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { PublishedPostRow } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';

// История публикаций: что и когда вышло, со ссылкой на пост и превью медиа —
// чтобы видеть прошлые тексты и не повторяться.
export default function PostsPage() {
  const [posts, setPosts] = useState<PublishedPostRow[] | null>(null);

  useEffect(() => {
    api.get<PublishedPostRow[]>('/api/posts').then(setPosts).catch(() => setPosts([]));
  }, []);

  return (
    <>
      <PageHeader title="Публикации" subtitle="Хронология вышедших постов-приманок: тексты, медиа и ссылки на Threads." />
      <div className="space-y-3 p-8">
        {!posts ? (
          <div className="text-muted">Загрузка…</div>
        ) : posts.length === 0 ? (
          <Card className="text-sm text-muted">Постов пока не было. Включи автопостинг в поиске — и здесь появится история.</Card>
        ) : (
          posts.map((p) => <PostRow key={p.id} p={p} />)
        )}
      </div>
    </>
  );
}

function PostRow({ p }: { p: PublishedPostRow }) {
  return (
    <Card className={p.ok ? '' : 'border-danger/30'}>
      <div className="flex gap-4">
        <Thumb p={p} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted">
            <span className="truncate">{p.searchTitle}</span>
            <span>·</span>
            <span className="shrink-0">{new Date(p.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            {!p.ok && (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-danger">
                <AlertTriangle size={11} /> ошибка
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap break-words text-sm">{p.text}</p>
          {p.error && <p className="mt-1.5 text-xs text-danger">{p.error}</p>}
          {p.permalink && (
            <a
              href={p.permalink}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
            >
              Открыть пост <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function Thumb({ p }: { p: PublishedPostRow }) {
  const base = 'flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-bg text-muted';
  if (p.mediaType === 'image' && p.mediaUrl) return <img src={p.mediaUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-line object-cover" />;
  if (p.mediaType === 'video') return <div className={base}><Video size={20} /></div>;
  if (p.mediaType === 'image') return <div className={base}><ImageIcon size={20} /></div>;
  return <div className={base}><FileText size={20} /></div>;
}
