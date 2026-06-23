// Content-script Threadhunt — работает на threads.com во вкладке клиента (он уже залогинен).
// Порт DOM-логики прототипа bot.js, адаптированный под MV3.
//
// ВАЖНОЕ ОТЛИЧИЕ ОТ bot.js (Playwright):
//   В Playwright проход — это один процесс, который делает page.goto по разделам и
//   чатам. В расширении КАЖДАЯ навигация (location.assign) перезагружает страницу и
//   убивает content-script. Поэтому обход сделан ВОЗОБНОВЛЯЕМЫМ: состояние живёт в
//   chrome.storage.session, и каждая загрузка страницы = ОДИН шаг конечного автомата.
//
// Бот проверяет ТРИ раздела в порядке (как в bot.js): Запросы → Скрытые → основной.
// Почти все отклики незнакомцев Threads складывает в Запросы/Скрытые, поэтому они
// обрабатываются первыми. Перед ответом в этих разделах часто нужно «Принять» диалог.
//
// Селекторы те же, что в bot.js (см. блок «ЕСЛИ НЕ РАБОТАЕТ» в исходнике). При
// поломке вёрстки Threads чинить здесь.

import { matchKeyword, type AgentTasksResponse, type AgentReplyEvent, type Keyword, type CalibrationConfig } from '@threadhunt/shared';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Активная ИИ-калибровка кнопок (подписи под язык/вёрстку юзера). Обновляется из задач
// на каждом шаге; рантайм матчит по ней «Принять»/«Показать»/«OK», избегая «Отклонить».
let runtimeCalib: CalibrationConfig | null = null;
const hasLabel = (b: HTMLElement, labels?: string[]): boolean =>
  !!labels?.some((l) => l && b.innerText.toLowerCase().includes(l.toLowerCase()));
const BASE = location.origin; // www.threads.com или www.threads.net

// Строка в живой журнал событий (видно в дашборде «Что происходит на бэке»). Не критично:
// если не дошло — проход не ломаем.
function serverLog(text: string, level: 'info' | 'reply' | 'warn' = 'info') {
  try { chrome.runtime.sendMessage({ type: 'log', level, text: text.slice(0, 300) }); } catch { /* ignore */ }
}

// Какой ответ слать: персональный текст под совпавшее слово (replyText) или, если
// его нет — общий шаблон поиска. Для персонального id нет → событие уйдёт без
// templateId (в БД replyTemplateId = null, FK не нарушается).
function pickReply(
  kw: { searchId: string; replyText?: string },
  replyBySearch: Record<string, { templates: { id?: string; text: string }[]; rotation?: string } | undefined>,
): { id?: string; text: string } | null {
  if (kw.replyText && kw.replyText.trim()) return { text: kw.replyText.trim() };
  const e = replyBySearch[kw.searchId];
  const tpls = e?.templates?.filter((t) => t.text && t.text.trim()) || [];
  if (!tpls.length) return null;
  // Чередуем шаблоны (случайно) — ответы варьируются, выглядит живее и безопаснее.
  // При одном шаблоне берём его; при нескольких — случайный из них.
  const tpl = tpls.length === 1 ? tpls[0] : tpls[Math.floor(Math.random() * tpls.length)];
  return { id: tpl.id, text: tpl.text };
}

// Дописать персональную ссылку онбординга в конец ответа (если включено для поиска).
// Ключ — id чата (тот же fromUserKey, что уходит в события), сервер по нему найдёт лида.
function withObLink(text: string, base: string | undefined, chatId: string): string {
  if (!base) return text;
  return `${text}\n\n→ Заполни короткую анкету: ${base}${encodeURIComponent(chatId)}`;
}

// Разделы директа в порядке приоритета (как в bot.js).
const SECTIONS = [
  { url: '/messages/requests', label: 'requests' },
  { url: '/messages/hidden', label: 'hidden' },
  { url: '/messages/', label: 'main' },
] as const;

type SectionDef = { url: string; label: string };

// Человекочитаемое имя раздела для журнала событий.
function sectionRu(label: string): string {
  return label === 'requests' ? 'Запросы' : label === 'hidden' ? 'Скрытые' : 'Основной директ';
}

// Какие разделы обходить — по галочкам из настроек (limits.sections). Если ничего
// не выбрано/настроек нет — обходим все три (поведение по умолчанию).
function activeSections(sections?: { main: boolean; requests: boolean; hidden: boolean }): SectionDef[] {
  if (!sections) return SECTIONS.map((s) => ({ ...s }));
  const on: Record<string, boolean> = { requests: sections.requests, hidden: sections.hidden, main: sections.main };
  const picked = SECTIONS.filter((s) => on[s.label]).map((s) => ({ ...s }));
  return picked.length ? picked : SECTIONS.map((s) => ({ ...s }));
}

// preview — текст строки чата в списке (имя + последнее сообщение). В Запросах/Скрытых
// само сообщение видно ТОЛЬКО здесь (чат до приёма сообщений не показывает), поэтому
// кодовое слово ищем в preview, не открывая чат (D.12 хендоффа — бережёт лимиты).
// matched — для Запросов/Скрытых: совпадение, найденное по preview ещё на сборе.
type Chat = {
  id: string;
  href: string;
  name: string;
  section: string;
  preview: string;
  matched?: { keyword: string; searchId: string; replyText?: string };
};

interface Sweep {
  // warmup — открыть /messages/ перед заходом в Запросы (без прогрева /messages/requests
  // падает с ошибкой, D.10 хендоффа).
  phase: 'warmup' | 'collect' | 'process';
  startedAt: number; // ms начала прохода — сверяем с меткой «Стоп», чтобы прервать только текущий
  sectionIdx: number;
  seenIds: string[];
  chats: Chat[];
  processIdx: number;
  attempted?: string[]; // chat.id, которым уже отправляли в ЭТОМ проходе — защита от двойной отправки
  events: AgentReplyEvent[];
  // правила, снятые на старте прохода (чтобы не зависеть от обновления tasks в середине)
  keywords: (Keyword & { searchId: string })[];
  replyBySearch: Record<string, { templates: { id?: string; text: string }[]; rotation?: string } | undefined>;
  obLinkBySearch: Record<string, string | undefined>; // база персональной ссылки онбординга на поиск
  repliedKeys: string[];
  minDelayMs: number;
  maxDialogs: number; // лимит читаемых диалогов за проход
  repliesLeft: number; // сколько ещё можно отправить сегодня
  sent: number; // отправлено за этот проход
  expectPath: string; // куда мы навигировали — для проверки, что страница та самая
  guard: number; // защита от зацикливания ре-навигаций
  dryRun?: boolean; // не отправлять (тест из popup ИЛИ безопасный режим)
  scanned?: number; // сколько диалогов осмотрено
  // Разделы директа, выбранные на старте прохода (по галочкам настроек).
  sections: SectionDef[];
  // Отправить серверу сводку прохода (статистика). true для реальных и безопасных
  // проходов; false для теста из popup (он пишет результат только в storage.local).
  reportPass?: boolean;
  // Холостой тест отбивки, запрошенный из ДАШБОРДА: dry-проход, результат уходит
  // серверу (type:'testResult'), ничего не отправляется и не принимается.
  serverTest?: boolean;
}

