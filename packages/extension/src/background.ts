// Background service worker расширения Threadhunt.
// Опрашивает сервер на задачи, шлёт heartbeat, передаёт правила в content-script,
// принимает события отбивки от content-script и репортит их серверу.
//
// device-token и адрес сервера сохраняются при «спаривании» через дашборд
// (дашборд открывает страницу с ?token=... или пользователь вставляет токен).

import type { AgentTasksResponse, AgentReplyEvent } from '@threadhunt/shared';

const DEFAULT_API = 'https://threadhuntserver-production.up.railway.app';
// Единый источник версии — manifest.json (иначе heartbeat и chrome://extensions расходятся).
const VERSION = chrome.runtime.getManifest().version;

// Фоновую работу (обход директа / research / тест) открываем ФОНОВОЙ ВКЛАДКОЙ
// (active:false) в уже открытом окне браузера — она не перехватывает фокус и не плодит
// отдельные окна, не мешая работать. Работает во ВСЕХ Chromium-браузерах (Chrome, Edge,
// Brave, Opera, Yandex, Arc) — везде доступен chrome.tabs. Firefox/Safari — отдельная сборка.
// Фолбэк на свёрнутое окно, если открытого окна нет (вкладку некуда добавить).
async function openWorkWindow(url: string): Promise<{ windowId: number | null; tabId: number | null }> {
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    return { windowId: null, tabId: tab.id ?? null };
  } catch {
    const win = await chrome.windows.create({ url, focused: false, state: 'minimized' });
    return { windowId: win.id ?? null, tabId: win.tabs?.[0]?.id ?? null };
  }
}
async function closeWorkWindow(windowId: number | null | undefined, tabId: number | null | undefined) {
  if (windowId != null) {
    try { await chrome.windows.remove(windowId); return; } catch { /* уже закрыто */ }
  }
  if (tabId != null) {
    try { await chrome.tabs.remove(tabId); } catch { /* уже закрыта */ }
  }
}

// Content-script (untrusted context) по умолчанию НЕ видит chrome.storage.session.
// Открываем ему доступ — там живёт состояние возобновляемого обхода директа.
chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

async function cfg(): Promise<{ api: string; token: string | null }> {
  const { api, token } = await chrome.storage.local.get(['api', 'token']);
  let resolved: string = api || DEFAULT_API;
  // Защита: старое спаривание могло сохранить localhost (когда NEXT_PUBLIC_AGENT_API
  // не был задан на вебе). В реальном браузере клиента такой адрес недостижим —
  // игнорируем и используем прод-API. Так не нужно переспаривать.
  if (/localhost|127\.0\.0\.1/.test(resolved)) {
    resolved = DEFAULT_API;
    void chrome.storage.local.set({ api: resolved }); // и чиним сохранённое значение
  }
  return { api: resolved, token: token || null };
}

async function authed(path: string, init: RequestInit = {}) {
  const { api, token } = await cfg();
  if (!token) return null;
  return fetch(api + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
}

// Каждую минуту: heartbeat + получить задачи и положить их в storage,
// откуда content-script их прочитает.
chrome.alarms.create('tick', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tick') void tick();
});

async function tick() {
  // Фоновый heartbeat: показываем «онлайн» в дашборде, пока расширение установлено
  // и спарено — даже если вкладка Threads не открыта. threadsLoggedIn берём из
  // последнего, что видел content-script (по умолчанию false).
  const { threadsLoggedIn } = await chrome.storage.local.get('threadsLoggedIn');
  void authed('/api/agent/heartbeat', { method: 'POST', body: JSON.stringify({ version: VERSION, threadsLoggedIn: !!threadsLoggedIn }) });

  const res = await authed('/api/agent/tasks');
  if (!res || !res.ok) return;
  const tasks = (await res.json()) as AgentTasksResponse;
  await chrome.storage.local.set({ tasks });
  await maybeRunTestInBackground(tasks);
  await maybeRunResearchInBackground(tasks);
  await maybeRunSweepInBackground(tasks);
  await maybeRunScheduledSweep(tasks);
  await maybeRunCalibration(tasks);
}

