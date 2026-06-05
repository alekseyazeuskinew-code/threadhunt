'use client';
import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { AD_BUNDLES, type AdBundle } from '@/lib/bundles';
import type { AdCampaign, SearchSummary } from '@/lib/types';

export interface CampaignDraft {
  searchId: string;
  name: string;
  bundleKey: string;
  dailyBudget: number;
  currency: string;
  geo: string;
  ageMin: number;
  ageMax: number;
  interests: string;
  creativeHeadline: string;
  creativeText: string;
  mediaUrl: string;
  mediaType: string;
  codeWord: string;
  ctaLabel: string;
}

const empty = (searchId: string): CampaignDraft => ({
  searchId,
  name: '',
  bundleKey: '',
  dailyBudget: 500,
  currency: 'RUB',
  geo: '',
  ageMin: 18,
  ageMax: 45,
  interests: '',
  creativeHeadline: '',
  creativeText: '',
  mediaUrl: '',
  mediaType: '',
  codeWord: '',
  ctaLabel: 'Написать в директ',
});

export function fromCampaign(c: AdCampaign): CampaignDraft {
  return {
    searchId: c.searchId,
    name: c.name,
    bundleKey: c.bundleKey,
    dailyBudget: c.dailyBudget,
    currency: c.currency,
    geo: c.geo,
    ageMin: c.ageMin,
    ageMax: c.ageMax,
    interests: c.interests,
    creativeHeadline: c.creativeHeadline,
    creativeText: c.creativeText,
    mediaUrl: c.mediaUrl || '',
    mediaType: c.mediaType || '',
    codeWord: c.codeWord,
    ctaLabel: c.ctaLabel,
  };
}

