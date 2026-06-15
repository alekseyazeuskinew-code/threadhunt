'use client';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { ROLE_TEMPLATES } from '@/lib/roleTemplates';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { MicButton, appendDictation } from '@/components/ui/Dictation';

// Форма создания поиска — встроена в рабочую область (не попап).
// onCreated получает id нового поиска, чтобы сразу его выбрать.
export function CreateSearchForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [loading, setLoading] = useState(false);

  async function create() {
    setLoading(true);
    try {
      const s = await api.post<{ id: string }>('/api/searches', {
        title,
        description,
        keywords: keywords.split(',').map((t) => t.trim()).filter(Boolean).map((text) => ({ text, mode: 'root' })),
      });
      onCreated(s.id);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Новый поиск</h1>
      <p className="mt-1 text-sm text-muted">Выбери роль из библиотеки или заполни вручную.</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {ROLE_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTitle(t.title);
              setKeywords(t.keywords.join(', '));
              setDescription(t.description);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm transition-colors hover:border-accent/50 hover:bg-panel-2"
          >
            <span>{t.emoji}</span> {t.title}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        <div>
          <label className="mb-1.5 block text-sm text-muted">Кого ищем</label>
          <Input placeholder="Видеомонтажёр" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-muted">Кодовые слова (через запятую)</label>
          <Input placeholder="монтаж, монтажёр" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-sm text-muted">Описание — добавь свои детали (условия, тон, фишки): по ним ИИ соберёт уникальные тексты</label>
            <MicButton onText={(t) => setDescription((v) => appendDictation(v, t))} />
          </div>
          <Textarea placeholder="Удалёнка, монтаж Reels/Shorts, опыт от года, оплата сдельно… (или наговори голосом 🎤)" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button onClick={create} disabled={!title || loading}>
          <Sparkles size={15} /> {loading ? 'Создаю…' : 'Создать поиск'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