// Сейчас рабочее время? (окно «HH:MM», по локальному времени клиента)
function withinWorkingHours(wh: { enabled: boolean; from: string; to: string }): boolean {
  if (!wh.enabled) return true;
  const d = new Date();
  const cur = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = wh.from.split(':').map(Number);
  const [th, tm] = wh.to.split(':').map(Number);
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  return from <= to ? cur >= from && cur <= to : cur >= from || cur <= to; // через полночь
}

const SWEEP_KEY = 'sweep';
const LAST_SWEEP_KEY = 'lastSweepAt';
const TEST_RESULT_KEY = 'th_test_result'; // результат тест-прохода (для popup), в storage.local
// Антибан: проходы делают много навигаций (разделы + чаты), частые заходы ловят
// HTTP 429 (D.15 хендоффа). Интервал между обходами берётся из настроек
// (limits.sweepIntervalMinutes, минимум 30 мин) — см. ветку старта обхода.

async function getSweep(): Promise<Sweep | null> {
  const s = await chrome.storage.session.get(SWEEP_KEY);
  return (s[SWEEP_KEY] as Sweep) || null;
}
async function setSweep(sw: Sweep | null) {
  if (sw) await chrome.storage.session.set({ [SWEEP_KEY]: sw });
  else await chrome.storage.session.remove(SWEEP_KEY);
}

function isLoggedIn(): boolean {
  return !!document.querySelector('a[href^="/messages"]') || location.pathname.startsWith('/messages');
}

// Прокрутить виртуализированный список вниз, чтобы подгрузить больше чатов (порт scrollToBottom).
async function scrollList(times = 3) {
  for (let i = 0; i < times; i++) {
    const cands = [...document.querySelectorAll<HTMLElement>('div')].filter((d) => {
      const cs = getComputedStyle(d);
      return /auto|scroll/.test(cs.overflowY) && d.scrollHeight > d.clientHeight + 50;
    });
    for (const c of cands) c.scrollTop = c.scrollHeight;
    // Выдача поиска Threads чаще скроллит окно/документ, а не внутренний div.
    window.scrollTo(0, document.body.scrollHeight);
    document.scrollingElement?.scrollTo(0, document.scrollingElement.scrollHeight);
    await sleep(900);
  }
}

// Собрать чаты текущего раздела: ссылки a[href^="/messages/t/<id>/"] (порт collectChatsFrom).
function collectChats(section: string): Chat[] {
  const out: Chat[] = [];
  const seen = new Set<string>();
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="/messages/t/"]')) {
    const href = a.getAttribute('href') || '';
    const id = (href.match(/\/t\/(\d+)/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const raw = a.innerText || '';
    const name = raw.split('\n')[0].trim();
    const preview = raw.replace(/\s+/g, ' ').trim(); // вся строка чата: имя + превью сообщения
    out.push({ id, href, name, preview, section });
  }
  return out;
}

// Прочитать последнее сообщение и понять, входящее ли оно (порт readLastMessage из bot.js).
//
// forceIncoming=true для «Запросов»/«Скрытых»: там диалог ещё НЕ принят, поэтому
//   а) нет поля ввода [contenteditable][role=textbox] → расчёт колонки и направления
//      по leftGap/rightGap даёт мусор (баг: входящие считались исходящими);
//   б) ответить без «Принять» нельзя → последнее сообщение по определению ОТ отправителя.
// Значит в этих разделах последнее сообщение всегда трактуем как входящее.
function readLastMessage(forceIncoming = false): { text: string; incoming: boolean } | null {
  const input = document.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]');
  let col: HTMLElement | null = input;
  for (let i = 0; i < 6 && col; i++) col = col.parentElement;
  const colRect = col ? col.getBoundingClientRect() : ({ x: 0, width: window.innerWidth } as DOMRect);
  const inputTop = input ? input.getBoundingClientRect().top : Infinity;

  const nodes = [...document.querySelectorAll<HTMLElement>('div[dir="auto"], span[dir="auto"]')].filter(
    (e) => e.innerText && e.innerText.trim().length > 1,
  );
  const msgs: { text: string; incoming: boolean }[] = [];
  const seen = new Set<string>();
  for (const b of nodes) {
    const t = b.innerText.trim().replace(/\s+/g, ' ');
    if (/^\w{3,9} \d{1,2}, \d{4}/.test(t)) continue;
    if (t === 'Message unavailable') continue;
    // кнопки баннера запроса («Принять»/«Отклонить») — это не сообщение
    if (t.length < 24 && (ACCEPT_RX.test(t) || DECLINE_RX.test(t))) continue;
    const r = b.getBoundingClientRect();
    if (r.bottom > inputTop + 5) continue;
    const leftGap = r.x - colRect.x;
    const rightGap = colRect.x + colRect.width - (r.x + r.width);
    if (leftGap < -20) continue;
    if (Math.min(leftGap, rightGap) >= 150) continue;
    const key = t.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    msgs.push({ text: t, incoming: forceIncoming ? true : leftGap < rightGap });
  }
  return msgs.length ? msgs[msgs.length - 1] : null;
}

// На «Запросах»/«Скрытых» перед ответом Threads требует принять диалог.
// ЯЗЫКО-НЕЗАВИСИМО: не полагаемся только на текст кнопки (у людей разный язык
// интерфейса — ru/en/kz/ua/…). Логика в два шага:
//   1) широкий мультиязычный список слов «принять» (и список «отклонить», чтобы не нажать);
//   2) структурный фолбэк — нажать ГЛАВНУЮ (залитую цветом) кнопку, которая не «отклонить».
const ACCEPT_RX =
  /(accept|accetta|aceptar|aceitar|accepter|akzeptier|allow|consenti|permett|permitir|autoriser|zulassen|unhide|mostra|unblock|onayla|kabul|akcept|прийн|дозвол|принять|разреш|показать|разблок|қабыл|рұқсат|рұқсат бер)/i;
const DECLINE_RX =
  /(decline|delete|reject|block|remove|rifiuta|elimina|rechazar|recusar|refuser|ablehnen|löschen|supprimer|eliminar|engelle|reddet|sil|відхил|видалити|заблок|отклон|удалить|удали|жою|бас тарт)/i;
// «OK / Понятно / Продолжить» — кнопка инфо-окна «How message requests work»,
// которое всплывает ПОВЕРХ «Accept» и перехватывает клики (D.13 хендоффа).
const CONFIRM_RX =
  /^(ok|okay|got it|continue|next|confirm|done|conferma|continua|continuar|continuer|weiter|fortfahren|aceptar|entendido|понятно|продолжить|далее|хорошо|подтвердить|зрозуміло|продовжити|далі|tamam|anladım|devam|jatka|fortsätt|확인|계속|确定|继续|了解|わかりました|続行|түсінікті|жалғастыру)$/i;

function isFilled(el: HTMLElement): boolean {
  const bg = getComputedStyle(el).backgroundColor;
  return !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
}

function visibleButtons(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="button"], button')].filter((b) => {
    const t = (b.innerText || '').trim();
    return b.offsetParent !== null && t.length > 0 && t.length < 24; // видимая, короткая подпись
  });
}

