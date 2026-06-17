// Загрузка медиа (фото/видео) прямо в дашборд → публичный URL для постов.
// Multipart: одно поле `file`. Возвращаем { url, type } — то, что нужно Threads API
// (image_url/video_url) и для превью в дашборде. Лимит размера задаётся при
// регистрации @fastify/multipart в index.ts.
//
// ВАЖНО (Netlify): фронт проксирует /api/* через функцию с лимитом тела ~6 МБ, из-за
// чего файлы падали с 500. Поэтому файл грузится ПРЯМО на бэкенд: фронт сначала берёт
// upload-ticket (мелкий JSON через прокси), затем шлёт файл напрямую с тикетом.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUserId } from '../auth/session.js';
import { saveUpload, isAllowedMime, storageBackend, presignPut, canPresign } from '../storage.js';
import { makeUploadTicket, verifyUploadTicket, publicApiBase } from '../uploadTicket.js';

export async function uploadRoutes(app: FastifyInstance) {
  const requireUser = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const userId = getUserId(app, req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return userId;
  };

  // Пресайн для ПРЯМОЙ загрузки браузер → R2 (без лимита размера, мимо сервера).
  // Если R2 не настроен — отдаём 409 'no-r2', клиент откатывается на загрузку через бэкенд.
  app.post('/api/uploads/presign', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    if (!canPresign) return reply.code(409).send({ error: 'no-r2' });
    const mime = (req.body as any)?.mime as string | undefined;
    if (!mime || !isAllowedMime(mime)) return reply.code(415).send({ error: 'Поддерживаются JPG, PNG, WEBP, GIF, MP4, MOV' });
    const p = await presignPut(userId, mime);
    if (!p) return reply.code(409).send({ error: 'no-r2' });
    return { putUrl: p.putUrl, publicUrl: p.publicUrl, key: p.key, backend: 's3' };
  });

  // Выдать тикет на прямую загрузку + абсолютный адрес, куда слать файл.
  app.post('/api/uploads/ticket', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const base = publicApiBase();
    return {
      ticket: makeUploadTicket(userId),
      // Пусто base (dev/локально) → относительный путь через прокси (там лимита нет).
      uploadUrl: base ? `${base}/api/uploads` : '/api/uploads',
    };
  });

  app.post('/api/uploads', async (req, reply) => {
    // Прямая загрузка идёт кросс-доменно (фронт → бэкенд). multipart/form-data —
    // CORS-safelisted (без preflight), нужен лишь ACAO в ответе. Ставим его явно,
    // чтобы не зависеть от точного WEB_ORIGIN: авторизация тут по подписанному тикету.
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
    }

    // Аутентификация: либо сессия (cookie, тот же домен), либо подписанный тикет
    // (прямая кросс-доменная загрузка с фронта на Netlify).
    const ticket = (req.query as any)?.ticket as string | undefined;
    const userId = ticket ? verifyUploadTicket(ticket) : getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: ticket ? 'Тикет загрузки истёк — обновите страницу' : 'unauthorized' });

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
