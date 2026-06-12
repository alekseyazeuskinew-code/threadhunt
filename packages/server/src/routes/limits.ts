// Лимиты авто-отбивки — окно настроек. Один набор на аккаунт.
// Жёсткие потолки (анти-бан) применяются на сервере, даже если запросят больше.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULTS = {
  replyDelaySec: 8,
  maxRepliesPerDay: 40,
  maxDialogsPerSweep: 40,
  workingHoursEnabled: false,
  activeFrom: '09:00',
  activeTo: '21:00',
  // Параметры прохода отбивки.
  sweepIntervalMinutes: 180,
  safeMode: false,
  sweepMain: true,
  sweepRequests: true,
  sweepHidden: true,
  runNowAt: null as Date | null,
  researchEnabled: false,
  researchByKeywords: false, // false = искать по названию роли, true = по кодовым словам
};

// Анти-бан потолки: нельзя быстрее/больше/чаще этих значений.
const CAP = { replyDelayMin: 3, repliesMax: 100, dialogsMax: 100, intervalMin: 30 };

export async function limitsRoutes(app: FastifyInstance) {
  app.get('/api/limits', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const l = await db.limits.findUnique({ where: { userId } });
    return { ...DEFAULTS, ...(l || {}), caps: CAP };
  });

  const schema = z.object({
    replyDelaySec: z.number().int().min(CAP.replyDelayMin, `Минимум ${CAP.replyDelayMin} сек между ответами`).max(3600).optional(),
    maxRepliesPerDay: z.number().int().min(0).max(CAP.repliesMax, `Не больше ${CAP.repliesMax}/день — это бережёт аккаунт`).optional(),
    maxDialogsPerSweep: z.number().int().min(1).max(CAP.dialogsMax).optional(),
    workingHoursEnabled: z.boolean().optional(),
    activeFrom: z.string().regex(HHMM).optional(),
    activeTo: z.string().regex(HHMM).optional(),
    // Параметры прохода отбивки.
    sweepIntervalMinutes: z.number().int().min(CAP.intervalMin, `Не чаще раза в ${CAP.intervalMin} мин — это бережёт аккаунт`).max(1440).optional(),
    safeMode: z.boolean().optional(),
    sweepMain: z.boolean().optional(),
    sweepRequests: z.boolean().optional(),
    sweepHidden: z.boolean().optional(),
    researchEnabled: z.boolean().optional(),
    researchByKeywords: z.boolean().optional(),
  });

  app.put('/api/limits', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'bad request' });
    const data = parsed.data;
    const saved = await db.limits.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return { ...saved, caps: CAP };
  });

  // «Прогон сейчас»: ставим метку времени — расширение увидит её в задачах и
  // запустит обход вне расписания (минуя кулдаун). Хотя бы один раздел должен
  // быть выбран, иначе обходить нечего.
  app.post('/api/dm/run-now', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const l = await db.limits.upsert({ where: { userId }, create: { userId, runNowAt: new Date() }, update: { runNowAt: new Date() } });
    return { ok: true, runNowAt: l.runNowAt };
  });

  // «Собрать топ-ветки сейчас»: метка для немедленного research-прохода (минуя 12-часовой
  // кулдаун). Заодно включаем research, если был выключен — чтобы расширение его подхватило.
  app.post('/api/research/run-now', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const l = await db.limits.upsert({
      where: { userId },
      create: { userId, researchEnabled: true, researchRunAt: new Date() },
      update: { researchEnabled: true, researchRunAt: new Date() },
    });
    return { ok: true, researchRunAt: l.researchRunAt };
  });

  // Запросить ХОЛОСТОЙ тест отбивки: расширение прогонит директ, посчитает совпадения,
  // но НИЧЕГО не отправит и не примет. Результат прилетит от расширения.
  app.post('/api/dm/test', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    await db.limits.upsert({ where: { userId }, create: { userId, dmTestAt: new Date() }, update: { dmTestAt: new Date() } });
    return { ok: true };
  });

  // Отменить запрошенный тест отбивки (снять метку, если ещё не выполнился).
  app.post('/api/dm/test-cancel', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    await db.limits.updateMany({ where: { userId }, data: { dmTestAt: null } });
    return { ok: true };
  });

  // Прочитать статус/результат теста отбивки (дашборд опрашивает).
  app.get('/api/dm/test-result', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const l = await db.limits.findUnique({ where: { userId }, select: { dmTestAt: true, lastTestAt: true, lastTestScanned: true, lastTestMatched: true } });
    const device = await db.device.findFirst({ where: { userId }, orderBy: { lastHeartbeat: 'desc' }, select: { lastHeartbeat: true, threadsLoggedIn: true } });
    const online = !!device?.lastHeartbeat && Date.now() - new Date(device.lastHeartbeat).getTime() < 3 * 60_000;
    return {
      pending: !!l?.dmTestAt,
      lastTestAt: l?.lastTestAt ?? null,
      scanned: l?.lastTestScanned ?? 0,
      matched: l?.lastTestMatched ?? 0,
      agent: { online, threadsLoggedIn: !!device?.threadsLoggedIn },
    };
  });
}

// Хелпер для агента: лимиты пользователя с дефолтами.
export async function getUserLimits(userId: string) {
  const l = await db.limits.findUnique({ where: { userId } });
  return { ...DEFAULTS, ...(l || {}) };
}

// Проверить дневной лимит ИИ по тарифу и списать одну генерацию.
import { aiLimitFor, today } from '../ai/limits.js';
export async function consumeAi(userId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  const limit = aiLimitFor(user?.plan);
  if (limit === 0) return { ok: false, status: 403, error: 'ИИ-генерация доступна на тарифах Pro и VIP' };
  const day = today();
  const usage = await db.aiUsage.findUnique({ where: { userId_day: { userId, day } } });
  if ((usage?.count || 0) >= limit) return { ok: false, status: 429, error: `Дневной лимит ИИ исчерпан (${limit}/день).` };
  await db.aiUsage.upsert({ where: { userId_day: { userId, day } }, create: { userId, day, count: 1 }, update: { count: { increment: 1 } } });
  return { ok: true };
}
