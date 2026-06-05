'use client';
import { useEffect, useState } from 'react';
import { Wand2, User as UserIcon, KeyRound, Building2, Webhook, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { BrandProfile, Me } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { LimitsSettings } from '@/components/LimitsSettings';
import { SectionAnchors } from '@/components/SectionNav';

const EMPTY: BrandProfile = { companyName: '', niche: '', social: '', about: '', tone: '', audience: '', perks: '', signature: '', sample: '', avoid: '' };

// «Голос бренда» — персонализация ИИ под клиента (его критерии и стиль).
export default function SettingsPage() {
  const [p, setP] = useState<BrandProfile | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<BrandProfile>('/api/brand-profile').then((d) => setP({ ...EMPTY, ...d })).catch(() => setP(EMPTY));
  }, []);

  if (!p) return <div className="p-8 text-muted">Загрузка…</div>;
  const set = (k: keyof BrandProfile, v: string) => setP({ ...p, [k]: v });

  async function save() {
    await api.put('/api/brand-profile', p);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <>
      <PageHeader
        title="Настройки"
        subtitle="Голос бренда — ИИ будет писать посты и ответы в твоём стиле, а не шаблонно."
      />
      <div className="max-w-2xl space-y-5 p-8">
        <SectionAnchors
          items={[
            { id: 'sec-account', title: 'Аккаунт' },
            { id: 'sec-workspace', title: 'Пространство' },
            { id: 'sec-brand', title: 'Голос бренда' },
            { id: 'sec-integrations', title: 'Интеграции' },
            { id: 'sec-limits', title: 'Лимиты' },
          ]}
        />

        <div id="sec-account" className="scroll-mt-16">
          <AccountCard />
        </div>

        <div id="sec-integrations" className="scroll-mt-16">
          <IntegrationsCard />
        </div>

        {/* Рабочее пространство / организация */}
        <Card id="sec-workspace" className="scroll-mt-16">
          <div className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Building2 size={18} className="text-accent-ink" /> Рабочее пространство
          </div>
          <p className="mb-5 text-sm text-muted">Твоя организация — название показывается в меню, а ниша помогает ИИ.</p>
          <div className="space-y-4">
            <Field label="Название компании / проекта">
              <Input value={p.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="Например, Студия Reels" />
            </Field>
            <Field label="Ниша" hint="помогает ИИ попадать в контекст">
              <Input value={p.niche} onChange={(e) => set('niche', e.target.value)} placeholder="продюсерский центр / онлайн-школа / агентство" />
            </Field>
            <Field label="Соцсеть / профиль">
              <Input value={p.social} onChange={(e) => set('social', e.target.value)} placeholder="@account или ссылка" />
            </Field>
            <Field label="О команде" hint="пара слов о вас">
              <Textarea value={p.about} onChange={(e) => set('about', e.target.value)} placeholder="Небольшая команда, делаем контент для брендов…" />
            </Field>
          </div>
          <Button className="mt-6" onClick={save}>
            {saved ? 'Сохранено ✓' : 'Сохранить'}
          </Button>
        </Card>

        <Card id="sec-brand" className="scroll-mt-16">
          <div className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Wand2 size={18} className="text-accent-ink" /> Голос бренда
          </div>
          <p className="mb-5 text-sm text-muted">
            Это «обучение ИИ под себя»: чем точнее заполнишь, тем уникальнее и попадающее в тон будут тексты. Поля
            необязательные — но именно они отличают тебя от всех остальных.
          </p>

          <div className="space-y-4">
            <Field label="Тон общения" hint="напр. на ты, дружелюбно, с лёгким юмором">
              <Input value={p.tone} onChange={(e) => set('tone', e.target.value)} placeholder="на ты, по-человечески, без пафоса" />
            </Field>
            <Field label="Кого ищешь / аудитория" hint="кому адресованы посты">
              <Input value={p.audience} onChange={(e) => set('audience', e.target.value)} placeholder="фрилансеры-новички и средний уровень, удалёнка" />
            </Field>
            <Field label="Чем привлекаешь" hint="плюсы работы с тобой — ИИ вплетёт в посты">
              <Textarea value={p.perks} onChange={(e) => set('perks', e.target.value)} placeholder="быстрые выплаты, чёткое ТЗ, рост, дружная команда…" />
            </Field>
            <Field label="Куда вести / подпись" hint="чем заканчивать ответы">
              <Input value={p.signature} onChange={(e) => set('signature', e.target.value)} placeholder="пиши в Telegram @hr_team" />
            </Field>
            <Field label="Пример удачного поста" hint="референс стиля — ИИ повторит подачу, не копируя">
              <Textarea value={p.sample} onChange={(e) => set('sample', e.target.value)} placeholder="Вставь свой лучший пост, который заходил" />
            </Field>
            <Field label="Не использовать" hint="стоп-слова и клише">
              <Input value={p.avoid} onChange={(e) => set('avoid', e.target.value)} placeholder="«срочно требуется», канцелярит, капс" />
            </Field>
          </div>

          <Button className="mt-6" onClick={save}>
            {saved ? 'Сохранено ✓' : 'Сохранить'}
          </Button>
        </Card>

        <div id="sec-limits" className="scroll-mt-16">
          <LimitsSettings />
        </div>
      </div>
    </>
  );
}