// Диагностика: подписи видимых кнопок на экране (для точечной починки приёма в Скрытых/Запросах).
// Возвращает короткую строку «текст|aria|…» — попадает в живой журнал при сбое отправки.
function diagButtons(): string {
  return [...document.querySelectorAll<HTMLElement>('[role="button"], button')]
    .filter((b) => b.offsetParent !== null)
    .map((b) => ((b.innerText || '').trim() || b.getAttribute('aria-label') || '').replace(/\s+/g, ' '))
    .filter((t) => t && t.length < 30)
    .slice(0, 14)
    .join(' | ')
    .slice(0, 240);
}

// Закрыть всплывающее инфо-окно (OK/Понятно/Продолжить), если оно есть. Возвращает true, если кликнули.
// Сначала калиброванные подписи (под язык юзера), потом встроенные эвристики.
function clickConfirm(): boolean {
  const buttons = visibleButtons();
  if (runtimeCalib?.dismissLabels?.length) {
    const c = buttons.find((x) => hasLabel(x, runtimeCalib!.dismissLabels));
    if (c) { c.click(); return true; }
  }
  const b = buttons.find((x) => CONFIRM_RX.test((x.innerText || '').trim()));
  if (b) { b.click(); return true; }
  return false;
}

// Закрыть одноразовое окно-приветствие директа («Direct messages have arrived on
// web» / «Продолжить»/«Continue» на любом языке). ПОРТ dismissWelcome из рабочего
// bot.js: без него попап висит ПОВЕРХ списка чатов на фазах прогрева/сбора, сбор
// находит 0 и отбивка «молчит». Попап появляется с задержкой → пара попыток.
async function dismissWelcome(tries = 3): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (clickConfirm()) { await sleep(1200); return; }
    await sleep(700);
  }
}

// Нажать «Принять»: ПРИОРИТЕТ — калиброванные ИИ-подписи (Принять/Показать) под язык юзера,
// затем встроенные мультиязычные эвристики, затем фолбэк — главная залитая кнопка (не «отклонить»).
function clickAccept(): boolean {
  const buttons = visibleButtons();
  const isDecline = (b: HTMLElement) => DECLINE_RX.test(b.innerText) || hasLabel(b, runtimeCalib?.declineLabels);
  // 1) калиброванные подписи «Принять»/«Показать»
  if (runtimeCalib) {
    const t = buttons.find((b) => (hasLabel(b, runtimeCalib!.acceptLabels) || hasLabel(b, runtimeCalib!.unhideLabels)) && !isDecline(b));
    if (t) { t.click(); return true; }
  }
  // 2) встроенные эвристики
  let target = buttons.find((b) => ACCEPT_RX.test(b.innerText) && !isDecline(b));
  if (!target) target = buttons.find((b) => !isDecline(b) && !CONFIRM_RX.test(b.innerText) && isFilled(b));
  if (target) { target.click(); return true; }
  return false;
}

// На «Запросах»/«Скрытых» перед ответом нужно принять диалог. Порядок критичен
// (D.13 хендоффа): СНАЧАЛА закрыть инфо-окно «How message requests work» (OK),
// ПОТОМ нажать «Accept». Окна появляются с задержкой → пробуем в цикле. После
// приёма иногда всплывает ещё одно подтверждение — закрываем и его.
async function acceptRequestIfNeeded(): Promise<void> {
  // Критерий «принято» — появилось ПОЛЕ ВВОДА (а не факт клика). Так корректно
  // обрабатываются: инфо-окно «How message requests work» (OK перекрывает Accept) и
  // «Скрытые», где нужно ДВА шага: «Показать» → «Принять». Поэтому жмём в цикле,
  // пока поле не появится (или не выйдут попытки).
  for (let i = 0; i < 10; i++) {
    const input = document.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]');
    if (input && input.offsetParent !== null) return; // принято — можно отвечать
    clickConfirm(); // закрыть OK/инфо-окно, если перекрывает приём
    clickAccept(); // «Принять» / «Показать» (для «Скрытых» — первый шаг)
    await sleep(1300);
  }
  // Поле так и не появилось — sendReply ещё раз подождёт его и, если нет, вернёт false
  // (лид останется FAILED и попадёт в повторную попытку на следующем проходе).
}

async function sendReply(text: string): Promise<boolean> {
  try {
    // После «Принять» поле ввода отрисовывается НЕ сразу — ждём его появления до ~8 сек
    // (порт ожидания input.waitFor из bot.js). Без этого ответы в Запросах/Скрытых падали.
    let input: HTMLElement | null = null;
    for (let i = 0; i < 16; i++) {
      const inputs = document.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"]');
      input = inputs[inputs.length - 1] || null;
      if (input && input.offsetParent !== null) break; // видимое поле
      input = null;
      await sleep(500);
    }
    if (!input) return false;
    input.focus();
    document.execCommand('insertText', false, text);
    await sleep(500);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(1500);
    return true;
  } catch {
    return false;
  }
}

function navigate(path: string) {
  location.assign(BASE + path); // полная перезагрузка — состояние уже в storage
}

// Баннер «не закрывайте вкладку», пока идёт проход. beforeunload НЕ вешаем: автомат сам
// навигирует через location.assign, и страж ловил бы собственную навигацию бота. Случайное
// закрытие отлавливает background (tabs.onRemoved) и показывает уведомление в дашборде.
const BANNER_ID = 'th-work-banner';
async function showWorkBanner() {
  const { hideWorkBanner } = await chrome.storage.local.get('hideWorkBanner');
  if (hideWorkBanner) return;
  if (document.getElementById(BANNER_ID)) return;
  const bar = document.createElement('div');
  bar.id = BANNER_ID;
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#6d5cf6;color:#fff;' +
    'font:600 14px/1.4 system-ui,sans-serif;padding:10px 16px;display:flex;align-items:center;' +
    'justify-content:center;gap:12px;box-shadow:0 2px 12px rgba(0,0,0,.25)';
  const txt = document.createElement('span');
  txt.textContent = '🟣 ThreadHunt идёт по директу — не закрывайте эту вкладку, она закроется сама.';
  const hide = document.createElement('button');
  hide.textContent = 'Не показывать снова';
  hide.style.cssText = 'background:rgba(255,255,255,.22);color:#fff;border:0;border-radius:8px;padding:6px 10px;font:600 12px system-ui;cursor:pointer';
  hide.onclick = () => { void chrome.storage.local.set({ hideWorkBanner: true }); bar.remove(); };
  bar.append(txt, hide);
  (document.body || document.documentElement).appendChild(bar);
}
function hideWorkBannerNow() {
  document.getElementById(BANNER_ID)?.remove();
}

// ─────────────── Конечный автомат: один шаг на загрузку страницы ───────────────

// КРИТИЧНО: автомат не должен запускаться параллельно сам с собой. Шаги стали дольше
// (цикл приёма + ожидание поля ввода), и setInterval(step,30s) накладывался на ещё не
// завершённый проход → одному человеку уходило по 8 одинаковых сообщений. Этот флаг живёт
// в рамках одной загрузки страницы (после navigate страница перезагружается и он сбросится).
let stepRunning = false;
async function step() {
  if (stepRunning) return; // уже идёт шаг — не запускаем второй параллельно
  if (!location.pathname.startsWith('/messages')) return;
  stepRunning = true;
  try {
    await stepInner();
  } finally {
    stepRunning = false;
  }
}

