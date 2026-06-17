// Тонкий клиент к API. Запросы идут на /api/* (Next проксирует на Fastify через
// rewrites в next.config.mjs), cookie-сессия передаётся автоматически.
//
// ВАЖНО: Content-Type ставим ТОЛЬКО когда есть тело. Иначе Fastify отклоняет
// запрос с пустым телом (FST_ERR_CTP_EMPTY_JSON_BODY) — это ломало DELETE и
// POST без тела (удаление устройства, тумблеры, выход).

async function req<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method || 'GET', credentials: 'include' };
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = typeof j.error === 'string' ? j.error : 'Проверьте поля формы';
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Загрузка файла (multipart). Content-Type НЕ ставим — браузер сам проставит
// boundary. Возвращает публичный URL и тип медиа для постов.
// PUT файла напрямую по URL (R2 presigned) с прогрессом. Тело — сам File.
function xhrSend(method: string, url: string, body: XMLHttpRequestBodyInit, opts: { withCredentials?: boolean; contentType?: string; onProgress?: (p: number) => void }): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (opts.withCredentials) xhr.withCredentials = true;
    if (opts.contentType) xhr.setRequestHeader('Content-Type', opts.contentType);
    if (opts.onProgress) {
      opts.onProgress(0);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(100);
        resolve(xhr.responseText);
      } else {
        let msg = `Ошибка ${xhr.status}`;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j?.error) msg = typeof j.error === 'string' ? j.error : 'Не удалось загрузить файл';
        } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error(`Запрос заблокирован браузером/сетью (xhr.status=${xhr.status})`));
    xhr.send(body);
  });
}

async function upload(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ url: string; type: 'image' | 'video'; size: number }> {
  const type: 'image' | 'video' = file.type.startsWith('video') ? 'video' : 'image';

  // 1) Пытаемся получить presigned PUT в R2 → грузим файл НАПРЯМУЮ в облако, без лимита
  // размера и не нагружая сервер. Если R2 не настроен (409 'no-r2') — откат на бэкенд.
  let presign: { putUrl: string; publicUrl: string } | null = null;
  try {
    presign = await req<{ putUrl: string; publicUrl: string }>('/api/uploads/presign', { method: 'POST', body: { mime: file.type } });
  } catch (e: any) {
    console.warn('[upload] presign недоступен, откат на бэкенд:', e?.message);
    presign = null; // нет R2 либо неподдерживаемый тип — попробуем через бэкенд
  }
  if (presign?.putUrl) {
    try {
      console.info('[upload] PUT в R2:', new URL(presign.putUrl).host, file.name, `${(file.size / 1024 / 1024).toFixed(1)}МБ`, file.type);
      await xhrSend('PUT', presign.putUrl, file, { contentType: file.type || undefined, onProgress });
      return { url: presign.publicUrl, type, size: file.size };
    } catch (e: any) {
      // status=0 = браузер/сеть/расширение режут прямой запрос к R2. Не сдаёмся —
      // грузим через сервер (browser → Railway → R2 на стороне сервера). Это надёжный
      // путь, но файл проходит через память сервера, поэтому ограничен ~100 МБ.
      console.warn('[upload] прямой R2 PUT не прошёл, пробую через сервер:', e?.message);
    }
  }

  // 2) Загрузка через бэкенд (фоллбэк или когда R2 не настроен): по тикету, минуя
  // прокси фронта. Файл проходит через память сервера — поэтому ограничиваем 100 МБ.
  if (file.size > 100 * 1024 * 1024) {
    throw new Error(`Файл ${(file.size / 1024 / 1024).toFixed(0)} МБ — прямая загрузка в облако не прошла, а через сервер лимит 100 МБ. Сожми видео или разреши R2 в браузере (отключи блокировщик).`);
  }
  const t = await req<{ ticket: string; uploadUrl: string }>('/api/uploads/ticket', { method: 'POST' });
  const sep = t.uploadUrl.includes('?') ? '&' : '?';
  const direct = `${t.uploadUrl}${sep}ticket=${encodeURIComponent(t.ticket)}`;
  const fd = new FormData();
  fd.append('file', file);
  const text = await xhrSend('POST', direct, fd, { withCredentials: t.uploadUrl.startsWith('/'), onProgress });
  return JSON.parse(text);
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown) => req<T>(p, { method: 'POST', body }),
  patch: <T>(p: string, body?: unknown) => req<T>(p, { method: 'PATCH', body }),
  put: <T>(p: string, body?: unknown) => req<T>(p, { method: 'PUT', body }),
  del: <T>(p: string) => req<T>(p, { method: 'DELETE' }),
  upload,
};
