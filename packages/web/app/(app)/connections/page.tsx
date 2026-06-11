'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Plug, Trash2, Chrome, Copy, Check, Send, X, ArrowRight, Megaphone, Download, HelpCircle, RefreshCw, Pin, LogIn, FlaskConical, AlertTriangle, Circle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Connection, Device, MetaConnection, AccountQuota } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { SafetyNotice } from '@/components/SafetyNotice';
import { SectionAnchors } from '@/components/SectionNav';
import { cn } from '@/lib/cn';

// Адрес бэкенда, КУДА расширение шлёт heartbeat/задачи (НЕ через прокси веба — напрямую).
// Должен совпадать с DEFAULT_API в расширении. На Vercel лучше задать NEXT_PUBLIC_AGENT_API
// явно; фолбэк — прод-API на Railway (иначе расширению уходил localhost → «оффлайн»).
const AGENT_API = process.env.NEXT_PUBLIC_AGENT_API || 'https://threadhuntserver-production.up.railway.app';
// Публичный листинг расширения в Chrome Web Store (опубликовано). Можно переопределить
// переменной NEXT_PUBLIC_EXT_STORE_URL в Netlify.
const STORE_URL = process.env.NEXT_PUBLIC_EXT_STORE_URL || 'https://chromewebstore.google.com/detail/iaeecnlkmhekpngjpngkmkmgppgfdloi';
// Готовый файл расширения (статика, лежит в web/public). Пока расширения нет в
// Chrome Web Store — клиент ставит его отсюда «распакованным».
const EXT_DOWNLOAD = '/threadhunt-extension.zip';
const EXT_IN_STORE = STORE_URL !== '#'; // если задан NEXT_PUBLIC_EXT_STORE_URL — расширение уже в Store
// Версия, опубликованная в Chrome Web Store. После загрузки новой сборки в Store
// (packages/extension/manifest.json → тот же номер) подними это значение —
// у клиентов со старой версией появится баннер «доступно обновление».
const LATEST_EXT_VERSION = '0.1.1';