async function stepInner() {
  // heartbeat всегда
  chrome.runtime.sendMessage({ type: 'heartbeat', threadsLoggedIn: isLoggedIn() });

  let sweep = await getSweep();

  // Баннер «не закрывайте вкладку» — показываем, пока идёт проход; убираем, когда нет.
  if (sweep) void showWorkBanner();
  else hideWorkBannerNow();

  // «Стоп» из дашборда: метка stopAt новее начала текущего прохода → прерываем и
  // закрываемся (finishSweep отчитается, сервер погасит stopAt, background закроет вкладку).
  if (sweep) {
    const t = (await chrome.runtime.sendMessage({ type: 'getTasks' })) as AgentTasksResponse | null;
    runtimeCalib = t?.calibration ?? runtimeCalib; // подхватить ИИ-калибровку кнопок
    const stopTs = t?.limits?.stopAt ? Date.parse(t.limits.stopAt) : 0;
    if (stopTs && stopTs >= sweep.startedAt) {
      serverLog('⏹ Остановлено вручную — проход прерван', 'warn');
      return finishSweep(sweep);
    }
  }

  // Нет активного обхода — может, пора начать новый?
  if (!sweep) {
    const tasks = (await chrome.runtime.sendMessage({ type: 'getTasks' })) as AgentTasksResponse | null;
    if (!tasks?.active || !tasks.searches.length) return;
    runtimeCalib = tasks.calibration ?? runtimeCalib; // подхватить ИИ-калибровку кнопок
    if (await getCalib()) return; // идёт калибровка разметки — проход не начинаем
    // Холостой тест отбивки из дашборда — приоритетнее обычного прохода.
    if (await maybeStartDmTest(tasks)) return;
    const lim = tasks.limits;
    const sections = activeSections(lim?.sections);
    const safe = !!lim?.safeMode; // безопасный режим: проходим и считаем, но не отправляем

    // «Прогон сейчас»: метка времени с сервера новее уже обработанной — запускаем
    // обход немедленно, минуя кулдаун и рабочие часы.
    const { [LAST_SWEEP_KEY]: last, lastRunNow } = await chrome.storage.session.get([LAST_SWEEP_KEY, 'lastRunNow']);
    const runNowTs = lim?.runNowAt ? Date.parse(lim.runNowAt) : 0;
    const isRunNow = !!runNowTs && runNowTs !== lastRunNow;

    if (!isRunNow) {
      // ЛИМИТЫ: вне рабочих часов — не начинаем. Дневной лимит важен только если
      // реально отправляем (в безопасном режиме можно проходить и при 0 остатке).
      if (lim && !withinWorkingHours(lim.workingHours)) return;
      if (lim && lim.repliesRemainingToday <= 0 && !safe) return;
      const cooldownMs = Math.max(30, lim?.sweepIntervalMinutes ?? 180) * 60_000;
      if (last && Date.now() - last < cooldownMs) return;
    }
    if (isRunNow) await chrome.storage.session.set({ lastRunNow: runNowTs });

    serverLog(safe ? '▶ Старт прохода (безопасный режим — без отправки)' : '▶ Старт прохода по директу');
    chrome.runtime.sendMessage({ type: 'pass-start' }); // статус «идёт проход» в дашборде
    sweep = {
      phase: 'warmup',
      startedAt: Date.now(),
      sectionIdx: 0,
      seenIds: [],
      chats: [],
      processIdx: 0,
      events: [],
      keywords: tasks.searches.flatMap((s) => s.keywords.map((k) => ({ ...k, searchId: s.searchId }))),
      replyBySearch: Object.fromEntries(tasks.searches.map((s) => [s.searchId, { templates: s.replyTemplates, rotation: s.rotation }])),
      obLinkBySearch: Object.fromEntries(tasks.searches.map((s) => [s.searchId, s.obLink])),
      repliedKeys: tasks.searches.flatMap((s) => s.alreadyReplied),
      minDelayMs: lim?.minDelayMs ?? 8000,
      maxDialogs: lim?.maxDialogs ?? 40,
      repliesLeft: lim?.repliesRemainingToday ?? 40,
      sent: 0,
      expectPath: '/messages/', // прогрев перед заходом в Запросы (D.10)
      guard: 0,
      sections,
      dryRun: safe, // безопасный режим = не отправляем
      reportPass: true, // реальный/безопасный проход — шлём статистику серверу
      scanned: 0,
    };
    await setSweep(sweep);
    navigate('/messages/');
    return;
  }

  // Прогрев: мы на /messages/ — теперь можно безопасно идти в Запросы (D.10).
  if (sweep.phase === 'warmup') {
    await sleep(2500);
    await dismissWelcome(); // закрыть welcome-попап, иначе он перекроет список (порт bot.js)
    sweep.phase = 'collect';
    sweep.sectionIdx = 0;
    sweep.expectPath = sweep.sections[0].url;
    sweep.guard = 0;
    await setSweep(sweep);
    navigate(sweep.sections[0].url);
    return;
  }

  // Защита: если пользователь сам куда-то ушёл — мягко вернёмся на ожидаемый путь
  // (ограниченное число раз), иначе бросим обход, чтобы не мешать человеку.
  if (!location.pathname.startsWith(sweep.expectPath.replace(/\/$/, '')) && sweep.guard < 3) {
    sweep.guard++;
    await setSweep(sweep);
    navigate(sweep.expectPath);
    return;
  }

  if (sweep.phase === 'collect') {
    const sec = sweep.sections[sweep.sectionIdx];
    await sleep(3500);
    await dismissWelcome(); // в каждой секции: welcome/инфо-попап перекрывает чаты (порт bot.js)
    serverLog('🔎 Смотрю раздел: ' + sectionRu(sec.label));
    await scrollList();
    const seen = new Set(sweep.seenIds);
    const repliedKeys = new Set(sweep.repliedKeys);
    for (const c of collectChats(sec.label)) {
      if (seen.has(c.id) || repliedKeys.has(c.id)) continue;
      seen.add(c.id);

      if (c.section !== 'main') {
        // Запросы/Скрытые: сообщение видно только в превью — матчим здесь, чат НЕ
        // открываем (D.12: до приёма сообщений в чате нет, плюс бережём лимит 429).
        sweep.scanned = (sweep.scanned || 0) + 1; // осмотрели превью
        const m = matchKeyword(c.preview, sweep.keywords);
        if (!m) continue; // незнакомец без кодового слова — пропускаем
        const kw = sweep.keywords.find((k) => k.text === m)!;
        c.matched = { keyword: m, searchId: kw.searchId, replyText: kw.replyText };
        if (sweep.dryRun) {
          // ТЕСТ: совпадение засчитано по превью — открывать/принимать не нужно.
          const tpl = pickReply(kw, sweep.replyBySearch);
          if (tpl)
            sweep.events.push({ searchId: kw.searchId, fromUserKey: c.id, fromUsername: c.name, matchedKeyword: m, templateId: tpl.id, sent: false, section: c.section, at: new Date().toISOString() });
          continue; // в список на открытие НЕ добавляем
        }
        if (sweep.chats.length >= sweep.maxDialogs) continue; // лимит открытий за проход
        sweep.chats.push(c); // реальный проход: откроем, чтобы принять и ответить
      } else {
        // Основной директ: нужно открыть чат, чтобы прочитать последнее сообщение и направление.
        if (sweep.chats.length >= sweep.maxDialogs) continue;
        sweep.chats.push(c);
      }
    }
    sweep.seenIds = [...seen];
    sweep.sectionIdx++;

    if (sweep.sectionIdx < sweep.sections.length) {
      sweep.expectPath = sweep.sections[sweep.sectionIdx].url;
      sweep.guard = 0;
      await setSweep(sweep);
      navigate(sweep.expectPath);
    } else {
      // собрали все разделы — переходим к обработке
      if (!sweep.chats.length) return finishSweep(sweep);
      sweep.phase = 'process';
      sweep.processIdx = 0;
      sweep.expectPath = sweep.chats[0].href;
      sweep.guard = 0;
      await setSweep(sweep);
      navigate(sweep.chats[0].href);
    }
    return;
  }

  if (sweep.phase === 'process') {
    const chat = sweep.chats[sweep.processIdx];
    await sleep(2500);

    // КРИТИЧНО (анти-дубль): помечаем чат «обработан» и ПЕРСИСТИМ ДО медленного приёма/
    // отправки. Повторный заход step() или перезагрузка увидит метку и НЕ отправит снова —
    // иначе одному человеку уходило по 8 одинаковых сообщений.
    if (!sweep.attempted) sweep.attempted = [];
    const alreadyAttempted = sweep.attempted.includes(chat.id);
    if (!alreadyAttempted) {
      sweep.attempted.push(chat.id);
      await setSweep(sweep);
    }

    if (!alreadyAttempted && chat.section !== 'main' && chat.matched) {
      // Запрос/Скрытый, уже совпавший по превью на сборе (в тесте их тут нет —
      // они засчитаны без открытия). Реальный проход: принять диалог и ответить.
      const kw = chat.matched;
      const tpl = pickReply(kw, sweep.replyBySearch);
      if (tpl) {
        await acceptRequestIfNeeded(); // закрыть OK-окно → Accept → пост-подтверждение (D.13)
        const sent = await sendReply(withObLink(tpl.text, sweep.obLinkBySearch[kw.searchId], chat.id));
        if (sent) sweep.sent++;
        if (sent) serverLog('✅ Ответил @' + (chat.name || '—') + ' на «' + kw.keyword + '»', 'reply');
        else serverLog('⚠️ Не смог @' + (chat.name || '—') + ' (' + sectionRu(chat.section) + '). Кнопки на экране: ' + diagButtons(), 'warn');
        // Вступительное сообщение = превью без ведущего имени (что кандидат написал).
        const introMsg = chat.preview && chat.name && chat.preview.startsWith(chat.name) ? chat.preview.slice(chat.name.length).trim() : chat.preview;
        const ev: AgentReplyEvent = {
          searchId: kw.searchId,
          fromUserKey: chat.id,
          fromUsername: chat.name,
          matchedKeyword: kw.keyword,
          templateId: tpl.id,
          sent,
          section: chat.section,
          message: introMsg,
          at: new Date().toISOString(),
        };
        sweep.events.push(ev);
        chrome.runtime.sendMessage({ type: 'events', events: [ev] }); // шлём лид СРАЗУ — не теряем, если проход прервётся/вкладку закроют
        await sleep(sweep.minDelayMs); // анти-бан пауза
        if (sweep.sent >= sweep.repliesLeft) return finishSweep(sweep);
      }
    } else if (!alreadyAttempted) {
      // Основной директ: открыть, прочитать последнее сообщение, проверить направление.
      sweep.scanned = (sweep.scanned || 0) + 1;
      await dismissWelcome(); // welcome-попап перекрывает и поле ввода, и сообщения (порт bot.js)
      const last = readLastMessage(false);
      if (last && last.incoming) {
        const matched = matchKeyword(last.text, sweep.keywords);
        if (matched) {
          const kw = sweep.keywords.find((k) => k.text === matched)!;
          const tpl = pickReply(kw, sweep.replyBySearch);
          if (tpl) {
            let sent = false;
            if (!sweep.dryRun) {
              sent = await sendReply(withObLink(tpl.text, sweep.obLinkBySearch[kw.searchId], chat.id));
              if (sent) sweep.sent++;
              if (sent) serverLog('✅ Ответил @' + (chat.name || '—') + ' на «' + matched + '»', 'reply');
              else serverLog('⚠️ Не смог ответить @' + (chat.name || '—') + ' — поле ввода не открылось', 'warn');
            }
            const ev: AgentReplyEvent = {
              searchId: kw.searchId,
              fromUserKey: chat.id,
              fromUsername: chat.name,
              matchedKeyword: matched,
              templateId: tpl.id,
              sent,
              section: chat.section,
              message: last.text, // полное входящее сообщение кандидата
              at: new Date().toISOString(),
            };
            sweep.events.push(ev);
            if (!sweep.dryRun) chrome.runtime.sendMessage({ type: 'events', events: [ev] }); // лид сразу (в тесте — нет)
            if (!sweep.dryRun) {
              await sleep(sweep.minDelayMs); // анти-бан пауза
              if (sweep.sent >= sweep.repliesLeft) return finishSweep(sweep);
            }
          }
        }
      }
    }

    sweep.processIdx++;
    if (sweep.processIdx < sweep.chats.length) {
      sweep.expectPath = sweep.chats[sweep.processIdx].href;
      sweep.guard = 0;
      await setSweep(sweep);
      navigate(sweep.chats[sweep.processIdx].href);
    } else {
      finishSweep(sweep);
    }
    return;
  }
}

