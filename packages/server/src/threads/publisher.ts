// Публикация в Threads через ОФИЦИАЛЬНЫЙ API (graph.threads.net).
// Мультиарендный порт прототипа publisher.js: токен передаётся аргументом
// (расшифрованный из ThreadsConnection), а не читается из файла.
//
// Публикация в 2 шага (требование API): создать контейнер → опубликовать.

import { publicApiBase } from '../uploadTicket.js';

const API = 'https://graph.threads.net/v1.0';

// Публичный адрес API — чтобы достроить относительные ссылки на загруженное медиа
// (/api/media/...) в абсолютные: Threads (серверы Meta) скачивают файл по URL.
// Берём PUBLIC_BASE_URL, иначе авто-домен Railway (publicApiBase).
function toPublicUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url; // уже абсолютный (S3/R2 или внешняя ссылка)
  if (url.startsWith('/')) {
    const base = publicApiBase();
    if (!base)
      throw new Error('Загруженный файл не доступен публично: задай PUBLIC_BASE_URL (адрес API) или подключи R2/S3 — иначе Threads не сможет его скачать.');
    return base + url;
  }
  return url;
}

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

// Одно медиа поста (для карусели — их несколько).
export interface MediaItem {
  url: string;
  type: 'image' | 'video';
}

// Один сегмент цепочки веток: текст + опциональная карусель медиа.
// segment[0] = корневой пост, остальные публикуются как ответы (reply_to_id).
export interface ChainSegment {
  text?: string;
  media?: MediaItem[];
}

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

// Создать контейнер ОДНОГО медиа (image/video). Опции: элемент карусели
// (is_carousel_item) и/или ответ (reply_to_id). Для элемента карусели текст не
// прикрепляется — он живёт на родительском CAROUSEL-контейнере.
async function createMediaItemContainer(
  accessToken: string,
  threadsUserId: string,
  item: MediaItem,
  opts: { text?: string; isCarouselItem?: boolean; replyToId?: string } = {},
): Promise<string> {
  const params: Record<string, string> = { access_token: accessToken };
  const url = toPublicUrl(item.url); // относительный /api/media/... → абсолютный публичный
  if (item.type === 'image') {
    params.media_type = 'IMAGE';
    params.image_url = url;
  } else {
    params.media_type = 'VIDEO';
    params.video_url = url;
  }
  if (opts.isCarouselItem) params.is_carousel_item = 'true';
  else if (opts.text) params.text = opts.text;
  if (opts.replyToId) params.reply_to_id = opts.replyToId;
  const c = await apiPost(`/${threadsUserId}/threads`, params);
  return c.id as string;
}

// Дождаться готовности контейнера, если он содержит видео (видео кодируется
// асинхронно). Для фото/текста — короткая пауза.
async function settleContainer(creationId: string, accessToken: string, hasVideo: boolean) {
  if (hasVideo) await waitContainerReady(creationId, accessToken);
  else await new Promise((r) => setTimeout(r, 3000));
}

// Получить permalink опубликованного поста (не критично при сбое).
async function fetchPermalink(publishedId: string, accessToken: string): Promise<string | null> {
  try {
    const info = await apiGet(`/${publishedId}`, { fields: 'permalink', access_token: accessToken });
    return info.permalink || null;
  } catch {
    return null;
  }
}

/**
 * Опубликовать ОДИН сегмент: текст и/или медиа (1 шт. или карусель), опционально
 * как ответ (reply_to_id) — на этом строятся и обычный пост, и цепочки веток.
 * Карусель: создаём контейнер на каждый элемент (is_carousel_item) → родительский
 * CAROUSEL с children → публикуем.
 */
