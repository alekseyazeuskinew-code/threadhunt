// Хранилище загруженных медиа (фото/видео для постов-приманок).
//
// ЗАЧЕМ: Threads API не принимает файл напрямую — ему нужен ПУБЛИЧНЫЙ URL, по
// которому серверы Meta сами скачают медиа (image_url / video_url). Поэтому файл,
// загруженный клиентом в дашборд, надо сохранить и отдать по публичной ссылке.
//
// Два бэкенда за одним интерфейсом:
//   • s3    — Cloudflare R2 / любой S3-совместимый бакет (прод). URL публичный и
//             достижим серверами Meta. Включается, если заданы S3_* переменные.
//   • local — файлы на диске сервера, раздаются Fastify по /uploads (dev / простой
//             прод на одном инстансе с постоянным диском). URL = PUBLIC_BASE_URL.
//
// ВАЖНО про localhost: в локальной разработке Meta НЕ достучится до localhost —
// превью в дашборде работает, но реальная публикация uploaded-медиа требует
// публичного домена (задеплоенный сервер или R2).

import { AwsClient } from 'aws4fetch';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { publicApiBase } from './uploadTicket.js';

// Каталог для локального бэкенда (раздаётся в index.ts как /uploads).
export const LOCAL_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
const S3_BUCKET = process.env.S3_BUCKET || '';
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || '';
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || '';
const S3_REGION = process.env.S3_REGION || 'auto';
// Публичный базовый URL, по которому отдаётся бакет (CDN/Custom domain R2).
const S3_PUBLIC_BASE_URL = (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, '');

const useS3 = !!(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_PUBLIC_BASE_URL);

export const storageBackend = useS3 ? 's3' : 'local';

// Безопасная диагностика конфигурации R2 (БЕЗ самих секретов — только длины/флаги).
// Эталон для R2: keyIdLen=32, secretLen=64, region='auto'. endpointHasBucket должно
// быть false (имя бакета в S3_ENDPOINT — частая ошибка).
export const s3Diag = {
  backend: storageBackend,
  region: S3_REGION,
  keyIdLen: S3_ACCESS_KEY_ID.length,
  secretLen: S3_SECRET_ACCESS_KEY.length,
  endpointHost: (() => { try { return new URL(S3_ENDPOINT).host; } catch { return ''; } })(),
  endpointHasBucket: !!S3_BUCKET && S3_ENDPOINT.includes('/' + S3_BUCKET),
  bucket: S3_BUCKET,
  publicHost: (() => { try { return new URL(S3_PUBLIC_BASE_URL).host; } catch { return ''; } })(),
  keyIdTrimMismatch: S3_ACCESS_KEY_ID !== S3_ACCESS_KEY_ID.trim(),
  secretTrimMismatch: S3_SECRET_ACCESS_KEY !== S3_SECRET_ACCESS_KEY.trim(),
};

const aws = useS3
  ? new AwsClient({ accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY, region: S3_REGION, service: 's3' })
  : null;

// Разрешённые типы и расширения — чтобы не превратить хранилище в свалку.
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export function isAllowedMime(mime: string): boolean {
  return mime in EXT_BY_MIME;
}

/** image | video по MIME (для media_type Threads). */
export function kindOfMime(mime: string): 'image' | 'video' | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

export interface StoredFile {
  url: string; // публичный URL файла
  key: string; // путь/ключ в хранилище
  type: 'image' | 'video';
  mime: string;
  size: number;
}

// Уникальный ключ: uploads/<userId>/<rand>.<ext> — раскладываем по владельцам.
function makeKey(userId: string, mime: string): string {
  const ext = EXT_BY_MIME[mime] || 'bin';
  const rand = crypto.randomBytes(12).toString('hex');
  return `uploads/${userId}/${rand}.${ext}`;
}