async function finishSweep(sweep: Sweep) {
  serverLog(`■ Проход завершён: осмотрено ${sweep.scanned || 0}, совпадений ${sweep.events.length}, ответов ${sweep.sent || 0}`);
  // Холостой тест из дашборда: шлём результат серверу, ничего больше.
  if (sweep.serverTest) {
    chrome.runtime.sendMessage({ type: 'testResult', scanned: sweep.scanned || 0, matched: sweep.events.length });
    await chrome.storage.session.set({ [LAST_SWEEP_KEY]: Date.now() });
    await setSweep(null);
    return;
  }
  if (!sweep.dryRun) {
    // Реальный проход: создаём лиды (события) на сервере.
    if (sweep.events.length) chrome.runtime.sendMessage({ type: 'events', events: sweep.events });
  } else if (!sweep.reportPass) {
    // ТЕСТ из popup: ничего на сервер, только сводка для popup.
    await chrome.storage.local.set({
      [TEST_RESULT_KEY]: { scanned: sweep.scanned || 0, matched: sweep.events.length, at: new Date().toISOString(), done: true },
    });
  }
  // Реальный и безопасный проходы шлют статистику серверу (для карточки/хронологии).
  if (sweep.reportPass) {
    chrome.runtime.sendMessage({
      type: 'pass',
      report: {
        scanned: sweep.scanned || 0,
        sent: sweep.sent || 0,
        matched: sweep.events.length,
        sections: sweep.sections.map((s) => s.label).join(','),
        dryRun: !!sweep.dryRun,
      },
    });
  }
  await chrome.storage.session.set({ [LAST_SWEEP_KEY]: Date.now() });
  await setSweep(null);
}

