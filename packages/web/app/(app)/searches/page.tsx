'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search as SearchIcon, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { SearchSummary } from '@/lib/types';
import { SearchDetailPanel } from '@/components/search/SearchDetailPanel';
import { CreateSearchForm } from '@/components/search/CreateSearchForm';
import { Select } from '@/components/ui/Select';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/cn';

// Рабочий стол поисков (split-view): слева список вакансий, справа — деталь
// выбранной. Переключение между вакансиями в один клик, без перезагрузок и
// проваливаний. Выбор синхронится в URL (?id=) для deep-link, но без навигации.
export default function SearchesWorkspace() {
  const router = useRouter();
  const [list, setList] = useState<SearchSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<'recent' | 'leads' | 'title' | 'active'>('recent');

  const sorted = (list || []).slice().sort((a, b) => {
    if (sort === 'leads') return b._count.leads - a._count.leads;
    if (sort === 'title') return a.title.localeCompare(b.title, 'ru');
    if (sort === 'active') return (a.status === 'ACTIVE' ? 0 : 1) - (b.status === 'ACTIVE' ? 0 : 1);
    return 0; // recent — порядок с сервера (createdAt desc)
  });

  async function load(selectId?: string) {
    let data: SearchSummary[];
    try {
      data = await api.get<SearchSummary[]>('/api/searches');
    } catch {
      router.push('/login');
      return;
    }
    setList(data);
    setSelected((cur) => {
      const next = selectId ?? cur ?? data[0]?.id ?? null;
      return data.some((s) => s.id === next) ? next : data[0]?.id ?? null;
    });
  }
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('id') || undefined;
    load(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(id: string) {
    setCreating(false);
    setSelected(id);
    window.history.replaceState(null, '', `/searches?id=${id}`); // без перезагрузки
  }

  async function remove(id: string, title: string) {
    const ok = await confirmDialog({
      title: 'Удалить поиск?',
      message: `«${title}» и все его данные (кодовые слова, ответы, посты, лиды, анкеты) будут удалены безвозвратно.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/searches/${id}`).catch(() => {});
    if (selected === id) setSelected(null);
    await load();
  }

  return (
    <div className="flex h-screen">
      {/* Левый список вакансий */}
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-line">
        <div className="flex items-center justify-between border-b border-line px-4 py-4">
          <h1 className="text-lg font-semibold">Поиски</h1>
          <button
            onClick={() => {
              setCreating(true);
              setSelected(null);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-press"
            title="Новый поиск"
          >
            <Plus size={17} />
          </button>
        </div>

        {list && list.length > 0 && (
          <div className="border-b border-line px-3 py-2">
            <Select
              size="sm"
              value={sort}
              onChange={(v) => setSort(v as any)}
              options={[
                { value: 'recent', label: 'Сначала новые' },
                { value: 'active', label: 'Сначала активные' },
                { value: 'leads', label: 'Больше лидов' },
                { value: 'title', label: 'По алфавиту' },
              ]}
            />
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-2">
          {list === null ? (
            <div className="p-3 text-sm text-muted">Загрузка…</div>
          ) : list.length === 0 ? (
            <div className="p-3 text-sm text-muted">Поисков нет. Нажми + чтобы создать.</div>
          ) : (
            <div className="space-y-1">
              {sorted.map((s, i) => (
                <div
                  key={s.id}
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                  className={cn(
                    'anim-up group relative rounded-xl transition-colors',
                    selected === s.id && !creating ? 'bg-accent-soft' : 'hover:bg-panel-2',
                  )}
                >
                  <button onClick={() => select(s.id)} className="w-full px-3 py-2.5 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('truncate text-sm font-medium', selected === s.id && !creating && 'text-accent-ink')}>
                        {s.title}
                      </span>
                      {/* точка-статус прячется при наведении, уступая место кнопке удаления */}
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full transition-opacity group-hover:opacity-0',
                          s.status === 'ACTIVE' ? 'bg-accent' : 'bg-line',
                        )}
                      />
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {s._count.leads} лидов · {s._count.publishedPosts} постов
                    </div>
                  </button>
                  <button
                    onClick={() => remove(s.id, s.title)}
                    className="absolute right-2 top-2 rounded-md p-1 text-muted opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                    title="Удалить поиск"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Правая область: создание / деталь / пусто */}
      <section className="flex-1 overflow-y-auto">
        {creating ? (
          <CreateSearchForm onCreated={(id) => load(id).then(() => setCreating(false))} onCancel={() => setCreating(false)} />
        ) : selected ? (
          <SearchDetailPanel id={selected} onChanged={() => load()} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted">
            <SearchIcon size={32} className="mb-3 opacity-40" />
            <div>Выбери поиск слева или создай новый.</div>
          </div>
        )}
      </section>
    </div>
  );
}
