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

  // Локальный бэкенд: пишем на диск, отдаём по ОТНОСИТЕЛЬНОМУ /api/media/...
  // Относительный путь грузится с того же домена, что и дашборд (Next проксирует
  // /api/* на бэкенд), поэтому ПРЕВЬЮ работает без всякой настройки доменов.
  // Для публикации в Threads абсолютный URL достраивает publisher (PUBLIC_BASE_URL).
  const rel = key.replace(/^uploads\//, '');
  const abs = path.join(LOCAL_UPLOAD_DIR, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  return { url: `/api/media/${rel}`, key, type, mime, size: buf.length };
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