// ИИ-калибровка разметки: если запрошена вручную (calibrateAt) ИЛИ калибровки ещё нет —
// открываем фоновую вкладку «Запросы», content-script снимет кнопки экрана и пришлёт на ИИ.
async function maybeRunCalibration(tasks: AgentTasksResponse) {
  const { calibTabId, calibTabOpenedAt } = await chrome.storage.local.get(['calibTabId', 'calibTabOpenedAt']);
  if (calibTabId != null) {
    if (calibTabOpenedAt && Date.now() - calibTabOpenedAt > 3 * 60_000) await closeCalibTab(); // таймаут
    return;
  }
  if (!tasks.active) return;
  // Не мешаем другим фоновым окнам.
  const { scheduledSweepTabId, sweepTabId, testTabId, researchTabId } = await chrome.storage.local.get(['scheduledSweepTabId', 'sweepTabId', 'testTabId', 'researchTabId']);
  if (scheduledSweepTabId != null || sweepTabId != null || testTabId != null || researchTabId != null) return;

  const manualTs = tasks.calibrateAt ? Date.parse(tasks.calibrateAt) : 0;
  const { calibHandledAt, calibAutoTriedAt } = await chrome.storage.local.get(['calibHandledAt', 'calibAutoTriedAt']);
  const isManual = !!manualTs && manualTs !== calibHandledAt;
  // Авто-калибровка: если её ещё нет, делаем один заход (и не чаще раза в 6ч, чтобы не зацикливать).
  const needAuto = !tasks.calibration && !!tasks.searches?.length && (!calibAutoTriedAt || Date.now() - calibAutoTriedAt > 6 * 3600_000);
  if (!isManual && !needAuto) return;

  await chrome.storage.session.set({ calib: { phase: 'list' } });
  try {
    const { windowId, tabId } = await openWorkWindow('https://www.threads.com/messages/requests');
    await chrome.storage.local.set({
      calibWindowId: windowId,
      calibTabId: tabId,
      calibTabOpenedAt: Date.now(),
      calibAutoTriedAt: Date.now(),
      ...(isManual ? { calibHandledAt: manualTs } : {}),
    });
  } catch {
    /* не удалось открыть окно */
  }
}

async function closeCalibTab() {
  const { calibWindowId, calibTabId } = await chrome.storage.local.get(['calibWindowId', 'calibTabId']);
  await chrome.storage.local.remove(['calibWindowId', 'calibTabId', 'calibTabOpenedAt']);
  await chrome.storage.session.remove('calib');
  await closeWorkWindow(calibWindowId, calibTabId);
}

// Сейчас рабочее время? (окно «HH:MM», локальное время). Дубль логики content-script,
// чтобы не открывать фоновую вкладку ночью.
function withinWorkingHours(wh?: { enabled: boolean; from: string; to: string }): boolean {
  if (!wh || !wh.enabled) return true;
  const d = new Date();
  const cur = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = wh.from.split(':').map(Number);
  const [th, tm] = wh.to.split(':').map(Number);
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  return from <= to ? cur >= from && cur <= to : cur >= from || cur <= to; // через полночь
}

