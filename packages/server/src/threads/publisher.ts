// Публикация в Threads через ОФИЦИАЛЬНЫЙ API (graph.threads.net).
// Мультиарендный порт прототипа publisher.js: токен передаётся аргументом
// (расшифрованный из ThreadsConnection), а не читается из файла.
//
// Публикация в 2 шага (требование API): создать контейнер → опубликовать.

const API = 'https://graph.threads.net/v1.0';

async function apiGet(endpoint: string, params: Record<string, string>) {
  const url = new URL(API + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Threads API ${res.status}: ${JSON.stringify(json.error || json)}`);
  return json;
}

async function apiPost(endpoint: string, params: Record<string, string>) {
  const res = await fetch(API + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Threads API ${res.status}: ${JSON.stringify(json.error || json)}`);
  return json;
}

export interface PublishResult {
  id: string;
  permalink: string | null;
  mediaType: string;
}

export type MediaType = 'image' | 'video' | '';

/** Узнать id/username владельца токена. */
export async function whoami(accessToken: string) {
  return apiGet('/me', {
    fields: 'id,username,threads_profile_picture_url',
    access_token: accessToken,
  });
}

// Дождаться готовности медиа-контейнера. VIDEO Threads кодирует не мгновенно —
// нужно опрашивать статус, иначе публикация упадёт (порт waitContainerReady из publisher.js).
async function waitContainerReady(creationId: string, token: string, maxMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 4000));
    let st: any;
    try {
      st = await apiGet(`/${creationId}`, { fields: 'status,error_message', access_token: token });
    } catch {
      continue;
    }
    if (st.status === 'FINISHED') return;
    if (st.status === 'ERROR') throw new Error('Медиа не обработалось: ' + (st.error_message || 'ERROR'));
    // IN_PROGRESS — ждём дальше
  }
  throw new Error('Таймаут обработки медиа (видео слишком долго кодируется).');
}

/**
 * Опубликовать пост: текст и/или медиа по ПУБЛИЧНОЙ ссылке (порт publishPost из publisher.js).
 * mediaType: 'image' | 'video' | '' (пусто = только текст).
 */
export async function publishPost(
  accessToken: string,
  threadsUserId: string,
  opts: { text?: string; mediaUrl?: string; mediaType?: MediaType },
): Promise<PublishResult> {
  const text = opts.text || '';
  const mediaUrl = opts.mediaUrl || '';
  const mediaType = opts.mediaType || '';
  if ((mediaType === 'image' || mediaType === 'video') && !mediaUrl) throw new Error('Указан тип медиа, но нет ссылки.');
  if (!text && !mediaUrl) throw new Error('Пустой пост: нет ни текста, ни медиа.');

  // 1) контейнер (TEXT / IMAGE / VIDEO)
  let params: Record<string, string>;
  if (mediaUrl && mediaType === 'image') {
    params = { media_type: 'IMAGE', image_url: mediaUrl, text, access_token: accessToken };
  } else if (mediaUrl && mediaType === 'video') {
    params = { media_type: 'VIDEO', video_url: mediaUrl, text, access_token: accessToken };
  } else {
    params = { media_type: 'TEXT', text, access_token: accessToken };
  }
  const container = await apiPost(`/${threadsUserId}/threads`, params);

  // 2) ждём готовности: для видео опрашиваем статус, иначе просто пауза
  if (mediaType === 'video') {
    await waitContainerReady(container.id, accessToken);
  } else {
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 3) публикация
  const published = await apiPost(`/${threadsUserId}/threads_publish`, {
    creation_id: container.id,
    access_token: accessToken,
  });

  let permalink: string | null = null;
  try {
    const info = await apiGet(`/${published.id}`, { fields: 'permalink', access_token: accessToken });
    permalink = info.permalink || null;
  } catch {
    /* не критично */
  }
  return { id: published.id, permalink, mediaType: mediaType || 'text' };
}

/** Текстовый пост — обёртка над publishPost. */
export async function publishText(
  accessToken: string,
  threadsUserId: string,
  text: string,
): Promise<PublishResult> {
  return publishPost(accessToken, threadsUserId, { text });
}

/** Продлить долгоживущий токен (раз в ~60 дней). Возвращает новый токен + срок. */
export async function refreshToken(accessToken: string) {
  return apiGet('/refresh_access_token', {
    grant_type: 'th_refresh_token',
    access_token: accessToken,
  }) as Promise<{ access_token: string; token_type: string; expires_in: number }>;
}
