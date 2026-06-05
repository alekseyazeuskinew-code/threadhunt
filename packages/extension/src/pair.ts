// Скрипт авто-спаривания: работает ТОЛЬКО на странице дашборда Threadhunt.
// Дашборд по кнобке «Подключить браузер» постит в окно сообщение с device-token
// и адресом API. Мы его ловим, сохраняем в chrome.storage.local — и расширение
// подключено без копипаста. Затем шлём подтверждение обратно в страницу.

interface PairMsg {
  source: 'threadhunt-pair';
  token: string;
  api: string;
}

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const data = e.data as PairMsg | undefined;
  if (!data || data.source !== 'threadhunt-pair' || !data.token) return;
  chrome.storage.local.set({ token: data.token, api: data.api || 'http://localhost:3010' }, () => {
    // подтверждаем странице, что расширение установлено и подключено
    window.postMessage({ source: 'threadhunt-paired' }, e.origin);
  });
});

// Сообщаем странице, что расширение вообще установлено (чтобы UI это показал).
window.postMessage({ source: 'threadhunt-present' }, location.origin);