// Сравнение версий «a < b» (semver-подобно, по числовым сегментам). null/пусто = неизвестно.
function isOlder(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

export default function ConnectionsPage() {
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [extPresent, setExtPresent] = useState(false);
  const [manualToken, setManualToken] = useState<string | null>(null); // инлайн-фолбэк, не попап
  const [addingApi, setAddingApi] = useState(false); // инлайн-форма Threads API
  const [meta, setMeta] = useState<MetaConnection | null>(null);
  const [addingMeta, setAddingMeta] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [showGuide, setShowGuide] = useState(false); // развёрнута ли инструкция по установке
  const [quota, setQuota] = useState<AccountQuota | null>(null);
  // Тесты «работает или нет» (без реальных действий).
  const [apiTest, setApiTest] = useState<{ busy?: boolean; ok?: boolean; msg?: string } | null>(null);
  const [dmTest, setDmTest] = useState<{ busy?: boolean; ok?: boolean; msg?: string } | null>(null);
  const dmTestCancel = useRef(false); // флаг остановки опроса теста

  // Остановить тест: прекратить опрос + снять запрос на сервере.
  function stopDmTest() {
    dmTestCancel.current = true;
    setDmTest(null);
    api.post('/api/dm/test-cancel').catch(() => {});
  }

  async function runApiTest() {
    setApiTest({ busy: true });
    try {
      const r = await api.post<{ ok: boolean; username?: string | null; error?: string }>('/api/threads/test');
      setApiTest(r.ok ? { ok: true, msg: `Токен рабочий${r.username ? ` · @${r.username}` : ''}` } : { ok: false, msg: r.error || 'не удалось' });
    } catch (e: any) {
      setApiTest({ ok: false, msg: e.message });
    }
  }

  // Холостой тест отбивки: просим расширение прогнать директ без отправки и ждём результат.
  async function runDmTest() {
    dmTestCancel.current = false;
    setDmTest({ busy: true, msg: 'Проверяю… расширение само прогонит директ в фоне (до ~1.5 мин). Открывать ничего не нужно — главное быть залогиненным в Threads в этом браузере.' });
    // Запоминаем предыдущую метку результата — поймём, что пришёл НОВЫЙ (без завязки на часы).
    let prevTestAt: string | null = null;
    try {
      const before = await api.get<{ lastTestAt: string | null }>('/api/dm/test-result');
      prevTestAt = before.lastTestAt;
    } catch {}
    try {
      await api.post('/api/dm/test');
    } catch (e: any) {
      setDmTest({ ok: false, msg: e.message });
      return;
    }
    let tries = 0;
    const poll = async () => {
      if (dmTestCancel.current) return; // остановлено пользователем
      tries++;
      try {
        const r = await api.get<{ pending: boolean; lastTestAt: string | null; scanned: number; matched: number; agent: { online: boolean; threadsLoggedIn: boolean } }>('/api/dm/test-result');
        if (r.lastTestAt && r.lastTestAt !== prevTestAt) {
          setDmTest({ ok: true, msg: `Проверено диалогов: ${r.scanned} · найдено совпадений: ${r.matched} · отправлено: 0 (тест). Связь работает ✓` });
          return;
        }
        if (!r.agent.online && tries > 2) {
          setDmTest({ busy: true, msg: 'Расширение офлайн. Обнови расширение (↻ в chrome://extensions) и подожди минуту.' });
        }
      } catch {
        /* продолжаем опрос */
      }
      if (tries < 40) setTimeout(poll, 5000); // до ~3 минут
      else setDmTest({ ok: false, msg: 'Результат не пришёл. Убедись, что расширение онлайн (статус выше) и ты залогинен в Threads в этом браузере, затем запусти ещё раз.' });
    };
    setTimeout(poll, 4000);
  }

  const loadConns = () => api.get<Connection[]>('/api/connections').then(setConns).catch(() => setConns([]));
  const loadDevices = () => api.get<Device[]>('/api/devices').then(setDevices).catch(() => setDevices([]));
  const loadMeta = () => api.get<MetaConnection>('/api/meta/connection').then(setMeta).catch(() => setMeta({ connected: false }));
  const loadQuota = () => api.get<AccountQuota>('/api/account/quota').then(setQuota).catch(() => {});

  useEffect(() => {
    loadConns();
    loadDevices();
    loadMeta();
    loadQuota();
    // Результат возврата из OAuth (?threads=… / ?meta=…)
    const q = new URLSearchParams(window.location.search);
    const NOTE: Record<string, { ok: boolean; text: string }> = {
      'threads:connected': { ok: true, text: 'Threads подключён через OAuth ✓' },
      'threads:error': { ok: false, text: 'Не удалось подключить Threads. Попробуйте ещё раз или вставьте токен вручную.' },
      'threads:unconfigured': { ok: false, text: 'Вход через Threads ещё не настроен (приложение на модерации Meta). Пока используйте ручной токен.' },
      'meta:connected': { ok: true, text: 'Рекламный кабинет Meta подключён ✓' },
      'meta:error': { ok: false, text: 'Не удалось подключить Meta. Попробуйте ещё раз или укажите кабинет вручную.' },
      'meta:unconfigured': { ok: false, text: 'Вход через Meta ещё не настроен (приложение на модерации). Пока укажите кабинет вручную.' },
    };
    const key = q.get('threads') ? `threads:${q.get('threads')}` : q.get('meta') ? `meta:${q.get('meta')}` : '';
    if (NOTE[key]) {
      setNotice(NOTE[key]);
      window.history.replaceState({}, '', '/connections');
    }
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      if (e.data?.source === 'threadhunt-present') setExtPresent(true);
      if (e.data?.source === 'threadhunt-paired') {
        setManualToken(null);
        setTimeout(loadDevices, 400);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Авто-обновление статуса устройств — клиенту не нужно жать F5, чтобы увидеть «онлайн».
  useEffect(() => {
    const t = setInterval(() => loadDevices(), 15_000);
    return () => clearInterval(t);
  }, []);

  async function connectBrowser() {
    try {
      const { token } = await api.post<{ token: string }>('/api/devices', {});
      if (extPresent) {
        window.postMessage({ source: 'threadhunt-pair', token, api: AGENT_API }, location.origin);
        setTimeout(loadDevices, 600);
      } else {
        setManualToken(token);
      }
      loadQuota();
    } catch (e: any) {
      // Лимит мест: апселл — апгрейд тарифа или доп-место.
      setNotice({ ok: false, text: e?.message || 'Не удалось подключить аккаунт.' });
    }
  }

  // OAuth-старт: берём готовый URL через прокси (cookie доходит) и уводим браузер
  // напрямую на провайдера. Прямой 302 через прокси Netlify даёт «upstream error».
  async function startOAuth(provider: 'threads' | 'meta') {
    try {
      const { url, unconfigured } = await api.get<{ url: string | null; unconfigured?: boolean }>(`/api/${provider}/oauth/url`);
      if (unconfigured || !url) {
        setNotice({ ok: false, text: provider === 'threads' ? 'Вход через Threads ещё не настроен (нет ключей приложения на сервере).' : 'Вход через Meta ещё не настроен.' });
        return;
      }
      window.location.href = url;
    } catch {
      setNotice({ ok: false, text: 'Не удалось начать авторизацию. Попробуйте ещё раз или подключите вручную по токену.' });
    }
  }

  return (
    <>
      <PageHeader title="Подключения" subtitle="Расширение — для отбивки в директе. Threads API — для автопостинга (опционально)." />

      <div className="space-y-6 p-8">
        {notice && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${notice.ok ? 'border-success/30 bg-success/5 text-success' : 'border-warning/30 bg-warning/5 text-warning'}`}>
            {notice.text}
          </div>
        )}

        <SafetyNotice />

        <SectionAnchors
          items={[
            { id: 'sec-ext', title: 'Расширение' },
            { id: 'sec-api', title: 'Threads API' },
            { id: 'sec-meta', title: 'Meta Ads' },
          ]}
        />

        {/* ── Секция 1: Расширение (ядро, без Meta) ── */}
        <Card id="sec-ext" className="scroll-mt-16">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold">
                <Chrome size={18} /> Браузер для отбивки
              </div>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Работает в твоём браузере, где ты уже залогинен в Threads. Никакого Meta не нужно — поставь расширение и
                подключи браузер в один клик.
              </p>
              {quota && (
                <div className="mt-2 text-xs">
                  <span className="text-muted">Аккаунтов (мест): </span>
                  <b className={quota.used >= quota.limit ? 'text-warning' : 'text-text'}>
                    {quota.used} из {quota.limit}
                  </b>
                  {quota.extraSeats > 0 && <span className="text-muted"> · +{quota.extraSeats} доп.</span>}
                  {quota.used >= quota.limit && (
                    <>
                      {' '}
                      <Link href="/billing" className="text-accent-ink hover:underline">
                        добавить место →
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>
            <Button onClick={connectBrowser} disabled={!!quota && quota.used >= quota.limit}>
              <Plug size={16} /> Подключить браузер
            </Button>
          </div>

          {/* Важно: расширение работает в залогиненной сессии Threads — без входа бесполезно. */}
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-accent/30 bg-accent-soft/50 px-3 py-2.5 text-sm">
            <LogIn size={16} className="mt-0.5 shrink-0 text-accent-ink" />
            <span>
              <b>Сначала войди в Threads</b> в этом браузере под нужным профилем — бот работает в твоей залогиненной сессии.
              Без входа в{' '}
              <a href="https://www.threads.com/login" target="_blank" rel="noreferrer" className="font-medium text-accent-ink hover:underline">threads.com</a>{' '}
              отбивка и постинг не запустятся.
            </span>
          </div>

          {/* Пошаговая диагностика — клиент сразу видит, что не так и что нажать. */}
          <ConnectionStatus extPresent={extPresent} devices={devices} onReconnect={connectBrowser} />


          {/* Тест отбивки: холостой проход без отправки/приёма — «работает или нет». */}
          <div className="mt-3 rounded-xl border border-line bg-bg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <div className="font-medium">Проверить отбивку</div>
                <div className="text-xs text-muted">Холостой проход по директу: посчитает совпадения. Ничего не отправляет и не принимает.</div>
              </div>
              {dmTest?.busy ? (
                <Button variant="danger" size="sm" onClick={stopDmTest}>
                  <X size={15} /> Остановить тест
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={runDmTest}>
                  <FlaskConical size={15} /> Запустить тест
                </Button>
              )}
            </div>
            {dmTest?.msg && (
              <p className={`mt-2 text-xs ${dmTest.ok === false ? 'text-danger' : dmTest.ok ? 'text-success' : 'text-muted'}`}>{dmTest.msg}</p>
            )}
          </div>

          {/* Баннер «доступно обновление»: хоть один подключённый браузер на старой версии */}
          {EXT_IN_STORE && devices && devices.some((d) => isOlder(d.version, LATEST_EXT_VERSION)) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-warning">
              <RefreshCw size={15} className="shrink-0" />
              <span>Доступно обновление расширения (v{LATEST_EXT_VERSION}). Обнови, чтобы получить последние улучшения и исправления.</span>
              <a href={STORE_URL} target="_blank" rel="noreferrer" className="font-medium underline">
                Обновить в Chrome Web Store →
              </a>
            </div>
          )}

          {/* Подсказка: закрепить иконку на панели (актуально всегда) */}
          <div className="mt-2 flex items-start gap-1.5 text-xs text-muted">
            <Pin size={13} className="mt-0.5 shrink-0" />
            <span>
              Совет: нажми на «пазл» <span aria-hidden>🧩</span> справа в панели браузера и <b>закрепи</b> иконку Threadhunt — так она всегда под рукой, и видно, что отбивка работает.
              {EXT_IN_STORE && (
                <>
                  {' '}
                  <a href={STORE_URL} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
                    Открыть страницу расширения
                  </a>
                </>
              )}
            </span>
          </div>

          {/* Скачивание файла расширения + инструкция (пока нет в Chrome Web Store) */}
          {!extPresent && (
            <div className="mt-4 rounded-xl border border-line bg-bg p-4">
              <div className="flex flex-wrap items-center gap-3">
                {EXT_IN_STORE ? (
                  <a href={STORE_URL} target="_blank" rel="noreferrer">
                    <Button>
                      <Chrome size={16} /> Установить из Chrome Web Store
                    </Button>
                  </a>
                ) : (
                  <a href={EXT_DOWNLOAD} download>
                    <Button>
                      <Download size={16} /> Скачать расширение (.zip)
                    </Button>
                  </a>
                )}
                <Button variant="ghost" onClick={() => setShowGuide((v) => !v)}>
                  <HelpCircle size={15} /> {showGuide ? 'Скрыть инструкцию' : 'Как установить'}
                </Button>
              </div>

              {showGuide && <InstallGuide />}
            </div>
          )}

          {/* Инлайн-фолбэк с кодом (если расширение не стоит) — без попапа */}
          <InlinePanel open={!!manualToken} onClose={() => setManualToken(null)}>
            <p className="text-sm text-muted">
              Похоже, расширение ещё не установлено.{' '}
              <a href={STORE_URL} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
                Поставь его
              </a>{' '}
              и нажми «Подключить браузер» ещё раз — подключится само. Или впиши в попап расширения <b>оба</b> поля:
            </p>
            <div className="mt-2 space-y-2">
              <div>
                <div className="mb-1 text-xs text-muted">Адрес сервера</div>
                <div className="flex items-center gap-2 rounded-xl border border-line bg-bg p-3 font-mono text-sm">
                  <span className="flex-1 break-all">{AGENT_API}</span>
                  <button onClick={() => navigator.clipboard.writeText(AGENT_API)} className="text-muted hover:text-accent-ink">
                    <Copy size={16} />
                  </button>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted">Код спаривания</div>
                <div className="flex items-center gap-2 rounded-xl border border-line bg-bg p-3 font-mono text-sm">
                  <span className="flex-1 break-all">{manualToken}</span>
                  <button onClick={() => manualToken && navigator.clipboard.writeText(manualToken)} className="text-muted hover:text-accent-ink">
                    <Copy size={16} />
                  </button>
                </div>
              </div>
            </div>
          </InlinePanel>

          <div className="mt-4 space-y-2">
            {devices === null ? (
              <div className="text-sm text-muted">Загрузка…</div>
            ) : devices.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Браузер ещё не подключён.</div>
            ) : (
              devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5 text-sm">
                  <span>{d.label || 'Браузер'}</span>
                  <div className="flex items-center gap-3">
                    <Badge tone={d.online ? 'success' : 'neutral'}>{d.online ? '● онлайн' : '○ оффлайн'}</Badge>
                    <button onClick={() => api.del(`/api/devices/${d.id}`).then(() => { loadDevices(); loadQuota(); })} className="text-muted hover:text-danger">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* ── Секция 2: Threads API (опционально) ── */}
        <Card id="sec-api" className="scroll-mt-16">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold">
                <Send size={17} /> Threads API · автопостинг
              </div>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Опционально — чтобы бот сам публиковал посты-приманки. Для отбивки в директе НЕ требуется.
              </p>
              <p className="mt-2 inline-flex max-w-xl items-start gap-1.5 rounded-lg bg-warning/5 px-2.5 py-1.5 text-xs text-warning">
                <span>⏳</span>
                <span>
                  Прямой вход через Threads (в один клик) скоро: приложение на модерации у Meta. Пока подключайте по
                  токену API — это временно.
                </span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Button onClick={() => startOAuth('threads')}>
                <Send size={15} /> Войти через Threads
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAddingApi((v) => !v)}>
                {addingApi ? <X size={15} /> : <Plug size={15} />} {addingApi ? 'Свернуть' : 'по токену'}
              </Button>
            </div>
          </div>

          {/* Инлайн-форма подключения токена (вместо попапа) */}
          <InlinePanel open={addingApi} onClose={() => setAddingApi(false)}>
            <ApiTokenForm
              onAdded={() => {
                setAddingApi(false);
                loadConns();
              }}
            />
          </InlinePanel>

          <div className="mt-4 space-y-2">
            {conns === null ? (
              <div className="text-sm text-muted">Загрузка…</div>
            ) : conns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                Аккаунт для автопостинга не подключён.
              </div>
            ) : (
              conns.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5">
                  <div>
                    <div className="font-medium">@{c.username}</div>
                    <div className="text-xs text-muted">{c.searches} поисков</div>
                  </div>
                  <button onClick={() => api.del(`/api/connections/${c.id}`).then(loadConns)} className="text-muted hover:text-danger">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Тест Threads API: read-only /me, ничего не публикует. */}
          {conns && conns.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="ghost" size="sm" onClick={runApiTest} disabled={apiTest?.busy}>
                <FlaskConical size={15} /> {apiTest?.busy ? 'Проверяю…' : 'Проверить подключение'}
              </Button>
              {apiTest?.msg && <span className={`text-xs ${apiTest.ok ? 'text-success' : 'text-danger'}`}>{apiTest.ok ? '✓ ' : '✗ '}{apiTest.msg}</span>}
            </div>
          )}
        </Card>

        {/* ── Секция 3: Meta Ads (реклама, опционально) ── */}
        <Card id="sec-meta" className="scroll-mt-16">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold">
                <Megaphone size={17} /> Meta Ads · рекламные кампании
              </div>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Чтобы запускать готовые связки лидгена на директ из{' '}
                <Link href="/campaigns" className="text-accent-ink hover:underline">раздела «Кампании»</Link>. Для отбивки в директе НЕ требуется.
              </p>
              <p className="mt-2 inline-flex max-w-xl items-start gap-1.5 rounded-lg bg-warning/5 px-2.5 py-1.5 text-xs text-warning">
                <span>⏳</span>
                <span>
                  Прямой запуск рекламы и авторизация через Meta скоро: приложение на модерации. Пока можно указать рекламный
                  кабинет — связки соберутся заранее и запустятся сразу после одобрения.
                </span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Button onClick={() => startOAuth('meta')}>
                <Megaphone size={15} /> Войти через Meta
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAddingMeta((v) => !v)}>
                {addingMeta ? <X size={15} /> : <Plug size={15} />} {addingMeta ? 'Свернуть' : meta?.connected ? 'Изменить вручную' : 'вручную (act_…)'}
              </Button>
            </div>
          </div>

          <InlinePanel open={addingMeta} onClose={() => setAddingMeta(false)}>
            <MetaForm
              initial={meta}
              onSaved={() => {
                setAddingMeta(false);
                loadMeta();
              }}
            />
          </InlinePanel>

          <div className="mt-4">
            {meta === null ? (
              <div className="text-sm text-muted">Загрузка…</div>
            ) : meta.connected ? (
              <div className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5">
                <div>
                  <div className="font-medium">{meta.businessName || 'Рекламный кабинет'}</div>
                  <div className="text-xs text-muted">{meta.adAccountId} · {meta.status === 'active' ? 'активен' : 'на модерации Meta'}</div>
                </div>
                <button onClick={() => api.del('/api/meta/connection').then(loadMeta)} className="text-muted hover:text-danger">
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Рекламный кабинет Meta не подключён.</div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

// Понятная диагностика подключения отбивки: три шага со статусом и конкретной
// подсказкой на каждом сбое. Чтобы клиент не застрял на безликом «оффлайн».
function ConnectionStatus({ extPresent, devices, onReconnect }: { extPresent: boolean; devices: Device[] | null; onReconnect: () => void }) {
  const online = !!devices?.some((d) => d.online);
  const loggedIn = !!devices?.some((d) => d.online && d.threadsLoggedIn);
  // Текущий «блокирующий» шаг — первый невыполненный.
  const steps = [
    {
      ok: extPresent,
      title: 'Расширение установлено',
      fix: <>Установи расширение {EXT_IN_STORE ? 'из Chrome Web Store' : 'по шагам'} ниже и обнови страницу.</>,
    },
    {
      ok: online,
      title: 'Браузер подключён',
      fix: (
        <>
          Нажми{' '}
          <button onClick={onReconnect} className="font-medium text-accent-ink hover:underline">
            «Подключить браузер»
          </button>
          . Если не помогло — открой <span className="font-mono">chrome://extensions</span>, нажми <b>↻</b> на карточке Threadhunt и подожди ~1 минуту.
        </>
      ),
    },
    {
      ok: loggedIn,
      title: 'Вход в Threads выполнен',
      fix: (
        <>
          Войди в{' '}
          <a href="https://www.threads.com/login" target="_blank" rel="noreferrer" className="font-medium text-accent-ink hover:underline">
            threads.com
          </a>{' '}
          под нужным профилем в этом браузере.
        </>
      ),
    },
  ];
  const allOk = steps.every((s) => s.ok);
  const blockingIdx = steps.findIndex((s) => !s.ok);

  return (
    <div className={`mt-3 rounded-xl border p-3 ${allOk ? 'border-success/30 bg-success/5' : 'border-line bg-bg'}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">{allOk ? 'Отбивка готова к работе ✓' : 'Состояние подключения'}</div>
        {!allOk && online === false && extPresent && (
          <Button variant="ghost" size="sm" onClick={onReconnect}>
            <RefreshCw size={14} /> Переподключить
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 shrink-0 ${s.ok ? 'text-success' : i === blockingIdx ? 'text-warning' : 'text-muted'}`}>
              {s.ok ? <Check size={15} /> : i === blockingIdx ? <AlertTriangle size={15} /> : <Circle size={15} />}
            </span>
            <div className="flex-1">
              <span className={s.ok ? '' : i === blockingIdx ? 'font-medium' : 'text-muted'}>{s.title}</span>
              {!s.ok && i === blockingIdx && <div className="mt-0.5 text-xs text-muted">{s.fix}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Пошаговая инструкция установки. В Store — короткий путь в один клик; иначе —
// «распакованным» через режим разработчика.
function InstallGuide() {
  const loginStep = (
    <>
      <b>Сначала войди в Threads</b> в этом браузере под нужным профилем (
      <a href="https://www.threads.com/login" target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">threads.com</a>
      ). Бот работает в твоей залогиненной сессии — без входа он ничего не сможет.
    </>
  );
  const storeSteps = [
    loginStep,
    <>Нажми <b>«Установить из Chrome Web Store»</b> выше → на странице расширения нажми <b>«Добавить в Chrome»</b> и подтверди.</>,
    <>Нажми на «пазл» 🧩 в панели браузера и <b>закрепи</b> иконку Threadhunt, чтобы была под рукой.</>,
    <>Вернись сюда и нажми <b>«Подключить браузер»</b> — код привяжется сам. Если попросит код вручную — скопируй его здесь и вставь в окне расширения.</>,
    <>Открой <b>Threads → Сообщения</b> (директ) — и отбивка заработает по твоим кодовым словам.</>,
  ];
  const devSteps = [
    loginStep,
    <>Нажми <b>«Скачать расширение (.zip)»</b> выше и <b>распакуй архив</b> в постоянную папку (например в «Документы»). Не оставляй в «Загрузках» — если папку удалить, расширение слетит.</>,
    <>Открой в браузере страницу <span className="font-mono">chrome://extensions</span> (скопируй и вставь в адресную строку).</>,
    <>Включи вверху справа тумблер <b>«Режим разработчика»</b> (Developer mode).</>,
    <>Нажми <b>«Загрузить распакованное»</b> (Load unpacked) и выбери распакованную папку (где лежит файл <span className="font-mono">manifest.json</span>).</>,
    <>Нажми на «пазл» 🧩 в панели браузера и <b>закрепи</b> иконку Threadhunt, чтобы была под рукой.</>,
    <>Вернись сюда и нажми <b>«Подключить браузер»</b> — код привяжется сам. Если попросит код вручную — скопируй его здесь и вставь в окне расширения.</>,
    <>Открой <b>Threads → Сообщения</b> (директ) — и отбивка заработает по твоим кодовым словам.</>,
  ];
  const steps = EXT_IN_STORE ? storeSteps : devSteps;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="mb-2 text-sm font-medium">Установка — {steps.length} шагов</div>
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-on-accent">{i + 1}</span>
            <span className="flex-1 leading-relaxed">{s}</span>
          </li>
        ))}
      </ol>
      {!EXT_IN_STORE && (
        <p className="mt-3 rounded-lg bg-warning/5 px-3 py-2 text-xs text-warning">
          Браузер может при запуске показывать предупреждение «Отключить расширения в режиме разработчика» — просто закрой его, расширение продолжит работать. Это временно, пока расширение не появится в Chrome Web Store (тогда установка будет в один клик).
        </p>
      )}
    </div>
  );
}

function MetaForm({ initial, onSaved }: { initial: MetaConnection | null; onSaved: () => void }) {
  const [adAccountId, setAdAccountId] = useState(initial?.adAccountId || '');
  const [businessName, setBusinessName] = useState(initial?.businessName || '');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function save() {
    setError('');
    setLoading(true);
    try {
      await api.post('/api/meta/connection', { adAccountId: adAccountId.trim(), businessName: businessName.trim(), accessToken: token.trim() || undefined });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Укажите ID рекламного аккаунта Meta (формат <span className="font-mono">act_XXXXXXXX</span>). Токен Marketing API — по
        желанию (для реального запуска после одобрения).
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} placeholder="act_1234567890" />
        <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Название бизнеса (необязательно)" />
      </div>
      <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Токен Marketing API (необязательно)" />
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={!adAccountId.trim() || loading}>
          {loading ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        {error && <div className="text-sm text-danger">{error}</div>}
      </div>
    </div>
  );
}

// Универсальная инлайн-панель (раскрывается на месте вместо модального окна).
function InlinePanel({ open, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className={cn('overflow-hidden transition-all duration-300', open ? 'mt-4 max-h-[460px] opacity-100' : 'max-h-0 opacity-0')}>
      <div className="rounded-xl border border-accent/30 bg-bg p-4">{children}</div>
    </div>
  );
}

function ApiTokenForm({ onAdded }: { onAdded: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function add() {
    setError('');
    setLoading(true);
    try {
      await api.post('/api/connections', { accessToken: token.trim() });
      setToken('');
      onAdded();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Вставь долгоживущий токен Threads API. Не знаешь, где взять?{' '}
        <Link href="/setup/threads" className="inline-flex items-center gap-1 text-accent-ink hover:underline">
          Пошаговая инструкция <ArrowRight size={13} />
        </Link>
      </p>
      <div className="flex items-center gap-2">
        <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="THQVJ…" />
        <Button onClick={add} disabled={!token || loading}>
          {loading ? 'Проверяю…' : 'Подключить'}
        </Button>
      </div>
      {error && <div className="text-sm text-danger">{error}</div>}
    </div>
  );
}
