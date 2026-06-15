// «Голос бренда» — персонализация ИИ под клиента. Один профиль на пользователя.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';
import { textFromUrl, textFromPdfBuffer } from '../extract.js';
import { extractBrandVoice } from '../ai/generate.js';
import { consumeAi } from './limits.js';

const schema = z.object({
  companyName: z.string().max(120).optional(),
  niche: z.string().max(160).optional(),
  social: z.string().max(200).optional(),
  about: z.string().max(500).optional(),
  tone: z.string().max(300).optional(),
  audience: z.string().max(300).optional(),
  perks: z.string().max(500).optional(),
  signature: z.string().max(300).optional(),
  sample: z.string().max(1000).optional(),
  avoid: z.string().max(300).optional(),
  teamContacts: z.string().max(4000).optional(), // JSON [{name, telegram}] — контакты для отбивки
});

export async function brandRoutes(app: FastifyInstance) {
  app.get('/api/brand-profile', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const p = await db.brandProfile.findUnique({ where: { userId } });
    return p || { companyName: '', niche: '', social: '', about: '', tone: '', audience: '', perks: '', signature: '', sample: '', avoid: '' };
  });

  app.put('/api/brand-profile', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const data = parsed.data;
    return db.brandProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  });

  // Авто-сбор голоса бренда из ССЫЛКИ (сайт/презентация/PDF). Возвращает поля для
  // заполнения формы (НЕ сохраняет — клиент проверит и отредактирует).
  app.post('/api/brand-profile/autofill', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = z.object({ url: z.string().url() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажи корректную ссылку (http/https)' });
    const ai = await consumeAi(userId);
    if (!ai.ok) return reply.code(ai.status || 403).send({ error: ai.error });
    let text: string;
    try {
      text = await textFromUrl(parsed.data.url);
    } catch (e: any) {
      return reply.code(422).send({ error: String(e?.message || 'Не удалось прочитать источник') });
    }
    if (text.trim().length < 40) return reply.code(422).send({ error: 'В источнике слишком мало текста для анализа.' });
    const { data, source } = await extractBrandVoice(text);
    return { data, source };
  });

  // Авто-сбор из загруженного PDF (multipart, поле file).
  app.post('/api/brand-profile/autofill-file', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    let fileData: any;
    try {
      fileData = await (req as any).file();
    } catch {
      return reply.code(400).send({ error: 'Не удалось прочитать файл' });
    }
    if (!fileData) return reply.code(400).send({ error: 'Файл не передан' });
    if (!/pdf/i.test(fileData.mimetype || '')) return reply.code(415).send({ error: 'Нужен PDF-файл' });
    const buf = await fileData.toBuffer().catch(() => null);
    if (!buf || !buf.length) return reply.code(400).send({ error: 'Пустой файл' });
    const ai = await consumeAi(userId);
    if (!ai.ok) return reply.code(ai.status || 403).send({ error: ai.error });
    let text: string;
    try {
      text = await textFromPdfBuffer(buf);
    } catch (e: any) {
      return reply.code(422).send({ error: 'Не удалось извлечь текст из PDF: ' + String(e?.message || '').slice(0, 120) });
    }
    if (text.trim().length < 40) return reply.code(422).send({ error: 'В PDF слишком мало текста для анализа.' });
    const { data, source } = await extractBrandVoice(text);
    return { data, source };
  });
}
