// Popup расширения: ввод адреса сервера и кода спаривания (device-token)
// + тест-проход директа без отправки (dry-run).
// Сохраняет настройки в chrome.storage.local — оттуда их читает background.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function refresh() {
  const { api, token } = await chrome.storage.local.get(['api', 'token']);
  ($('api') as HTMLInputElement).value = api || 'http://localhost:3001';
  ($('token') as HTMLInputElement).value = token || '';
  const connected = !!token;
  $('dot').classList.toggle('on', connected);
  $('status').textContent = connected ? 'подключено' : 'не подключено';
  void showResult();
}

$('save').addEventListener('click', async () => {
  const api = ($('api') as HTMLInputElement).value.trim().replace(/\/$/, '');
  const token = ($('token') as HTMLInputElement).value.trim();
  await chrome.storage.local.set({ api, token });
  $('status').textContent = 'сохранено';
  refresh();
});

// ── Тест-проход (dry-run) ──
const REASONS: Record<string, string> = {
  not_messages: 'Откройте вкладку Threads → Сообщения и нажмите снова.',
  no_keywords: 'Нет активных кодовых слов — добавьте их в поиск в кабинете.',
  busy: 'Сейчас уже идёт проход. Подождите и попробуйте снова.',
  no_receiver: 'Откройте вкладку Threads → Сообщения и нажмите снова.',
};

function setRes(html: string) {
  const el = $('testres');
  el.style.display = 'block';
  el.innerHTML = html;
}

async function showResult() {
  const { th_test_result: r } = await chrome.storage.local.get('th_test_result');
  if (!r) return;
  if (r.done) {
    setRes(`Готово: осмотрено <b class="accent">${r.scanned}</b> диалогов, ответил бы на <b class="accent">${r.matched}</b>.<br/><span class="muted">Отправок: 0 — это тест.</span>`);
  } else {
    setRes(`Идёт тест… осмотрено ${r.scanned}, совпадений ${r.matched}`);
  }
  return r;
}

$('test').addEventListener('click', async () => {
  const btn = $('test') as HTMLButtonElement;
  btn.disabled = true;
  setRes('Запускаю тест…');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setRes(REASONS.not_messages);
    btn.disabled = false;
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'startTest' }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      setRes(REASONS.no_receiver);
      btn.disabled = false;
      return;
    }
    if (!resp.ok) {
      setRes(REASONS[resp.reason] || 'Не удалось запустить тест.');
      btn.disabled = false;
      return;
    }
    // проход идёт через перезагрузки страницы — опрашиваем результат из storage
    const started = Date.now();
    const poll = setInterval(async () => {
      const r = await showResult();
      if ((r && r.done) || Date.now() - started > 120_000) {
        clearInterval(poll);
        btn.disabled = false;
      }
    }, 3000);
  });
});

refresh();
