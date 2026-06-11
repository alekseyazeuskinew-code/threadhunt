// Background service worker расширения Threadhunt.
// Опрашивает сервер на задачи, шлёт heartbeat, передаёт правила в content-script,
// принимает события отбивки от content-script и репортит их серверу.
//
// device-token и адрес сервера сохраняются при «спаривании» через дашборд
// (дашборд открывает страницу с ?token=... или пользователь вставляет токен).

import type { AgentTasksResponse, AgentReplyEvent } from '@threadhunt/shared';

const DEFAULT_API = 'https://threadhuntserver-production.up.railway.app';
const VERSION = '0.1.5';

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
  if (msg?.type === 'research') {
    // Собранные топовые ветки → сервер.
    void authed('/api/agent/research', { method: 'POST', body: JSON.stringify({ posts: msg.posts || [] }) });
  }
  if (msg?.type === 'testResult') {
    // Результат холостого теста отбивки → сервер.
    void authed('/api/agent/test-result', { method: 'POST', body: JSON.stringify({ scanned: msg.scanned || 0, matched: msg.matched || 0 }) }).then(() => void tick());
  }
  if (msg?.type === 'getTasks') {
    chrome.storage.local.get('tasks').then((s) => sendResponse(s.tasks || null));
    return true; // async response
  }
});

void tick();
