'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// Прямая ссылка на поиск открывает его в рабочем столе (split-view), без отдельного экрана.
export default function SearchDeepLink() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/searches?id=${id}`);
  }, [id, router]);
  return <div className="p-8 text-muted">Открываю…</div>;
}
