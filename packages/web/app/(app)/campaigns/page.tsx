'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { SearchSummary } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { CampaignsManager } from '@/components/campaigns/CampaignsManager';

// Рекламные кампании Meta: предсобранные связки лидгена на директ под роли.
export default function CampaignsPage() {
  const router = useRouter();
  const [searches, setSearches] = useState<SearchSummary[] | null>(null);

  useEffect(() => {
    api.get<SearchSummary[]>('/api/searches').then(setSearches).catch(() => router.push('/login'));
  }, []);

  return (
    <>
      <PageHeader title="Кампании" subtitle="Готовые рекламные связки лидгена на директ — клик в объявлении ведёт в переписку, а дальше работает автоответ и онбординг." />
      <div className="p-8">
        {!searches ? <div className="text-muted">Загрузка…</div> : <CampaignsManager searches={searches} />}
      </div>
    </>
  );
}
