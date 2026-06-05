'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Megaphone, Trash2, Pencil, Rocket, Info, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import type { AdCampaign, SearchSummary, MetaConnection, CampaignStatus } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CampaignForm, fromCampaign, type CampaignDraft } from './CampaignForm';

const STATUS: Record<CampaignStatus, { label: string; cls: string }> = {
  draft: { label: 'черновик', cls: 'bg-panel-2 text-muted' },
  pending_review: { label: 'на модерации', cls: 'bg-warning/10 text-warning' },
  active: { label: 'активна', cls: 'bg-success/10 text-success' },
  paused: { label: 'на паузе', cls: 'bg-panel-2 text-muted' },
};

// Управление рекламными кампаниями. Используется и на странице /campaigns (все),
// и во вкладке «Реклама» поиска (scope = fixedSearchId).
export function CampaignsManager({ fixedSearchId, searches }: { fixedSearchId?: string; searches: SearchSummary[] }) {
  const [list, setList] = useState<AdCampaign[] | null>(null);
  const [meta, setMeta] = useState<MetaConnection | null>(null);
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function load() {
    const q = fixedSearchId ? `?searchId=${fixedSearchId}` : '';
    setList(await api.get<AdCampaign[]>(`/api/campaigns${q}`));
  }
  useEffect(() => {
    load();
    api.get<MetaConnection>('/api/meta/connection').then(setMeta).catch(() => {});
  }, [fixedSearchId]);

  async function create(d: CampaignDraft) {
    setBusy(true);
    try {
      await api.post('/api/campaigns', { ...d, mediaUrl: d.mediaUrl || undefined, mediaType: d.mediaType || undefined });
      setCreating(false);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function saveEdit(id: string, d: CampaignDraft) {
    setBusy(true);
    try {
      const { searchId, ...rest } = d;
      await api.patch(`/api/campaigns/${id}`, { ...rest, mediaUrl: d.mediaUrl || undefined, mediaType: d.mediaType || undefined });
      setEditId(null);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function submit(id: string) {
    const r = await api.post<{ note: string }>(`/api/campaigns/${id}/submit`, {});
    setNote(r.note);
    await load();
  }
  async function setStatus(id: string, status: CampaignStatus) {
    await api.patch(`/api/campaigns/${id}`, { status } as any);
    await load();
  }
  async function remove(id: string) {
    await api.del(`/api/campaigns/${id}`);
    await load();
  }

  if (!list) return <div className="text-muted">Загрузка…</div>;

  return (
    <div className="space-y-4">
      {/* Подключение Меты / модерация */}
      <div className="flex items-start gap-2 rounded-xl border border-line bg-panel-2/40 px-3 py-2.5 text-sm">
        <Info size={15} className="mt-0.5 shrink-0 text-muted" />
        <div>
          {meta?.connected ? (
            <>Рекламный кабинет Meta подключён{meta.adAccountId ? ` (${meta.adAccountId})` : ''}. Запуск в Ads Manager включится после одобрения приложения — мы <b>на модерации Meta</b>. Связки можно собирать уже сейчас, кодовые слова работают.</>
          ) : (
            <>Прямой запуск рекламы появится после одобрения приложения в Meta (на модерации). Подключить кабинет можно на <Link href="/connections" className="text-accent-ink hover:underline">странице подключений</Link>. Связки и автоответ в директе работают уже сейчас.</>
          )}
        </div>
      </div>

      {note && (
        <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2.5 text-sm text-success">{note}</div>
      )}

      {/* Создание */}
      {creating ? (
        <CampaignForm searches={searches} fixedSearchId={fixedSearchId} onCancel={() => setCreating(false)} onSubmit={create} submitting={busy} />
      ) : (
        <Button onClick={() => setCreating(true)} disabled={!searches.length}>
          <Plus size={16} /> Новая кампания
        </Button>
      )}
      {!searches.length && !creating && <p className="text-sm text-muted">Сначала создайте поиск (роль) — кампания привязывается к нему.</p>}

      {/* Список */}
      {list.length === 0 && !creating ? (
        <Card className="text-sm text-muted">Кампаний пока нет. Соберите первую связку под роль.</Card>
      ) : (
        list.map((c) =>
          editId === c.id ? (
            <CampaignForm key={c.id} searches={searches} fixedSearchId={fixedSearchId} initial={fromCampaign(c)} onCancel={() => setEditId(null)} onSubmit={(d) => saveEdit(c.id, d)} submitting={busy} />
          ) : (
            <CampaignCard key={c.id} c={c} onEdit={() => setEditId(c.id)} onSubmit={() => submit(c.id)} onStatus={(s) => setStatus(c.id, s)} onRemove={() => remove(c.id)} />
          ),
        )
      )}
    </div>
  );
}

function CampaignCard({
  c,
  onEdit,
  onSubmit,
  onStatus,
  onRemove,
}: {
  c: AdCampaign;
  onEdit: () => void;
  onSubmit: () => void;
  onStatus: (s: CampaignStatus) => void;
  onRemove: () => void;
}) {
  const st = STATUS[c.status];
  const cur = c.currency === 'RUB' ? '₽' : c.currency === 'USD' ? '$' : '€';
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Megaphone size={15} className="shrink-0 text-muted" />
            <span className="truncate font-medium">{c.name}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
          </div>
          {c.search?.title && <div className="mt-0.5 text-xs text-muted">роль: {c.search.title}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onEdit} className="rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-text" title="Редактировать"><Pencil size={15} /></button>
          <button onClick={onRemove} className="rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-danger" title="Удалить"><Trash2 size={15} /></button>
        </div>
      </div>

      {c.creativeText && <p className="mt-2 whitespace-pre-wrap text-sm">{c.creativeText}</p>}

      {/* Результат связки — лиды и найм по её кодовому слову */}
      <div className="mt-3 flex items-center gap-4 rounded-xl bg-bg px-3 py-2">
        <span className="text-sm"><b className="text-accent-ink tabular-nums">{c.leads ?? 0}</b> <span className="text-muted">лидов</span></span>
        <span className="text-sm"><b className="text-accent-ink tabular-nums">{c.hires ?? 0}</b> <span className="text-muted">найм</span></span>
        <span className="ml-auto text-xs text-muted">по слову «{c.codeWord}»</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <span>💬 «{c.codeWord}» → автоответ</span>
        <span>💵 {c.dailyBudget} {cur}/день</span>
        <span>🎯 {c.geo || '—'} · {c.ageMin}–{c.ageMax}</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {c.status === 'draft' && (
          <Button size="sm" onClick={onSubmit}>
            <Rocket size={14} /> Отправить на запуск
          </Button>
        )}
        {c.status === 'pending_review' && (
          <>
            <span className="inline-flex items-center gap-1 text-xs text-warning"><Clock size={13} /> ждёт одобрения Meta</span>
            <Button size="sm" variant="ghost" onClick={() => onStatus('draft')}>Вернуть в черновик</Button>
          </>
        )}
      </div>
    </Card>
  );
}