// ПЛАНОВЫЙ обход директа БЕЗ участия клиента. Раньше периодическая отбивка шла только
// если у юзера была открыта вкладка /messages. Теперь, когда подошёл срок, background
// сам открывает ФОНОВУЮ свёрнутую вкладку Threads/Сообщения — content-script делает
// проход и закрывает её (тот же приём, что «Прогон сейчас»/тест). Так расширению больше
// не нужно держать вкладку вручную. Единый источник кулдауна — storage.session.lastSweepAt,
// который пишет content-script (без рассинхрона с его же проверкой).
async function maybeRunScheduledSweep(tasks: AgentTasksResponse) {
  // Диагностика: видно в консоли сервис-воркера (chrome://extensions → Threadhunt →
  // «service worker» → Console), почему плановый проход (не)запустился в этот тик.
  const log = (msg: string, extra?: unknown) => console.log('[threadhunt] плановая отбивка:', msg, extra ?? '');

  // Уже открыта плановая вкладка? Закрываем по таймауту, иначе ждём её завершения.
  const { scheduledSweepTabId, scheduledSweepOpenedAt } = await chrome.storage.local.get(['scheduledSweepTabId', 'scheduledSweepOpenedAt']);
  if (scheduledSweepTabId != null) {
    if (scheduledSweepOpenedAt && Date.now() - scheduledSweepOpenedAt > 4 * 60_000) { log('таймаут вкладки → закрываю'); await closeScheduledSweepTab(); }
    else log('проход уже идёт в фоновой вкладке — жду завершения');
    return;
  }
  // Не мешаем другим фоновым окнам (прогон сейчас / тест / research).
  const { sweepTabId, testTabId, researchTabId } = await chrome.storage.local.get(['sweepTabId', 'testTabId', 'researchTabId']);
  if (sweepTabId != null || testTabId != null || researchTabId != null) { log('занято другим фоновым окном (runNow/test/research) — пропуск'); return; }

  const lim = tasks.limits;
  if (!tasks.active || !tasks.searches?.length) { log('нет активных поисков / отбивка выключена', { active: tasks.active, searches: tasks.searches?.length ?? 0 }); return; }
  if (lim?.runNowAt) { log('есть «прогон сейчас» — его обработает отдельный путь'); return; }
  if (!withinWorkingHours(lim?.workingHours)) { log('вне рабочих часов', lim?.workingHours); return; }
  if (lim && (lim.repliesRemainingToday ?? 0) <= 0 && !lim.safeMode) { log('дневной лимит исчерпан (и не safeMode)', { left: lim.repliesRemainingToday }); return; }

  const cooldownMs = Math.max(30, lim?.sweepIntervalMinutes ?? 180) * 60_000;
  const { lastSweepAt } = await chrome.storage.session.get('lastSweepAt');
  if (lastSweepAt && Date.now() - lastSweepAt < cooldownMs) {
    const leftMin = Math.ceil((cooldownMs - (Date.now() - lastSweepAt)) / 60_000);
    log(`кулдаун ещё не вышел — осталось ~${leftMin} мин (интервал ${Math.round(cooldownMs / 60_000)} мин)`);
    return;
  }

  try {
    log(`ПОРА — открываю фоновую вкладку Threads/Сообщения (интервал ${Math.round(cooldownMs / 60_000)} мин)`);
    const { windowId, tabId } = await openWorkWindow('https://www.threads.com/messages/');
    await chrome.storage.local.set({ scheduledSweepWindowId: windowId, scheduledSweepTabId: tabId, scheduledSweepOpenedAt: Date.now() });
  } catch (e) {
    log('не удалось открыть окно', (e as Error)?.message);
  }
}

async function closeScheduledSweepTab() {
  const { scheduledSweepWindowId, scheduledSweepTabId } = await chrome.storage.local.get(['scheduledSweepWindowId', 'scheduledSweepTabId']);
  // Сначала забываем id, ПОТОМ закрываем — чтобы tabs.onRemoved не счёл наше закрытие случайным.
  await chrome.storage.local.remove(['scheduledSweepWindowId', 'scheduledSweepTabId', 'scheduledSweepOpenedAt']);
  await closeWorkWindow(scheduledSweepWindowId, scheduledSweepTabId);
}

// «Прогон сейчас»: если дашборд запросил немедленный обход (limits.runNowAt), сами
// открываем ФОНОВУЮ вкладку Threads/Сообщения — content-script там сделает проход и
// отчитается (сервер сбросит runNowAt), после чего вкладку закрываем. Клиенту не нужно
// держать Threads открытым.
async function maybeRunSweepInBackground(tasks: AgentTasksResponse) {
  const runNowAt = tasks.limits?.runNowAt;
  if (!runNowAt) {
    await closeSweepTab(); // запроса нет — подчистим вкладку, если осталась
    return;
  }
  const { sweepHandledAt, sweepTabOpenedAt } = await chrome.storage.local.get(['sweepHandledAt', 'sweepTabOpenedAt']);
  if (sweepHandledAt === runNowAt) {
    if (sweepTabOpenedAt && Date.now() - sweepTabOpenedAt > 4 * 60_000) await closeSweepTab(); // таймаут
    return;
  }
  await closeSweepTab();
  try {
    const { windowId, tabId } = await openWorkWindow('https://www.threads.com/messages/');
    await chrome.storage.local.set({ sweepHandledAt: runNowAt, sweepWindowId: windowId, sweepTabId: tabId, sweepTabOpenedAt: Date.now() });
  } catch {
    /* не удалось открыть окно */
  }
}

async function closeSweepTab() {
  const { sweepWindowId, sweepTabId } = await chrome.storage.local.get(['sweepWindowId', 'sweepTabId']);
  // Сначала забываем id, ПОТОМ закрываем — чтобы tabs.onRemoved не счёл наше закрытие случайным.
  await chrome.storage.local.remove(['sweepWindowId', 'sweepTabId', 'sweepTabOpenedAt']);
  await closeWorkWindow(sweepWindowId, sweepTabId);
}

