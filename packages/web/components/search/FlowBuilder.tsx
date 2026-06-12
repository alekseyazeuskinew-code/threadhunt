'use client';
import { useRef, useState } from 'react';
import { Plus, Trash2, GripVertical, ChevronLeft, ChevronRight, Type, AlignLeft, TextCursorInput, CheckSquare, Upload, CircleDot, ListChecks, Gauge, X, Image, Video, FileText, HelpCircle, LifeBuoy, Sparkles, Building2, Briefcase } from 'lucide-react';
import type { Flow, Page, Block, BlockType } from '@/lib/flow';
import { newBlock, newPage, BLOCK_LABELS } from '@/lib/flow';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

const COMPANY_STYLE_OPTS = [
  { value: 'minimal', label: 'Минимал' },
  { value: 'gradient', label: 'Градиент' },
  { value: 'dark', label: 'Тёмный' },
  { value: 'bold', label: 'Яркий' },
];

// Поле картинки: загрузка файла + ручной URL + превью. Для логотипа/обложки.
function ImageField({ value, onChange, label }: { value?: string; onChange: (url: string) => void; label: string }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  async function up(f: File) {
    setBusy(true);
    try {
      const r = await api.upload(f);
      onChange(r.url);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  }
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{label}</div>
      <div className="flex items-center gap-2">
        {value && <img src={value} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover" />}
        <Input className="flex-1" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="URL картинки или загрузи →" />
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && up(e.target.files[0])} />
        <button onClick={() => ref.current?.click()} disabled={busy} className="shrink-0 rounded-lg border border-line px-2 py-2 text-muted hover:bg-panel-2" title="Загрузить">
          {busy ? '…' : <Upload size={14} />}
        </button>
        {value && (
          <button onClick={() => onChange('')} className="shrink-0 text-muted hover:text-danger" title="Убрать">
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

const PALETTE: { type: BlockType; icon: any }[] = [
  { type: 'company', icon: Building2 },
  { type: 'positions', icon: Briefcase },
  { type: 'heading', icon: Type },
  { type: 'text', icon: AlignLeft },
  { type: 'image', icon: Image },
  { type: 'video', icon: Video },
  { type: 'file', icon: FileText },
  { type: 'faq', icon: HelpCircle },
  { type: 'support', icon: LifeBuoy },
  { type: 'field', icon: TextCursorInput },
  { type: 'choice', icon: CircleDot },
  { type: 'multi', icon: ListChecks },
  { type: 'scale', icon: Gauge },
  { type: 'consent', icon: CheckSquare },
  { type: 'submit', icon: Upload },
];

// purpose-функция ИИ для текста блока (необязательная): улучшить/сгенерировать текст.
type AiText = (purpose: string, current: string) => Promise<string | null>;

// Кнопка точечной ИИ-помощи по тексту блока.
function AiBtn({ purpose, current, ai, onText }: { purpose: string; current: string; ai: AiText; onText: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      title="Сгенерировать/улучшить текст ИИ"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const t = await ai(purpose, current);
          if (t) onText(t);
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-accent/40 px-2 py-1.5 text-xs text-accent-ink transition-colors hover:bg-accent-soft disabled:opacity-50"
    >
      <Sparkles size={13} /> {busy ? '…' : 'ИИ'}
    </button>
  );
}

// Конструктор онбординга: страницы (вкладки) + блоки (drag-and-drop внутри страницы).
export function FlowBuilder({ value, onChange, ai }: { value: Flow; onChange: (f: Flow) => void; ai?: AiText }) {
  const [sel, setSel] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [pdrag, setPdrag] = useState<number | null>(null);
  const pages = value.pages;
  const page: Page | undefined = pages[Math.min(sel, pages.length - 1)];

  const update = (pages: Page[]) => onChange({ pages });
  const setPage = (p: Page) => update(pages.map((x, i) => (i === sel ? p : x)));

  function addPage() {
    update([...pages, newPage(`Страница ${pages.length + 1}`)]);
    setSel(pages.length);
  }
  function delPage(i: number) {
    if (pages.length <= 1) return;
    update(pages.filter((_, j) => j !== i));
    setSel(Math.max(0, i - 1));
  }
  function movePage(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    const arr = [...pages];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    update(arr);
    setSel(j);
  }

  function addBlock(type: BlockType) {
    if (!page) return;
    setPage({ ...page, blocks: [...page.blocks, newBlock(type)] });
  }
  function setBlock(idx: number, patch: Partial<Block>) {
    if (!page) return;
    setPage({ ...page, blocks: page.blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)) });
  }
  function delBlock(idx: number) {
    if (!page) return;
    setPage({ ...page, blocks: page.blocks.filter((_, i) => i !== idx) });
  }
  function dropBlock(to: number) {
    if (!page || drag === null || drag === to) return;
    const arr = [...page.blocks];
    const [m] = arr.splice(drag, 1);
    arr.splice(to, 0, m);
    setPage({ ...page, blocks: arr });
    setDrag(null);
  }
  function dropPage(to: number) {
    if (pdrag === null || pdrag === to) return;
    const arr = [...pages];
    const [m] = arr.splice(pdrag, 1);
    arr.splice(to, 0, m);
    update(arr);
    setSel(to);
    setPdrag(null);
  }

  return (
    <div className="rounded-2xl border border-line">
      {/* Вкладки страниц */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line p-2">
        {pages.map((p, i) => (
          <button
            key={p.id}
            draggable
            onDragStart={() => setPdrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dropPage(i)}
            onDragEnd={() => setPdrag(null)}
            onClick={() => setSel(i)}
            title="Перетащи, чтобы поменять порядок"
            className={cn('shrink-0 cursor-grab rounded-lg px-3 py-1.5 text-sm transition-colors active:cursor-grabbing', i === sel ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-panel-2')}
          >
            {i + 1}. {p.title || 'без названия'}
          </button>
        ))}
        <button onClick={addPage} className="shrink-0 rounded-lg px-2.5 py-1.5 text-muted hover:bg-panel-2" title="Добавить страницу">
          <Plus size={16} />
        </button>
      </div>

      {page && (
        <div className="p-4">
          {/* управление страницей */}
          <div className="mb-3 flex items-center gap-2">
            <Input value={page.title} onChange={(e) => setPage({ ...page, title: e.target.value })} placeholder="Название страницы" className="flex-1" />
            <button onClick={() => movePage(sel, -1)} disabled={sel === 0} className="rounded-lg border border-line p-2 text-muted hover:text-text disabled:opacity-40"><ChevronLeft size={15} /></button>
            <button onClick={() => movePage(sel, 1)} disabled={sel === pages.length - 1} className="rounded-lg border border-line p-2 text-muted hover:text-text disabled:opacity-40"><ChevronRight size={15} /></button>
            <button onClick={() => delPage(sel)} disabled={pages.length <= 1} className="rounded-lg border border-line p-2 text-muted hover:text-danger disabled:opacity-40"><Trash2 size={15} /></button>
          </div>

          {/* блоки страницы (drag-and-drop) */}
          <div className="space-y-2">
            {page.blocks.length === 0 && <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">Пусто — добавь блок ниже.</div>}
            {page.blocks.map((b, i) => (
              <div
                key={b.id}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropBlock(i)}
                className="flex gap-2 rounded-xl border border-line bg-panel p-3"
              >
                <div className="cursor-grab pt-2 text-muted" title="Перетащить"><GripVertical size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted">{BLOCK_LABELS[b.type]}</span>
                    <button onClick={() => delBlock(i)} className="text-muted hover:text-danger"><Trash2 size={14} /></button>
                  </div>
                  <BlockEditor block={b} onChange={(patch) => setBlock(i, patch)} ai={ai} />
                </div>
              </div>
            ))}
          </div>

          {/* палитра */}
          <div className="mt-3 flex flex-wrap gap-2">
            {PALETTE.map(({ type, icon: Icon }) => (
              <button key={type} onClick={() => addBlock(type)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent/50 hover:text-text">
                <Icon size={14} /> {BLOCK_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const INPUT_OPTS = [
  { value: 'text', label: 'короткий текст' },
  { value: 'textarea', label: 'длинный текст' },
  { value: 'email', label: 'email' },
  { value: 'url', label: 'ссылка' },
  { value: 'number', label: 'число' },
  { value: 'phone', label: 'телефон' },
];

function OptionsEditor({ block, onChange }: { block: Block; onChange: (p: Partial<Block>) => void }) {
  const opts = block.options || [];
  const set = (i: number, v: string) => onChange({ options: opts.map((o, j) => (j === i ? v : o)) });
  return (
    <div className="space-y-1.5">
      {opts.map((o, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input value={o} onChange={(e) => set(i, e.target.value)} placeholder={`Вариант ${i + 1}`} />
          <button onClick={() => onChange({ options: opts.filter((_, j) => j !== i) })} className="text-muted hover:text-danger">
            <X size={15} />
          </button>
        </div>
      ))}
      <button onClick={() => onChange({ options: [...opts, ''] })} className="inline-flex items-center gap-1 text-xs text-accent-ink hover:underline">
        <Plus size={13} /> вариант
      </button>
    </div>
  );
}

function BlockEditor({ block, onChange, ai }: { block: Block; onChange: (p: Partial<Block>) => void; ai?: AiText }) {
  if (block.type === 'company')
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-bg px-3 py-2 text-xs text-muted">
          По умолчанию подтянется из «Голоса бренда» (Настройки): название, ниша, о нас, плюсы, соцсети. Ниже можно переопределить и оформить.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={block.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Название (пусто = из бренда)" />
          <Select value={block.style || 'minimal'} onChange={(v) => onChange({ style: v })} options={COMPANY_STYLE_OPTS} />
        </div>
        <Textarea value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="О компании (пусто = из бренда)" />
        <ImageField label="Логотип" value={block.logo} onChange={(url) => onChange({ logo: url })} />
        <ImageField label="Фоновая обложка" value={block.cover} onChange={(url) => onChange({ cover: url })} />
      </div>
    );
  if (block.type === 'positions')
    return <div className="rounded-lg bg-bg px-3 py-2 text-xs text-muted">Покажет другие активные вакансии компании. Заполнять не нужно — обновляется само.</div>;
  if (block.type === 'heading')
    return (
      <div className="flex items-center gap-1.5">
        <Input className="flex-1" value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Текст заголовка" />
        {ai && <AiBtn purpose="короткий заголовок раздела онбординга" current={block.text || ''} ai={ai} onText={(t) => onChange({ text: t })} />}
      </div>
    );
  if (block.type === 'text')
    return (
      <div className="space-y-1.5">
        <Textarea value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Текст для кандидата (условия, тестовое задание, инструкции)" />
        {ai && (
          <div className="flex justify-end">
            <AiBtn purpose="абзац текста для кандидата (условия / тестовое задание / инструкция)" current={block.text || ''} ai={ai} onText={(t) => onChange({ text: t })} />
          </div>
        )}
      </div>
    );
  if (block.type === 'consent') return <Input value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Текст галочки (согласие/NDA)" />;
  if (block.type === 'submit') return <Input value={block.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Подпись поля сдачи" />;

  if (block.type === 'image') return <Input value={block.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="URL картинки (https://…)" />;
  if (block.type === 'video') return <Input value={block.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="Ссылка на видео (YouTube/Vimeo/MP4)" />;
  if (block.type === 'file')
    return (
      <div className="space-y-2">
        <Input value={block.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Подпись (напр. «Скачать тестовое»)" />
        <Input value={block.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="Ссылка на файл (Google Drive, PDF…)" />
      </div>
    );
  if (block.type === 'support')
    return (
      <div className="space-y-2">
        <Input value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Текст сноски (напр. «Не понятно? Напиши нам»)" />
        <div className="flex items-center gap-2">
          <Input value={block.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Кнопка" className="w-40" />
          <Input value={block.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="Telegram/ссылка/почта" />
        </div>
      </div>
    );
  if (block.type === 'faq') {
    const items = block.faq || [];
    const set = (i: number, patch: Partial<{ q: string; a: string }>) => onChange({ faq: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
    return (
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border border-line p-2">
            <div className="mb-1 flex items-center gap-1.5">
              <Input value={it.q} onChange={(e) => set(i, { q: e.target.value })} placeholder="Вопрос" />
              <button onClick={() => onChange({ faq: items.filter((_, j) => j !== i) })} className="text-muted hover:text-danger">
                <X size={15} />
              </button>
            </div>
            <Textarea value={it.a} onChange={(e) => set(i, { a: e.target.value })} placeholder="Ответ" />
          </div>
        ))}
        <button onClick={() => onChange({ faq: [...items, { q: '', a: '' }] })} className="inline-flex items-center gap-1 text-xs text-accent-ink hover:underline">
          <Plus size={13} /> вопрос-ответ
        </button>
      </div>
    );
  }

  if (block.type === 'choice' || block.type === 'multi') {
    return (
      <div className="space-y-2">
        <Input value={block.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Текст вопроса" />
        <OptionsEditor block={block} onChange={onChange} />
        <div className="flex items-center gap-2">
          <Input value={block.key || ''} onChange={(e) => onChange({ key: e.target.value })} placeholder="ключ" className="w-40" />
          {block.type === 'choice' && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={!!block.required} onChange={(e) => onChange({ required: e.target.checked })} className="accent-accent" /> обязательное
            </label>
          )}
        </div>
      </div>
    );
  }

  if (block.type === 'scale') {
    return (
      <div className="space-y-2">
        <Input value={block.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Текст вопроса" />
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>оценка от 1 до</span>
          <Input type="number" className="w-16" value={block.max || 5} onChange={(e) => onChange({ max: Math.max(2, Math.min(10, +e.target.value)) })} />
        </div>
        <div className="flex items-center gap-2">
          <Input value={block.minLabel || ''} onChange={(e) => onChange({ minLabel: e.target.value })} placeholder="подпись слева (напр. «новичок»)" />
          <Input value={block.maxLabel || ''} onChange={(e) => onChange({ maxLabel: e.target.value })} placeholder="подпись справа (напр. «эксперт»)" />
        </div>
        <Input value={block.key || ''} onChange={(e) => onChange({ key: e.target.value })} placeholder="ключ" className="w-40" />
      </div>
    );
  }

  // field
  return (
    <div className="space-y-2">
      <Input value={block.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Вопрос / подпись поля" />
      <div className="flex items-center gap-2">
        <Select size="sm" className="w-40" value={block.input || 'text'} onChange={(v) => onChange({ input: v as any })} options={INPUT_OPTS} />
        <Input value={block.key || ''} onChange={(e) => onChange({ key: e.target.value })} placeholder="ключ (name, contact…)" className="w-40" />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={!!block.required} onChange={(e) => onChange({ required: e.target.checked })} className="accent-accent" /> обязательное
        </label>
      </div>
    </div>
  );
}
