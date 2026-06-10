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
        const sent = await sendReply(tpl.text);
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
              sent = await sendReply(tpl.text);
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

// Тест-проход запускается из popup сообщением startTest.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'startTest') {
    startTestSweep().then(sendResponse);
    return true; // async response
  }
});

// Запуск шага после загрузки страницы (+ периодически на случай, если юзер «припарковался»).
void step();
setInterval(() => void step(), 30_000);