// «Собрать топ-ветки сейчас»: если дашборд запросил research-проход (research.runAt),
// сами открываем вкладку Threads — content-script там соберёт ветки и пришлёт на сервер.
// Вкладку закрываем по сигналу завершения или по таймауту (research длится 1–3 мин).
async function maybeRunResearchInBackground(tasks: AgentTasksResponse) {
  const { researchHandledAt, researchTabOpenedAt, researchTabId } = await chrome.storage.local.get(['researchHandledAt', 'researchTabOpenedAt', 'researchTabId']);
  // Таймаут: закрыть зависшую research-вкладку.
  if (researchTabId != null && researchTabOpenedAt && Date.now() - researchTabOpenedAt > 5 * 60_000) await closeResearchTab();
  const r = tasks.research;
  const runAt = r?.runAt;
  if (!runAt) {
    console.log('[threadhunt] research: нет runAt в задачах (сервер не отдал «собрать сейчас»). research:', r);
    return; // нет запроса «сейчас» — плановый research идёт на уже открытой вкладке
  }
  if (researchHandledAt === runAt) return; // этот запрос уже обработали (вкладку откроем один раз)

  // Нечего искать (research выключен или нет запросов) — гасим метку, чтобы не висел «Сбор».
  if (!r?.enabled || !r.queries?.length) {
    console.log('[threadhunt] research: нечего искать — enabled:', r?.enabled, 'queries:', r?.queries?.length);
    await chrome.storage.local.set({ researchHandledAt: runAt });
    void authed('/api/agent/research', { method: 'POST', body: JSON.stringify({ posts: [], done: true }) }).then(() => void tick());
    return;
  }

  await closeResearchTab();
  console.log('[threadhunt] research: открываю ФОНОВУЮ вкладку поиска,', r.queries.length, 'запросов; первый:', r.queries[0]?.query);
  try {
    // Сразу кладём состояние прохода и открываем поиск в ФОНОВОЙ вкладке (active:false):
    // она не всплывает, не перехватывает фокус, перелистывание запросов происходит
    // невидимо для клиента. Закроем по завершении/таймауту.
    const queue = r.queries.slice(0, 12);
    await chrome.storage.session.set({ research: { queue, idx: 0, maxPerQuery: r.maxPerQuery || 15, collected: 0 }, lastResearchRunNow: Date.parse(runAt) });
    const url = 'https://www.threads.com/search?q=' + encodeURIComponent(queue[0].query) + '&serp_type=default';
    const { windowId, tabId } = await openWorkWindow(url);
    await chrome.storage.local.set({ researchHandledAt: runAt, researchWindowId: windowId, researchTabId: tabId, researchTabOpenedAt: Date.now() });
  } catch {
    /* не удалось открыть вкладку */
  }
}

async function closeResearchTab() {
  const { researchWindowId, researchTabId } = await chrome.storage.local.get(['researchWindowId', 'researchTabId']);
  if (researchWindowId != null) {
    try {
      await chrome.windows.remove(researchWindowId);
    } catch {
      /* уже закрыто */
    }
  } else if (researchTabId != null) {
    try {
      await chrome.tabs.remove(researchTabId);
    } catch {
      /* уже закрыта */
    }
  }
  await chrome.storage.local.remove(['researchWindowId', 'researchTabId', 'researchTabOpenedAt']);
}

// Холостой тест отбивки БЕЗ участия клиента: если дашборд запросил тест, сами
// открываем ФОНОВУЮ вкладку Threads/Сообщения — content-script там прогонит проход
// и пришлёт результат, после чего вкладку закрываем. Клиенту не нужно ничего открывать.
async function maybeRunTestInBackground(tasks: AgentTasksResponse) {
  const dmTestAt = tasks.dmTestAt;
  if (!dmTestAt) {
    await closeTestTab(); // запроса нет — подчистим вкладку, если зависла
    return;
  }
  const { testHandledAt, testTabOpenedAt } = await chrome.storage.local.get(['testHandledAt', 'testTabOpenedAt']);
  if (testHandledAt === dmTestAt) {
    if (testTabOpenedAt && Date.now() - testTabOpenedAt > 4 * 60_000) await closeTestTab(); // таймаут
    return;
  }
  await closeTestTab();
  try {
    const { windowId, tabId } = await openWorkWindow('https://www.threads.com/messages/');
    await chrome.storage.local.set({ testHandledAt: dmTestAt, testWindowId: windowId, testTabId: tabId, testTabOpenedAt: Date.now() });
  } catch {
    /* не удалось открыть окно */
  }
}

async function closeTestTab() {
  const { testWindowId, testTabId } = await chrome.storage.local.get(['testWindowId', 'testTabId']);
  await closeWorkWindow(testWindowId, testTabId);
  await chrome.storage.local.remove(['testWindowId', 'testTabId', 'testTabOpenedAt']);
}

