// Скрипт авто-спаривания: работает ТОЛЬКО на странице дашборда Threadhunt.
// Дашборд по кнобке «Подключить браузер» постит в окно сообщение с device-token
// и адресом API. Мы его ловим, сохраняем в chrome.storage.local — и расширение
// подключено без копипаста. Затем шлём подтверждение обратно в страницу.

interface PairMsg {
  source: 'threadhunt-pair' | 'threadhunt-cmd';
  token?: string;
  api?: string;
  cmd?: string;
}

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const data = e.data as PairMsg | undefined;
  if (!data) return;
  // Спаривание.
  if (data.source === 'threadhunt-pair' && data.token) {
    chrome.storage.local.set({ token: data.token, api: data.api || 'http://localhost:3010' }, () => {
      window.postMessage({ source: 'threadhunt-paired' }, e.origin);
    });
    return;
  }
  // Команды дашборда → будим воркер сразу (без ожидания минутного будильника).
  // Напр. «Собрать топ-ветки сейчас» — чтобы вкладка поиска открылась мгновенно.
  if (data.source === 'threadhunt-cmd' && data.cmd) {
    try {
      chrome.runtime.sendMessage({ type: 'cmd', cmd: data.cmd });
    } catch {
      /* воркер недоступен */
    }
  }
});

// Сообщаем странице, что расширение вообще установлено (чтобы UI это показал).
window.postMessage({ source: 'threadhunt-present' }, location.origin);