// Конфигуратор кампании: выбор связки-пресета → правка креатива/аудитории/бюджета.
export function CampaignForm({
  searches,
  fixedSearchId,
  initial,
  onCancel,
  onSubmit,
  submitting,
}: {
  searches: SearchSummary[];
  fixedSearchId?: string;
  initial?: CampaignDraft;
  onCancel: () => void;
  onSubmit: (d: CampaignDraft) => void;
  submitting?: boolean;
}) {
  const [d, setD] = useState<CampaignDraft>(initial ?? empty(fixedSearchId ?? searches[0]?.id ?? ''));
  const set = (patch: Partial<CampaignDraft>) => setD((s) => ({ ...s, ...patch }));

  function applyBundle(b: AdBundle) {
    set({
      bundleKey: b.key,
      name: d.name || `${b.role}`,
      creativeHeadline: b.headline,
      creativeText: b.text,
      codeWord: b.codeWord,
      ctaLabel: b.cta,
      dailyBudget: b.dailyBudget,
      ageMin: b.ageMin,
      ageMax: b.ageMax,
      geo: b.geo,
      interests: b.interests,
    });
  }

  const valid = d.searchId && d.name.trim() && d.creativeText.trim() && d.codeWord.trim();
  const selBundle = AD_BUNDLES.find((b) => b.key === d.bundleKey);

  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <div className="grid gap-x-7 gap-y-5 lg:grid-cols-[1fr_17rem]">
        {/* ── Левая колонка: компактная форма ── */}
        <div className="space-y-4">
          {/* Связка — чипсами */}
          <div>
            <SLabel>Связка</SLabel>
            <div className="flex flex-wrap gap-1.5">
              {AD_BUNDLES.map((b) => (
                <button
                  key={b.key}
                  onClick={() => applyBundle(b)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${d.bundleKey === b.key ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:border-accent/40'}`}
                >
                  {b.emoji} {b.role}
                </button>
              ))}
            </div>
            {selBundle && <p className="mt-2 text-xs text-muted">{selBundle.why}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Монтажёры — июнь" />
            </Field>
            <Field label="Роль (поиск)">
              {fixedSearchId ? (
                <Input value={searches.find((s) => s.id === fixedSearchId)?.title || 'текущий поиск'} disabled />
              ) : (
                <Select value={d.searchId} onChange={(v) => set({ searchId: v })} options={searches.map((s) => ({ value: s.id, label: s.title }))} />
              )}
            </Field>
          </div>

          <hr className="border-line" />
          <SLabel>Объявление</SLabel>
          <Field label="Заголовок">
            <Input value={d.creativeHeadline} onChange={(e) => set({ creativeHeadline: e.target.value })} placeholder="Монтируешь Reels? Берём в команду" />
          </Field>
          <Field label="Текст">
            <Textarea value={d.creativeText} onChange={(e) => set({ creativeText: e.target.value })} placeholder="Призыв написать кодовое слово в директ…" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Кодовое слово">
              <Input value={d.codeWord} onChange={(e) => set({ codeWord: e.target.value })} placeholder="монтаж" />
            </Field>
            <Field label="Кнопка">
              <Input value={d.ctaLabel} onChange={(e) => set({ ctaLabel: e.target.value })} placeholder="Написать в директ" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <Field label="Медиа (URL, необязательно)">
              <Input value={d.mediaUrl} onChange={(e) => set({ mediaUrl: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label="Тип">
              <Select value={d.mediaType} onChange={(v) => set({ mediaType: v })} options={[{ value: '', label: 'нет' }, { value: 'image', label: 'фото' }, { value: 'video', label: 'видео' }]} />
            </Field>
          </div>

          <hr className="border-line" />
          <SLabel>Аудитория и бюджет</SLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Гео">
              <Input value={d.geo} onChange={(e) => set({ geo: e.target.value })} placeholder="Россия, СНГ" />
            </Field>
            <Field label="Бюджет в день">
              <div className="flex items-center gap-2">
                <Input type="number" value={d.dailyBudget} onChange={(e) => set({ dailyBudget: +e.target.value })} className="w-24" />
                <Select value={d.currency} onChange={(v) => set({ currency: v })} className="w-20" options={[{ value: 'RUB', label: '₽' }, { value: 'USD', label: '$' }, { value: 'EUR', label: '€' }]} />
              </div>
            </Field>
            <Field label="Возраст">
              <div className="flex items-center gap-2">
                <Input type="number" value={d.ageMin} onChange={(e) => set({ ageMin: +e.target.value })} className="w-20" />
                <span className="text-muted">—</span>
                <Input type="number" value={d.ageMax} onChange={(e) => set({ ageMax: +e.target.value })} className="w-20" />
              </div>
            </Field>
            <Field label="Интересы">
              <Input value={d.interests} onChange={(e) => set({ interests: e.target.value })} placeholder="Видеомонтаж, CapCut" />
            </Field>
          </div>
        </div>

        {/* ── Правая колонка: живое превью ── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <SLabel>Превью объявления</SLabel>
          <AdPreview d={d} />
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
            <MessageCircle size={13} className="mt-0.5 shrink-0" />
            Кодовое слово «{d.codeWord || '…'}» добавится в ключевые слова поиска — отбивка ответит и поведёт на онбординг.
          </p>
        </div>
      </div>

      <div className="mt-5 flex gap-2 border-t border-line pt-4">
        <Button onClick={() => onSubmit(d)} disabled={!valid || submitting}>
          {submitting ? 'Сохраняю…' : 'Сохранить кампанию'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  );
}

// Живое превью объявления в стиле ленты — чтобы видеть, что собираешь.
function AdPreview({ d }: { d: CampaignDraft }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg">
      <div className="flex items-center gap-2 p-3">
        <div className="h-8 w-8 rounded-full bg-accent-soft" />
        <div className="text-xs leading-tight">
          <div className="font-medium">ваш аккаунт</div>
          <div className="text-muted">Спонсировано</div>
        </div>
      </div>
      {d.mediaUrl && d.mediaType === 'image' ? (
        <img src={d.mediaUrl} alt="" className="aspect-square w-full object-cover" />
      ) : d.mediaUrl && d.mediaType === 'video' ? (
        <div className="flex aspect-square w-full items-center justify-center bg-panel-2 text-2xl">🎬</div>
      ) : (
        <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-panel-2 text-3xl">📣</div>
      )}
      <div className="space-y-2 p-3">
        {d.creativeHeadline && <div className="text-sm font-semibold leading-snug">{d.creativeHeadline}</div>}
        {d.creativeText && <p className="whitespace-pre-wrap text-xs text-muted">{d.creativeText}</p>}
        <div className="rounded-lg bg-accent px-3 py-2 text-center text-sm font-medium text-on-accent">{d.ctaLabel || 'Написать в директ'}</div>
      </div>
    </div>
  );
}

function SLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