// Heartbeat и репорт событий — приходят сообщениями от content-script.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'heartbeat') {
    void chrome.storage.local.set({ threadsLoggedIn: !!msg.threadsLoggedIn }); // запоминаем для фонового heartbeat
    void authed('/api/agent/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ version: VERSION, threadsLoggedIn: !!msg.threadsLoggedIn }),
    });
  }
  if (msg?.type === 'events') {
    const events = msg.events as AgentReplyEvent[];
    void authed('/api/agent/events', { method: 'POST', body: JSON.stringify({ events }) }).then(() => {
      void tick(); // обновить alreadyReplied сразу после отправки
    });
  }
  if (msg?.type === 'pass') {
    // Сводка прохода → сервер (статистика для карточки и хронологии).
    void authed('/api/agent/pass', { method: 'POST', body: JSON.stringify(msg.report || {}) }).then(() => {
      void tick(); // подтянуть свежие настройки (в т.ч. сброшенный runNowAt)
    });
    void closeScheduledSweepTab(); // если проход шёл в плановой фоновой вкладке — закрыть её
  }
  if (msg?.type === 'log') {
    // Строка живого журнала событий от content-script → сервер (дашборд её покажет).
    void authed('/api/agent/log', { method: 'POST', body: JSON.stringify({ level: msg.level || 'info', text: String(msg.text || '').slice(0, 300) }) });
  }
  if (msg?.type === 'calibrate') {
    // Снятые кнопки экрана запроса → сервер (Claude определит «Принять/Показать/OK/Отклонить»).
    void authed('/api/agent/calibrate', { method: 'POST', body: JSON.stringify({ browser: msg.browser, lang: msg.lang, controls: msg.controls || [] }) }).then(() => void tick());
    void closeCalibTab();
  }
  if (msg?.type === 'cmd') {
    // Команда из дашборда (напр. «собрать сейчас») — мгновенно тикаем, не ждём будильник.
    console.log('[threadhunt] команда из дашборда:', msg.cmd, '→ tick()');
    void tick();
  }
  if (msg?.type === 'research') {
    // Собранные топовые ветки + диагностика вёрстки → сервер.
    void authed('/api/agent/research', { method: 'POST', body: JSON.stringify({ posts: msg.posts || [], diag: msg.diag || null }) });
  }
  if (msg?.type === 'researchDone') {
    // Весь проход завершён — done:true гасит метку «идёт сбор» на сервере и закрывает вкладку.
    void authed('/api/agent/research', { method: 'POST', body: JSON.stringify({ posts: [], done: true }) }).then(() => void tick());
    void closeResearchTab();
  }
  if (msg?.type === 'testResult') {
    // Результат холостого теста отбивки → сервер; закрываем фоновую тест-вкладку.
    void authed('/api/agent/test-result', { method: 'POST', body: JSON.stringify({ scanned: msg.scanned || 0, matched: msg.matched || 0 }) }).then(() => void tick());
    void closeTestTab();
  }
  if (msg?.type === 'getTasks') {
    chrome.storage.local.get('tasks').then((s) => sendResponse(s.tasks || null));
    return true; // async response
  }
});

// Детект случайного закрытия рабочей вкладки отбивки. Если закрылась вкладка sweep/
// scheduledSweep, id которой ещё в storage (значит закрыли НЕ мы — мы чистим id до закрытия),
// — сообщаем серверу: дашборд покажет «вкладка закрыта, ничего работать не будет».
// isWindowClosing игнорируем (это выход из браузера, а не случайное закрытие вкладки).
chrome.tabs.onRemoved.addListener((tabId, info) => {
  if (info.isWindowClosing) return;
  void onWorkTabRemoved(tabId);
});
async function onWorkTabRemoved(tabId: number) {
  const { scheduledSweepTabId, sweepTabId } = await chrome.storage.local.get(['scheduledSweepTabId', 'sweepTabId']);
  if (tabId !== scheduledSweepTabId && tabId !== sweepTabId) return; // не наша рабочая вкладка
  await chrome.storage.local.remove([
    'scheduledSweepWindowId', 'scheduledSweepTabId', 'scheduledSweepOpenedAt',
    'sweepWindowId', 'sweepTabId', 'sweepTabOpenedAt', 'sweepHandledAt',
  ]);
  await chrome.storage.session.remove('sweep'); // прервать незавершённое состояние прохода
  void authed('/api/agent/tab-closed', { method: 'POST', body: JSON.stringify({}) });
}

void tick();
