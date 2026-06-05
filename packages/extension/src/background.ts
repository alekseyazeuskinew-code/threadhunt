// Background service worker расширения Threadhunt.
// Опрашивает сервер на задачи, шлёт heartbeat, передаёт правила в content-script,
// принимает события отбивки от content-script и репортит их серверу.
//
// device-token и адрес сервера сохраняются при «спаривании» через дашборд
// (дашборд открывает страницу с ?token=... или пользователь вставляет токен).

import type { AgentTasksResponse, AgentReplyEvent } from '@threadhunt/shared';

const DEFAULT_API = 'https://threadhuntserver-production.up.railway.app';
const VERSION = '0.1.0';

// Content-script (untrusted context) по умолчанию НЕ видит chrome.storage.session.
// Открываем ему доступ — там живёт состояние возобновляемого обхода директа.
chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

async function cfg(): Promise<{ api: string; token: string | null }> {
  const { api, token } = await chrome.storage.local.get(['api', 'token']);
  return { api: api || DEFAULT_API, token: token || null };
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
  const res = await authed('/api/agent/tasks');
  if (!res || !res.ok) return;
  const tasks = (await res.json()) as AgentTasksResponse;
  await chrome.storage.local.set({ tasks });
}

// Heartbeat и репорт событий — приходят сообщениями от content-script.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'heartbeat') {
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
  if (msg?.type === 'getTasks') {
    chrome.storage.local.get('tasks').then((s) => sendResponse(s.tasks || null));
    return true; // async response
  }
});

void tick();
