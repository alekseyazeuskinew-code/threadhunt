// Background service worker расширения Threadhunt.
// Опрашивает сервер на задачи, шлёт heartbeat, передаёт правила в content-script,
// принимает события отбивки от content-script и репортит их серверу.
//
// device-token и адрес сервера сохраняются при «спаривании» через дашборд
// (дашборд открывает страницу с ?token=... или пользователь вставляет токен).

import type { AgentTasksResponse, AgentReplyEvent } from '@threadhunt/shared';

const DEFAULT_API = 'https://threadhuntserver-production.up.railway.app';
const VERSION = '0.1.18';

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
    void authed('/api/agent/research', { method: 'POST', body: JSON.stringify({ posts: [] }) }).then(() => void tick());
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
    const tab = await chrome.tabs.create({ url, active: false });
    await chrome.storage.local.set({ researchHandledAt: runAt, researchTabId: tab.id ?? null, researchTabOpenedAt: Date.now() });
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
    const tab = await chrome.tabs.create({ url: 'https://www.threads.com/messages/', active: false });
    await chrome.storage.local.set({ testHandledAt: dmTestAt, testTabId: tab.id ?? null, testTabOpenedAt: Date.now() });
  } catch {
    /* не удалось открыть вкладку */
  }
}

async function closeTestTab() {
  const { testTabId } = await chrome.storage.local.get('testTabId');
  if (testTabId != null) {
    try {
      await chrome.tabs.remove(testTabId);
    } catch {
      /* уже закрыта */
    }
    await chrome.storage.local.remove(['testTabId', 'testTabOpenedAt']);
  }
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
    // Проход завершён — гасим метку «идёт сбор» на сервере (даже при 0 собранных) и
    // закрываем фоновую research-вкладку.
    void authed('/api/agent/research', { method: 'POST', body: JSON.stringify({ posts: [] }) }).then(() => void tick());
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

void tick();
