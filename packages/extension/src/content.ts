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

import { matchKeyword, type AgentTasksResponse, type AgentReplyEvent, type Keyword } from '@threadhunt/shared';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE = location.origin; // www.threads.com или www.threads.net

// Какой ответ слать: персональный текст под совпавшее слово (replyText) или, если
// его нет — общий шаблон поиска. Для персонального id нет → событие уйдёт без
// templateId (в БД replyTemplateId = null, FK не нарушается).
function pickReply(
  kw: { searchId: string; replyText?: string },
  replyBySearch: Record<string, { id: string; text: string } | undefined>,
): { id?: string; text: string } | null {
  if (kw.replyText && kw.replyText.trim()) return { text: kw.replyText.trim() };
  const tpl = replyBySearch[kw.searchId];
  return tpl ? { id: tpl.id, text: tpl.text } : null;
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
  sectionIdx: number;
  seenIds: string[];
  chats: Chat[];
  processIdx: number;
  events: AgentReplyEvent[];
  // правила, снятые на старте прохода (чтобы не зависеть от обновления tasks в середине)
  keywords: (Keyword & { searchId: string })[];
  replyBySearch: Record<string, { id: string; text: string } | undefined>;
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

// Закрыть всплывающее инфо-окно (OK/Понятно/Продолжить), если оно есть. Возвращает true, если кликнули.
function clickConfirm(): boolean {
  const b = visibleButtons().find((x) => CONFIRM_RX.test((x.innerText || '').trim()));
  if (b) { b.click(); return true; }
  return false;
}

// Нажать «Принять»: по словам (не «отклонить») или фолбэк — главная залитая кнопка.
function clickAccept(): boolean {
  const buttons = visibleButtons();
  let target = buttons.find((b) => ACCEPT_RX.test(b.innerText) && !DECLINE_RX.test(b.innerText));
  if (!target) target = buttons.find((b) => !DECLINE_RX.test(b.innerText) && !CONFIRM_RX.test(b.innerText) && isFilled(b));
  if (target) { target.click(); return true; }
  return false;
}

// На «Запросах»/«Скрытых» перед ответом нужно принять диалог. Порядок критичен
// (D.13 хендоффа): СНАЧАЛА закрыть инфо-окно «How message requests work» (OK),
// ПОТОМ нажать «Accept». Окна появляются с задержкой → пробуем в цикле. После
// приёма иногда всплывает ещё одно подтверждение — закрываем и его.
async function acceptRequestIfNeeded(): Promise<void> {
  let accepted = false;
  for (let i = 0; i < 8 && !accepted; i++) {
    clickConfirm(); // закрыть OK-окно, если перекрывает
    if (clickAccept()) accepted = true;
    else await sleep(1100);
  }
  if (accepted) {
    await sleep(1400);
    clickConfirm(); // пост-приёмное подтверждение, если есть
    await sleep(1600);
  }
  // Если принять не удалось — попробуем ответить как есть (в части языков/версий
  // приём не требуется). При поломке вёрстки чинить здесь (см. хендофф D.13).
}

async function sendReply(text: string): Promise<boolean> {
  try {
    const inputs = document.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"]');
    const input = inputs[inputs.length - 1];
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

// ─────────────── Конечный автомат: один шаг на загрузку страницы ───────────────

async function step() {
  if (!location.pathname.startsWith('/messages')) return;

  // heartbeat всегда
  chrome.runtime.sendMessage({ type: 'heartbeat', threadsLoggedIn: isLoggedIn() });

  let sweep = await getSweep();

  // Нет активного обхода — может, пора начать новый?
  if (!sweep) {
    const tasks = (await chrome.runtime.sendMessage({ type: 'getTasks' })) as AgentTasksResponse | null;
    if (!tasks?.active || !tasks.searches.length) return;
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

    sweep = {
      phase: 'warmup',
      sectionIdx: 0,
      seenIds: [],
      chats: [],
      processIdx: 0,
      events: [],
      keywords: tasks.searches.flatMap((s) => s.keywords.map((k) => ({ ...k, searchId: s.searchId }))),
      replyBySearch: Object.fromEntries(tasks.searches.map((s) => [s.searchId, s.replyTemplates[0]])),
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

    if (chat.section !== 'main' && chat.matched) {
      // Запрос/Скрытый, уже совпавший по превью на сборе (в тесте их тут нет —
      // они засчитаны без открытия). Реальный проход: принять диалог и ответить.
      const kw = chat.matched;
      const tpl = pickReply(kw, sweep.replyBySearch);
      if (tpl) {
        await acceptRequestIfNeeded(); // закрыть OK-окно → Accept → пост-подтверждение (D.13)
        const sent = await sendReply(withObLink(tpl.text, sweep.obLinkBySearch[kw.searchId], chat.id));
        if (sent) sweep.sent++;
        sweep.events.push({
          searchId: kw.searchId,
          fromUserKey: chat.id,
          fromUsername: chat.name,
          matchedKeyword: kw.keyword,
          templateId: tpl.id,
          sent,
          section: chat.section,
          at: new Date().toISOString(),
        });
        await sleep(sweep.minDelayMs); // анти-бан пауза
        if (sweep.sent >= sweep.repliesLeft) return finishSweep(sweep);
      }
    } else {
      // Основной директ: открыть, прочитать последнее сообщение, проверить направление.
      sweep.scanned = (sweep.scanned || 0) + 1;
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
            }
            sweep.events.push({
              searchId: kw.searchId,
              fromUserKey: chat.id,
              fromUsername: chat.name,
              matchedKeyword: matched,
              templateId: tpl.id,
              sent,
              section: chat.section,
              at: new Date().toISOString(),
            });
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
    sectionIdx: 0,
    seenIds: [],
    chats: [],
    processIdx: 0,
    events: [],
    keywords,
    replyBySearch: Object.fromEntries(searches.map((s) => [s.searchId, s.replyTemplates[0]])),
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
    sectionIdx: 0,
    seenIds: [],
    chats: [],
    processIdx: 0,
    events: [],
    keywords,
    replyBySearch: Object.fromEntries(tasks.searches.map((s) => [s.searchId, s.replyTemplates[0]])),
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
  const m = s.replace(/ /g, ' ').match(/([\d][\d.,]*)\s*([KkКкMmМм]?)/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/\s/g, '').replace(',', '.')) || 0;
  const suf = m[2].toLowerCase();
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
  try {
    const firstLink = document.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
    let node: HTMLElement | null = firstLink;
    if (node) for (let i = 0; i < 10 && node.parentElement; i++) node = node.parentElement;
    const el = node || document.querySelector('main') || document.body;
    htmlSample = (el?.outerHTML || '').replace(/\s+/g, ' ').slice(0, 12000); // больше — чтобы попала панель действий (лайки/комменты)
  } catch {
    /* ignore */
  }
  return {
    q: query,
    url: location.pathname + location.search,
    postLinks: document.querySelectorAll('a[href*="/post/"]').length,
    userPostLinks: document.querySelectorAll('a[href*="/@"][href*="/post/"]').length,
    pressable: document.querySelectorAll('[data-pressable-container="true"]').length,
    articles: document.querySelectorAll('article,[role="article"]').length,
    anchors: document.querySelectorAll('a').length,
    bodyLen: (document.body?.innerText || '').length,
    sample,
    htmlSample,
    collected,
  };
}

// Вовлечённость поста — ЯЗЫКО-НЕЗАВИСИМО (Threads бывает на любом языке: «Mi piace»,
// «Segui» и т.п.). Берём числа у кнопок-действий по порядку: лайки, комменты, репосты.
function extractMetrics(container: HTMLElement): { likes: number; replies: number; reposts: number } {
  const vals: number[] = [];
  for (const b of container.querySelectorAll<HTMLElement>('[role="button"]')) {
    if (!b.querySelector('svg')) continue; // кнопки действий содержат иконку
    const cand = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''} ${b.nextElementSibling?.textContent || ''}`;
    const n = parseCount(cand);
    if (n > 0) vals.push(n); // кнопка «подписаться» без числа пропускается
  }
  const [likes = 0, replies = 0, reposts = 0] = vals;
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
    const text = (container.innerText || '').replace(/\s+/g, ' ').trim();
    if (text.length < 10) continue;
    const author = (href.match(/\/@([\w.]+)/) || [])[1] || undefined;
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

// Запуск шага после загрузки страницы (+ периодически на случай, если юзер «припарковался»).
void step();
setInterval(() => void step(), 30_000);
void researchTick();
setInterval(() => void researchTick(), 60_000);
void dmTestWatcher();
setInterval(() => void dmTestWatcher(), 20_000);
