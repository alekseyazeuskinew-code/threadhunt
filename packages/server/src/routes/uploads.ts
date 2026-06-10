// Загрузка медиа (фото/видео) прямо в дашборд → публичный URL для постов.
// Multipart: одно поле `file`. Возвращаем { url, type } — то, что нужно Threads API
// (image_url/video_url) и для превью в дашборде. Лимит размера задаётся при
// регистрации @fastify/multipart в index.ts.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUserId } from '../auth/session.js';
import { saveUpload, isAllowedMime, storageBackend } from '../storage.js';

export async function uploadRoutes(app: FastifyInstance) {
  const requireUser = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return userId;
  };

  app.post('/api/uploads', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;

    let data;
    try {
      data = await (req as any).file(); // @fastify/multipart
    } catch (e: any) {
      // Превышение лимита размера приходит сюда (FST_REQ_FILE_TOO_LARGE).
      const tooBig = String(e?.code || '').includes('FILE_TOO_LARGE') || String(e?.message || '').includes('too large');
      return reply.code(tooBig ? 413 : 400).send({ error: tooBig ? 'Файл слишком большой' : 'Не удалось прочитать файл' });
    }
    if (!data) return reply.code(400).send({ error: 'Файл не передан (поле file)' });

    const mime = data.mimetype || '';
    if (!isAllowedMime(mime)) {
      return reply.code(415).send({ error: 'Поддерживаются JPG, PNG, WEBP, GIF, MP4, MOV' });
    }

    let buf: Buffer;
    try {
      buf = await data.toBuffer();
    } catch (e: any) {
      const tooBig = String(e?.code || '').includes('FILE_TOO_LARGE');
      return reply.code(tooBig ? 413 : 400).send({ error: tooBig ? 'Файл слишком большой' : 'Ошибка чтения файла' });
    }
    if (!buf.length) return reply.code(400).send({ error: 'Пустой файл' });

    try {
      const stored = await saveUpload(userId, buf, mime);
      return { url: stored.url, type: stored.type, size: stored.size, backend: storageBackend };
    } catch (e: any) {
      app.log.error({ err: e }, 'upload failed');
      return reply.code(500).send({ error: 'Не удалось сохранить файл: ' + (e?.message || 'ошибка хранилища') });
    }
  });
}
