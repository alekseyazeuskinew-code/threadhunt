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

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown) => req<T>(p, { method: 'POST', body }),
  patch: <T>(p: string, body?: unknown) => req<T>(p, { method: 'PATCH', body }),
  put: <T>(p: string, body?: unknown) => req<T>(p, { method: 'PUT', body }),
  del: <T>(p: string) => req<T>(p, { method: 'DELETE' }),
};