// Запустить ТЕСТОВЫЙ проход (dry-run): осматриваем директ и ищем совпадения по кодовым
// словам, но НИЧЕГО не принимаем и не отправляем. Игнорируем cooldown и дневные лимиты.
async function startTestSweep(): Promise<{ ok: boolean; reason?: string }> {
  if (!location.pathname.startsWith('/messages')) return { ok: false, reason: 'not_messages' };
  if (await getSweep()) return { ok: false, reason: 'busy' };
  const tasks = (await chrome.runtime.sendMessage({ type: 'getTasks' })) as AgentTasksResponse | null;
  const searches = tasks?.searches || [];
  const keywords = searches.flatMap((s) => s.keywords.map((k) => ({ ...k, searchId: s.searchId })));
  if (!keywords.length) return { ok: false, reason: 'no_keywords' };

  await chrome.storage.local.set({ [TEST_RESULT_KEY]: { scanned: 0, matched: 0, at: new Date().toISOString(), done: false } });
  const sweep: Sweep = {
    phase: 'warmup',
    startedAt: Date.now(),
    sectionIdx: 0,
    seenIds: [],
    chats: [],
    processIdx: 0,
    events: [],
    keywords,
    replyBySearch: Object.fromEntries(searches.map((s) => [s.searchId, { templates: s.replyTemplates, rotation: s.rotation }])),
    obLinkBySearch: Object.fromEntries(searches.map((s) => [s.searchId, s.obLink])),
    repliedKeys: [], // в тесте смотрим всех, даже тех, кому уже отвечали
    minDelayMs: 0,
    maxDialogs: tasks?.limits?.maxDialogs ?? 40,
    repliesLeft: 0,
    sent: 0,
    expectPath: '/messages/', // прогрев перед Запросами (D.10)
    guard: 0,
    dryRun: true,
    reportPass: false, // тест из popup: статистику на сервер НЕ шлём
    sections: activeSections(tasks?.limits?.sections),
    scanned: 0,
  };
  await setSweep(sweep);
  navigate('/messages/'); // прогрев, дальше автомат сам пойдёт в Запросы
  return { ok: true };
}

// Холостой тест отбивки, запрошенный из ДАШБОРДА (tasks.dmTestAt). Прогоняет
// директ как dry-run (читает, считает совпадения), НИЧЕГО не отправляя и не
// принимая, и шлёт результат серверу. Возвращает true, если тест обработан/запущен.
async function maybeStartDmTest(tasks: AgentTasksResponse): Promise<boolean> {
  if (!tasks.dmTestAt) return false;
  const ts = Date.parse(tasks.dmTestAt);
  if (!ts) return false;
  const { lastDmTest } = await chrome.storage.session.get('lastDmTest');
  if (ts === lastDmTest) return false;
  await chrome.storage.session.set({ lastDmTest: ts });
  const keywords = tasks.searches.flatMap((s) => s.keywords.map((k) => ({ ...k, searchId: s.searchId })));
  if (!keywords.length) {
    chrome.runtime.sendMessage({ type: 'testResult', scanned: 0, matched: 0 });
    return true;
  }
  const sweep: Sweep = {
    phase: 'warmup',
    startedAt: Date.now(),
    sectionIdx: 0,
    seenIds: [],
    chats: [],
    processIdx: 0,
    events: [],
    keywords,
    replyBySearch: Object.fromEntries(tasks.searches.map((s) => [s.searchId, { templates: s.replyTemplates, rotation: s.rotation }])),
    obLinkBySearch: Object.fromEntries(tasks.searches.map((s) => [s.searchId, s.obLink])),
    repliedKeys: [],
    minDelayMs: 0,
    maxDialogs: tasks.limits?.maxDialogs ?? 40,
    repliesLeft: 0,
    sent: 0,
    expectPath: '/messages/',
    guard: 0,
    dryRun: true,
    reportPass: false,
    sections: activeSections(tasks.limits?.sections),
    scanned: 0,
    serverTest: true,
  };
  await setSweep(sweep);
  navigate('/messages/');
  return true;
}

// Тест-проход запускается из popup сообщением startTest.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'startTest') {
    startTestSweep().then(sendResponse);
    return true; // async response
  }
});

// ───────────── Research: сбор топовых вакансий-веток из поиска Threads ─────────────
// Отдельный лёгкий поток, НЕ мешает отбивке: когда мы на /messages и DM-проход не идёт,
// по расписанию обходим поиск Threads по запросам (названия ролей), собираем посты с
// вовлечённостью и шлём на сервер. Селекторы — best-effort (вёрстка Threads меняется —
// чинить здесь). Источник «насмотренности» для генерации постов в дашборде.
const RESEARCH_KEY = 'research';
const LAST_RESEARCH_KEY = 'lastResearchAt';

type ResearchState = { queue: { searchId: string; query: string }[]; idx: number; maxPerQuery: number; collected?: number };

function searchUrl(q: string): string {
  return `/search?q=${encodeURIComponent(q)}&serp_type=default`;
}
async function getResearch(): Promise<ResearchState | null> {
  const s = await chrome.storage.session.get(RESEARCH_KEY);
  return (s[RESEARCH_KEY] as ResearchState) || null;
}
// «1.2K» / «3,4 тыс» → число (грубая эвристика).
function parseCount(s: string): number {
  const m = s.replace(/ /g, ' ').match(/([\d][\d.,]*)([KkКкMmМм])?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/\s/g, '').replace(',', '.')) || 0;
  const suf = (m[2] || '').toLowerCase();
  if (suf === 'k' || suf === 'к') n *= 1000;
  if (suf === 'm' || suf === 'м') n *= 1_000_000;
  return Math.round(n);
}