/** Сохранить буфер и вернуть публичную ссылку. */
export async function saveUpload(userId: string, buf: Buffer, mime: string): Promise<StoredFile> {
  if (!isAllowedMime(mime)) throw new Error(`Тип файла не поддерживается: ${mime}`);
  const type = kindOfMime(mime)!;
  const key = makeKey(userId, mime);

  if (useS3 && aws) {
    const putUrl = `${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}/${key}`;
    const res = await aws.fetch(putUrl, {
      method: 'PUT',
      body: new Uint8Array(buf),
      headers: { 'Content-Type': mime, 'Content-Length': String(buf.length) },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`S3 PUT ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { url: `${S3_PUBLIC_BASE_URL}/${key}`, key, type, mime, size: buf.length };
  }

  // Локальный бэкенд: пишем на диск, отдаём по /api/media/...
  // URL делаем АБСОЛЮТНЫМ (прямо на бэкенд), если известен публичный адрес — тогда и
  // превью, и серверы Meta грузят медиа напрямую, минуя прокси фронта (у Netlify-функции
  // лимит тела ~6 МБ — большие фото/видео иначе не отдаются). Без публичного адреса
  // (локальная разработка) отдаём относительный путь — фронт проксирует на бэкенд.
  const rel = key.replace(/^uploads\//, '');
  const abs = path.join(LOCAL_UPLOAD_DIR, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  const base = publicApiBase();
  return { url: base ? `${base}/api/media/${rel}` : `/api/media/${rel}`, key, type, mime, size: buf.length };
}

/** Доступен ли прямой (browser → R2) аплоад: только при настроенном S3/R2. */
export const canPresign = useS3;
/** Можно ли листать/чистить хранилище (только R2/S3). */
export const canList = useS3;

/** Список всех объектов бакета (ListObjectsV2, с пагинацией). Только для R2/S3. */
export async function listAllObjects(): Promise<{ key: string; lastModified: number }[]> {
  if (!useS3 || !aws) return [];
  const out: { key: string; lastModified: number }[] = [];
  let token: string | undefined;
  const base = `${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}`;
  // Защита от бесконечного цикла: не больше 100 страниц (×1000 = 100k объектов).
  for (let page = 0; page < 100; page++) {
    const u = new URL(base);
    u.searchParams.set('list-type', '2');
    u.searchParams.set('max-keys', '1000');
    if (token) u.searchParams.set('continuation-token', token);
    const res = await aws.fetch(u.toString(), { method: 'GET' });
    if (!res.ok) throw new Error(`S3 LIST ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const xml = await res.text();
    // Простой разбор без XML-библиотеки: вытаскиваем пары Key + LastModified.
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1];
      const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const lm = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1];
      if (key) out.push({ key: decodeXml(key), lastModified: lm ? Date.parse(lm) : 0 });
    }
    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(xml);
    token = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
    if (!truncated || !token) break;
  }
  return out;
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/**
 * Пресайн PUT для ПРЯМОЙ загрузки файла из браузера в R2 (минуя наш сервер).
 * Так файлы любого размера (200–400 МБ видео) идут напрямую в облако — без лимита
 * прокси фронта и без нагрузки на память сервера. Возвращает временный PUT-URL и
 * итоговый публичный URL. null — если R2 не настроен (тогда грузим через бэкенд).
 */
export async function presignPut(userId: string, mime: string): Promise<{ key: string; putUrl: string; publicUrl: string } | null> {
  if (!useS3 || !aws) return null;
  if (!isAllowedMime(mime)) return null;
  const key = makeKey(userId, mime);
  const objUrl = new URL(`${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}/${key}`);
  objUrl.searchParams.set('X-Amz-Expires', '3600'); // ссылка живёт 1 час
  // signQuery: подпись уходит в query — браузеру не нужны заголовки авторизации.
  // Content-Type НЕ подписываем: браузер проставит его сам из File.type, R2 сохранит.
  const signed = await aws.sign(objUrl.toString(), { method: 'PUT', aws: { signQuery: true } });
  return { key, putUrl: signed.url, publicUrl: `${S3_PUBLIC_BASE_URL}/${key}` };
}

/** Удалить файл по ключу (best-effort, не критично при сбое). */
export async function deleteUpload(key: string): Promise<void> {
  try {
    if (useS3 && aws) {
      const url = `${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}/${key}`;
      await aws.fetch(url, { method: 'DELETE' });
    } else {
      const abs = path.join(LOCAL_UPLOAD_DIR, key.replace(/^uploads\//, ''));
      await fs.unlink(abs).catch(() => {});
    }
  } catch {
    /* best-effort */
  }
}