export async function publishSegment(
  accessToken: string,
  threadsUserId: string,
  seg: ChainSegment,
  opts: { replyToId?: string } = {},
): Promise<PublishResult> {
  const text = seg.text || '';
  const media = (seg.media || []).filter((m) => m && m.url && (m.type === 'image' || m.type === 'video'));
  if (!text && !media.length) throw new Error('Пустой сегмент: нет ни текста, ни медиа.');

  let creationId: string;
  let mediaType: string;

  if (media.length > 1) {
    // ── Карусель ──
    const childIds: string[] = [];
    for (const item of media) {
      const id = await createMediaItemContainer(accessToken, threadsUserId, item, { isCarouselItem: true });
      await settleContainer(id, accessToken, item.type === 'video');
      childIds.push(id);
    }
    const parent = await apiPost(`/${threadsUserId}/threads`, {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      text,
      access_token: accessToken,
      ...(opts.replyToId ? { reply_to_id: opts.replyToId } : {}),
    });
    creationId = parent.id;
    // Если в карусели есть видео — родительский контейнер тоже обрабатывается асинхронно,
    // ждём его готовности (иначе threads_publish падает с «Media Not Found»).
    await settleContainer(creationId, accessToken, media.some((m) => m.type === 'video'));
    mediaType = 'carousel';
  } else if (media.length === 1) {
    // ── Одно медиа ──
    const item = media[0];
    creationId = await createMediaItemContainer(accessToken, threadsUserId, item, { text, replyToId: opts.replyToId });
    await settleContainer(creationId, accessToken, item.type === 'video');
    mediaType = item.type;
  } else {
    // ── Только текст ──
    const c = await apiPost(`/${threadsUserId}/threads`, {
      media_type: 'TEXT',
      text,
      access_token: accessToken,
      ...(opts.replyToId ? { reply_to_id: opts.replyToId } : {}),
    });
    creationId = c.id;
    await settleContainer(creationId, accessToken, false);
    mediaType = 'text';
  }

  const published = await apiPost(`/${threadsUserId}/threads_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });
  return { id: published.id, permalink: await fetchPermalink(published.id, accessToken), mediaType };
}

/**
 * Опубликовать пост: текст и/или медиа по ПУБЛИЧНОЙ ссылке (порт publishPost из publisher.js).
 * mediaType: 'image' | 'video' | '' (пусто = только текст). Поддерживает карусель
 * через opts.media (массив). Обёртка над publishSegment для обратной совместимости.
 */
export async function publishPost(
  accessToken: string,
  threadsUserId: string,
  opts: { text?: string; mediaUrl?: string; mediaType?: MediaType; media?: MediaItem[] },
): Promise<PublishResult> {
  const media: MediaItem[] =
    opts.media && opts.media.length
      ? opts.media
      : opts.mediaUrl && (opts.mediaType === 'image' || opts.mediaType === 'video')
        ? [{ url: opts.mediaUrl, type: opts.mediaType }]
        : [];
  if ((opts.mediaType === 'image' || opts.mediaType === 'video') && !opts.mediaUrl && !(opts.media && opts.media.length)) {
    throw new Error('Указан тип медиа, но нет ссылки.');
  }
  return publishSegment(accessToken, threadsUserId, { text: opts.text, media });
}

/**
 * Опубликовать ЦЕПОЧКУ веток: первый сегмент — корневой пост, каждый следующий —
 * ответ на предыдущий (reply_to_id). Так «ветка под веткой» залетает сильнее.
 * Возвращает результат корневого поста (+ id всех сегментов и число опубликованных).
 */
export async function publishChain(
  accessToken: string,
  threadsUserId: string,
  segments: ChainSegment[],
): Promise<PublishResult & { segmentIds: string[]; segmentCount: number }> {
  const segs = segments.filter((s) => (s.text && s.text.trim()) || (s.media && s.media.length));
  if (!segs.length) throw new Error('Пустая цепочка: нет ни одного сегмента.');

  const root = await publishSegment(accessToken, threadsUserId, segs[0]);
  const segmentIds = [root.id];
  let replyTo = root.id;
  // Ответы публикуем последовательно, пауза между ними бережёт аккаунт от лимитов.
  for (let i = 1; i < segs.length; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await publishSegment(accessToken, threadsUserId, segs[i], { replyToId: replyTo });
    segmentIds.push(r.id);
    replyTo = r.id; // следующая ветка цепляется к этой — получается «ветка под веткой»
  }
  return { ...root, segmentIds, segmentCount: segmentIds.length };
}

/** Текстовый пост — обёртка над publishPost. */
export async function publishText(
  accessToken: string,
  threadsUserId: string,
  text: string,
): Promise<PublishResult> {
  return publishPost(accessToken, threadsUserId, { text });
}

export interface ThreadsReply {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
}

/** Получить ответы (комментарии) под нашим постом. Требует threads_read_replies. */
export async function fetchReplies(accessToken: string, mediaId: string): Promise<ThreadsReply[]> {
  const json = await apiGet(`/${mediaId}/replies`, {
    fields: 'id,text,username,timestamp',
    access_token: accessToken,
  });
  return Array.isArray(json?.data) ? (json.data as ThreadsReply[]) : [];
}

/** Опубликовать ответ на комментарий/пост. Требует threads_manage_replies. */
export async function publishReply(accessToken: string, threadsUserId: string, replyToId: string, text: string): Promise<{ id: string }> {
  const container = await apiPost(`/${threadsUserId}/threads`, {
    media_type: 'TEXT',
    text,
    reply_to_id: replyToId,
    access_token: accessToken,
  });
  await new Promise((r) => setTimeout(r, 2000));
  const published = await apiPost(`/${threadsUserId}/threads_publish`, {
    creation_id: container.id,
    access_token: accessToken,
  });
  return { id: published.id };
}

/** Продлить долгоживущий токен (раз в ~60 дней). Возвращает новый токен + срок. */
export async function refreshToken(accessToken: string) {
  return apiGet('/refresh_access_token', {
    grant_type: 'th_refresh_token',
    access_token: accessToken,
  }) as Promise<{ access_token: string; token_type: string; expires_in: number }>;
}