// Диагностика выдачи — счётчики разных селекторов, чтобы понять вёрстку Threads,
// если сбор вернул 0. Уходит на сервер и показывается в панели.
function searchDiag(query: string, collected: number) {
  const sample = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]')].slice(0, 3).map((a) => a.getAttribute('href') || '');
  // HTML-образец реальной вёрстки: контейнер вокруг первой ссылки на пост (или кусок
  // основной области) — по нему пишем точные селекторы, без догадок.
  let htmlSample = '';
  let buttons: { label: string; text: string; next: string }[] = [];
  try {
    const firstLink = document.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
    let node: HTMLElement | null = firstLink;
    if (node) for (let i = 0; i < 10 && node.parentElement; i++) node = node.parentElement;
    const el = node || document.querySelector('main') || document.body;
    htmlSample = (el?.outerHTML || '').replace(/\s+/g, ' ').slice(0, 12000); // больше — чтобы попала панель действий (лайки/комменты)
    // Дамп svg-кнопок первого поста: aria-label + текст + сосед — видно, где лежит счётчик.
    if (node) {
      buttons = [...node.querySelectorAll<HTMLElement>('[role="button"]')]
        .filter((b) => b.querySelector('svg'))
        .slice(0, 10)
        .map((b) => {
          const svg = b.querySelector('svg');
          const label = svg?.getAttribute('aria-label') || b.getAttribute('aria-label') || svg?.querySelector('title')?.textContent || '';
          return {
            label: label.slice(0, 40),
            text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
            next: (b.nextElementSibling?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
          };
        });
    }
  } catch {
    /* ignore */
  }
  let ext = '';
  try {
    ext = chrome.runtime.getManifest().version;
  } catch {
    /* ignore */
  }
  return {
    q: query,
    ext,
    url: location.pathname + location.search,
    postLinks: document.querySelectorAll('a[href*="/post/"]').length,
    userPostLinks: document.querySelectorAll('a[href*="/@"][href*="/post/"]').length,
    pressable: document.querySelectorAll('[data-pressable-container="true"]').length,
    articles: document.querySelectorAll('article,[role="article"]').length,
    anchors: document.querySelectorAll('a').length,
    bodyLen: (document.body?.innerText || '').length,
    sample,
    buttons,
    htmlSample,
    collected,
  };
}

// Вовлечённость поста — ЯЗЫКО-НЕЗАВИСИМО (Threads бывает на любом языке: «Mi piace»,
// «Segui» и т.п.). Берём числа у кнопок-действий по порядку: лайки, комменты, репосты.
function extractMetrics(container: HTMLElement): { likes: number; replies: number; reposts: number } {
  // Определяем кнопку по НАЗВАНИЮ действия (а не по позиции — иначе лишняя кнопка вроде
  // счётчика подписчиков сдвигает всё). Поддержка основных языков Threads.
  // Счётчик — элемент с ЧИСТО числовым текстом («55»/«1.2K»), не «26 min» из текста.
  const isPureNum = (t: string): boolean => /^[\d][\d.,]*[KkКкMmМм]?$/.test(t.trim());
  const deepNum = (el: Element | null): number => {
    if (!el) return 0;
    const own = (el.textContent || '').trim();
    if (isPureNum(own)) return parseCount(own);
    for (const c of el.querySelectorAll('*')) {
      const t = (c.textContent || '').trim();
      if (t && isPureNum(t)) return parseCount(t);
    }
    return 0;
  };
  const readCount = (b: HTMLElement): number => {
    let n = deepNum(b);
    if (!n) {
      let s: Element | null = b.nextElementSibling;
      for (let i = 0; i < 2 && s && !n; i++) {
        n = deepNum(s);
        s = s.nextElementSibling;
      }
    }
    return n;
  };
  const RE_LIKE = /mi piace|\blike\b|нрав|me gusta|j.?aime|gefällt|gosto|curtir|beğen/i;
  const RE_REPLY = /rispondi|commenta|\brepl|comment|ответ|коммент|responder|répondre|antworten|comentar|yanıtla/i;
  const RE_REPOST = /ripubblica|repost|репост|reblog|reenviar|teilen/i;
  let likes = 0, replies = 0, reposts = 0;
  for (const b of container.querySelectorAll<HTMLElement>('[role="button"]')) {
    const svg = b.querySelector('svg');
    if (!svg) continue;
    const label = (svg.getAttribute('aria-label') || b.getAttribute('aria-label') || svg.querySelector('title')?.textContent || '').toLowerCase();
    if (!label) continue;
    if (RE_LIKE.test(label)) { const c = readCount(b); if (c) likes = c; }
    else if (RE_REPLY.test(label)) { const c = readCount(b); if (c) replies = c; }
    else if (RE_REPOST.test(label)) { const c = readCount(b); if (c) reposts = c; }
  }
  return { likes, replies, reposts };
}

// Дата публикации поста — из <time datetime="…"> (для окна «лучшее за неделю/месяц»).
function postedAtOf(container: HTMLElement): string | undefined {
  const dt = container.querySelector('time')?.getAttribute('datetime');
  return dt || undefined;
}

