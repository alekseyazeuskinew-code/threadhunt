// «Голос бренда» — персонализация ИИ под клиента. Один профиль на пользователя.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';

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
}