// Аккаунт: email (только чтение), имя, смена пароля.
function AccountCard() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [pw, setPw] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<Me>('/api/auth/me').then((m) => {
      setMe(m);
      setName(m.name || '');
    });
  }, []);

  async function saveName() {
    await api.patch('/api/auth/profile', { name });
    setSavedName(true);
    setTimeout(() => setSavedName(false), 1500);
  }
  async function changePw() {
    setPw(null);
    try {
      await api.post('/api/auth/change-password', { currentPassword: cur, newPassword: nw });
      setCur('');
      setNw('');
      setPw({ ok: true, text: 'Готово! Пароль обновлён' });
      setTimeout(() => setPw(null), 4000);
    } catch (e: any) {
      setPw({ ok: false, text: e.message });
    }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2 text-base font-semibold">
        <UserIcon size={18} className="text-accent-ink" /> Аккаунт
      </div>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm">Email</label>
          <Input value={me?.email || ''} disabled />
        </div>
        <div>
          <label className="mb-1.5 block text-sm">Имя</label>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Как к тебе обращаться" />
            <Button variant="ghost" onClick={saveName}>
              {savedName ? '✓' : 'Сохранить'}
            </Button>
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <KeyRound size={15} className="text-muted" /> Смена пароля
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Текущий пароль" />
            <Input type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder="Новый пароль (от 8)" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={changePw} disabled={!cur || nw.length < 8}>
              Обновить пароль
            </Button>
            {pw &&
              (pw.ok ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-sm font-medium text-success ring-1 ring-success/20 transition-all">
                  <CheckCircle2 size={16} /> {pw.text}
                </span>
              ) : (
                <span className="text-sm text-danger">{pw.text}</span>
              ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm">
        {label}
        {hint && <span className="ml-2 text-xs text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

// Интеграции: исходящий вебхук — новый лид и ответы анкеты уходят на URL клиента
// (Zapier/Make/n8n → Telegram, Google Sheets, Excel Online).
const WEBHOOK_EVENTS: { key: string; label: string }[] = [
  { key: 'lead.created', label: 'Новый лид (поймано кодовое слово)' },
  { key: 'candidate.response', label: 'Ответ в анкете (каждый шаг)' },
  { key: 'candidate.completed', label: 'Анкета завершена' },
];

function IntegrationsCard() {
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>([]); // пусто = все события
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ webhookUrl: string; webhookSecret: string; webhookEvents: string[] }>('/api/integrations')
      .then((d) => {
        setUrl(d.webhookUrl || '');
        setSecret(d.webhookSecret || '');
        setEvents(d.webhookEvents || []);
      })
      .catch(() => {});
  }, []);

  const toggleEvent = (k: string) =>
    setEvents((e) => {
      // Пустой массив отображается как «все выбраны» — материализуем полный список,
      // чтобы снятие одной галочки убирало именно её, а не оставляло только её.
      const base = e.length === 0 ? WEBHOOK_EVENTS.map((x) => x.key) : e;
      return base.includes(k) ? base.filter((x) => x !== k) : [...base, k];
    });
  const genSecret = () => setSecret('whsec_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));

  async function save() {
    setTest(null);
    try {
      // пусто = все события (на сервере null)
      await api.patch('/api/integrations', { webhookUrl: url.trim(), webhookSecret: secret.trim(), webhookEvents: events });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      setTest({ ok: false, text: e.message });
    }
  }
  async function runTest() {
    setBusy(true);
    setTest(null);
    try {
      await api.post('/api/integrations/test', {});
      setTest({ ok: true, text: 'Тестовое событие доставлено ✓' });
    } catch (e: any) {
      setTest({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2 text-base font-semibold">
        <Webhook size={18} className="text-accent-ink" /> Интеграции
      </div>
      <p className="mb-4 text-sm text-muted">
        Вебхук: мы шлём POST с данными на твой URL по выбранным событиям. Подключи его в Zapier / Make / n8n — и получай
        кандидатов и ответы анкет прямо в <b>Telegram</b>, <b>Google Sheets</b>, <b>Excel Online</b> или своей CRM.
      </p>
      <div className="space-y-4">
        <Field label="URL вебхука" hint="https://… (endpoint Zapier/Make/Telegram-бота)">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/…" />
        </Field>

        <Field label="Какие события слать" hint="не выбрано ни одного = слать все">
          <div className="space-y-1.5">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={events.length === 0 || events.includes(ev.key)} onChange={() => toggleEvent(ev.key)} className="accent-accent" />
                <span>{ev.label}</span>
                <span className="font-mono text-xs text-muted">{ev.key}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Секрет подписи" hint="придёт в заголовке X-Threadhunt-Secret — чтобы получатель проверил подлинность">
          <div className="flex items-center gap-2">
            <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="необязательно" className="flex-1 font-mono" />
            <Button variant="ghost" size="sm" onClick={genSecret} type="button">Сгенерировать</Button>
          </div>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить'}</Button>
        <Button variant="ghost" onClick={runTest} disabled={busy || !url.trim()}>
          {busy ? 'Отправляю…' : 'Отправить тест'}
        </Button>
        {test && <span className={`text-sm ${test.ok ? 'text-success' : 'text-danger'}`}>{test.text}</span>}
      </div>
      <div className="mt-4 rounded-xl bg-bg p-3 text-xs text-muted">
        Тело: <span className="font-mono">{'{ event, at, data }'}</span>. Заголовки: <span className="font-mono">X-Threadhunt-Event</span>
        {' '}и <span className="font-mono">X-Threadhunt-Secret</span> (если задан секрет). Лиды также выгружаются в CSV на странице «Лиды».
      </div>
    </Card>
  );
}