// Собрать посты со страницы результатов поиска (multi-strategy, best-effort).
function collectSearchPosts(cur: { searchId: string; query: string }, max: number) {
  const out: any[] = [];
  const seen = new Set<string>();
  // Кандидаты-контейнеры постов: сначала pressable-контейнеры Threads, потом
  // article/role=article, в конце — родители ссылок на пост (fallback).
  let containers: HTMLElement[] = [...document.querySelectorAll<HTMLElement>('[data-pressable-container="true"], article, [role="article"]')];
  if (!containers.length) {
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]')];
    containers = anchors
      .map((a) => {
        let c: HTMLElement | null = a;
        for (let i = 0; i < 10 && c; i++) c = c.parentElement;
        return c;
      })
      .filter((c): c is HTMLElement => !!c);
  }
  for (const container of containers) {
    const link = container.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
    if (!link) continue;
    const href = link.getAttribute('href') || '';
    const m = href.match(/\/post\/([A-Za-z0-9_-]+)/);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const author = (href.match(/\/@([\w.]+)/) || [])[1] || undefined;
    let text = (container.innerText || '').replace(/\s+/g, ' ').trim();
    // Чистим текст: убираем ведущий «ник дата» и хвост кнопки перевода со счётчиками.
    if (author) text = text.replace(new RegExp('^' + author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim();
    text = text.replace(/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/, '').trim(); // ведущая дата dd/mm/yyyy
    text = text.replace(/\b(Traduci|Translate|Перевести|Traducir|Übersetzen|Traduire)\b[\s\d.,KkМмMm]*$/i, '').trim(); // хвост «перевод + числа»
    if (text.length < 10) continue;
    const { likes, replies, reposts } = extractMetrics(container);
    const postedAt = postedAtOf(container);
    out.push({ searchId: cur.searchId, query: cur.query, threadsPostId: id, author, text: text.slice(0, 1200), permalink: BASE + href.split('?')[0], likes, replies, reposts, postedAt });
    if (out.length >= max) break;
  }
  return out;
}

async function researchTick() {
  // На странице поиска — собираем и переходим к следующему запросу.
  if (location.pathname.startsWith('/search')) {
    const st = await getResearch();
    if (!st || st.idx >= st.queue.length) return;
    const cur = st.queue[st.idx];
    await sleep(4000); // дать выдаче отрисоваться
    await scrollList(8); // подгрузить больше постов (виртуализированный список)
    const posts = collectSearchPosts(cur, st.maxPerQuery);
    const diag = searchDiag(cur.query, posts.length);
    // Копируемый вывод в консоль (deploy-независимо): счётчики и HTML-образец отдельно.
    console.log(
      `%c[threadhunt] research «${cur.query}» → собрано ${posts.length}`,
      'color:#6d5cf6;font-weight:bold',
      `\nURL: ${diag.url}\nссылок-на-пост: ${diag.postLinks} | @-пост: ${diag.userPostLinks} | pressable: ${diag.pressable} | article: ${diag.articles} | всего-ссылок: ${diag.anchors} | текст: ${diag.bodyLen}`,
    );
    console.log('[threadhunt] примеры ссылок:', diag.sample);
    console.log('[threadhunt] HTML-образец (скопируй и пришли):\n', diag.htmlSample);
    // Шлём ВСЕГДА (даже 0 постов) — с диагностикой вёрстки, чтобы было видно, почему пусто.
    chrome.runtime.sendMessage({ type: 'research', posts, diag });
    st.collected = (st.collected || 0) + posts.length;
    st.idx++;
    if (st.idx < st.queue.length) {
      await chrome.storage.session.set({ [RESEARCH_KEY]: st });
      navigate(searchUrl(st.queue[st.idx].query));
    } else {
      const total = st.collected || 0;
      await chrome.storage.session.remove(RESEARCH_KEY);
      await chrome.storage.session.set({ [LAST_RESEARCH_KEY]: Date.now() });
      // Завершение: гасит «идёт сбор» на сервере даже при 0. Вкладку закроет background;
      // НЕ уходим на /messages, чтобы было видно, что мы реально были в поиске.
      chrome.runtime.sendMessage({ type: 'researchDone', total });
      console.log('[threadhunt] research завершён, всего собрано', total);
    }
    return;
  }
  if (!location.pathname.startsWith('/messages')) return;
  const existing = await getResearch();
  if (existing) {
    // research начат, но мы не на /search (навигация прервалась) — возобновим сбор.
    if (existing.idx < existing.queue.length) navigate(searchUrl(existing.queue[existing.idx].query));
    return;
  }
  if (await getSweep()) return; // идёт отбивка — не мешаем
  const tasks = (await chrome.runtime.sendMessage({ type: 'getTasks' })) as AgentTasksResponse | null;
  const r = tasks?.research;
  if (!r?.enabled || !r.queries?.length) return;
  // «Собрать сейчас» из дашборда — обходит 12-часовой кулдаун.
  const runAtTs = r.runAt ? Date.parse(r.runAt) : 0;
  const { [LAST_RESEARCH_KEY]: last, lastResearchRunNow } = await chrome.storage.session.get([LAST_RESEARCH_KEY, 'lastResearchRunNow']);
  const isRunNow = !!runAtTs && runAtTs !== lastResearchRunNow;
  if (!isRunNow && last && Date.now() - last < Math.max(60, r.intervalMinutes || 720) * 60_000) return;
  if (isRunNow) await chrome.storage.session.set({ lastResearchRunNow: runAtTs });
  const state: ResearchState = { queue: r.queries.slice(0, 12), idx: 0, maxPerQuery: r.maxPerQuery || 15 };
  await chrome.storage.session.set({ [RESEARCH_KEY]: state });
  navigate(searchUrl(state.queue[0].query));
}

// Наблюдатель за запросом холостого теста из дашборда. Работает на ЛЮБОЙ странице
// threads.com (не только /messages), чтобы тест стартовал, даже если открыта главная
// лента — content-script сам перейдёт в /messages для прогона.
async function dmTestWatcher() {
  if (await getSweep()) return; // проход уже идёт (в т.ч. тест)
  const tasks = (await chrome.runtime.sendMessage({ type: 'getTasks' })) as AgentTasksResponse | null;
  if (tasks) await maybeStartDmTest(tasks);
}

// ───────────── ИИ-калибровка разметки: этап 1 (браузер/язык), этап 2 (снятие кнопок) ─────────────
// Расширение открывает один экран запроса, снимает ВИДИМЫЕ кнопки (без текста переписки) и шлёт
// на сервер → Claude определяет, какая «Принять»/«Показать»/«OK»/«Отклонить» под язык юзера.
const CALIB_KEY = 'calib';
type CalibState = { phase: 'list' | 'capture' };

function detectBrowser(): string {
  const ua = navigator.userAgent;
  const brands = ((navigator as any).userAgentData?.brands || []).map((x: any) => x.brand).join(' ');
  if (/YaBrowser/i.test(ua)) return 'Yandex';
  if (/OPR|Opera/i.test(ua) || /Opera/i.test(brands)) return 'Opera';
  if (/Edg/i.test(ua)) return 'Edge';
  if (/Brave/i.test(brands) || (navigator as any).brave) return 'Brave';
  if (/Arc/i.test(ua)) return 'Arc';
  if (/Chrome/i.test(ua)) return 'Chrome';
  return 'Chromium';
}
function uiLang(): string {
  return (document.documentElement.lang || navigator.language || '').slice(0, 12);
}
// Снять видимые кнопки экрана (текст/aria/role/залитость) — БЕЗ текста переписки.
function captureControls(): { text?: string; aria?: string; role?: string; filled?: boolean }[] {
  return [...document.querySelectorAll<HTMLElement>('[role="button"], button')]
    .filter((b) => b.offsetParent !== null)
    .map((b) => ({
      text: (b.innerText || '').trim().slice(0, 40),
      aria: (b.getAttribute('aria-label') || b.querySelector('svg')?.getAttribute('aria-label') || '').slice(0, 40),
      role: b.getAttribute('role') || b.tagName.toLowerCase(),
      filled: isFilled(b),
    }))
    .filter((c) => (c.text && c.text.length < 30) || c.aria)
    .slice(0, 40);
}
async function getCalib(): Promise<CalibState | null> {
  const s = await chrome.storage.session.get(CALIB_KEY);
  return (s[CALIB_KEY] as CalibState) || null;
}
async function setCalib(v: CalibState | null) {
  if (v) await chrome.storage.session.set({ [CALIB_KEY]: v });
  else await chrome.storage.session.remove(CALIB_KEY);
}
function sendCalibration() {
  chrome.runtime.sendMessage({ type: 'calibrate', browser: detectBrowser(), lang: uiLang(), controls: captureControls() });
}
async function calibrationStep() {
  if (!location.pathname.startsWith('/messages')) return;
  const calib = await getCalib();
  if (!calib) return;
  if (await getSweep()) return; // идёт проход — калибровку отложим

  if (calib.phase === 'list') {
    await sleep(3000);
    await dismissWelcome();
    await scrollList(1);
    // Берём первый чат «Запросов» (там есть кнопка приёма) — его и снимем (НЕ принимая).
    const chats = collectChats('requests');
    if (!chats.length) {
      serverLog('🎯 Калибровка: нет открытых запросов — снимаю с текущего экрана', 'info');
      sendCalibration();
      await setCalib(null);
      return;
    }
    await setCalib({ phase: 'capture' });
    navigate(chats[0].href);
    return;
  }
  if (calib.phase === 'capture') {
    await sleep(3500);
    sendCalibration(); // только читаем кнопки экрана запроса, НЕ принимаем
    serverLog('🎯 Калибровка: снял кнопки экрана запроса, отправил на ИИ', 'info');
    await setCalib(null);
    return;
  }
}

// Запуск шага после загрузки страницы (+ периодически на случай, если юзер «припарковался»).
void step();
setInterval(() => void step(), 30_000);
void researchTick();
setInterval(() => void researchTick(), 60_000);
void dmTestWatcher();
setInterval(() => void dmTestWatcher(), 20_000);
void calibrationStep();
setInterval(() => void calibrationStep(), 15_000);
