// Встроенный планировщик автопостинга (вместо отдельного worker + Redis).
// Раз в минуту проверяет активные расписания и публикует, что пора. Логика —
// порт из прототипа server.js (setInterval), но мультиарендно и через API Threads.
//
// Это «исполнитель правил»: само правило (раз в N минут, не больше M в день) лежит
// в PublishConfig, а планировщик в нужный момент реально вызывает Threads API.

import { db } from './db.js';
import { decrypt } from './crypto.js';
import { publishPost, type MediaType } from './threads/publisher.js';
import { resolveConnection } from './threads/resolve.js';

let running = false;

export function startScheduler() {
  setInterval(tick, 60_000); // каждую минуту
  tick(); // и сразу при старте
  console.log('🕒 Планировщик автопостинга запущен (внутри API, без Redis)');
}

async function tick() {
  if (running) return; // не накладываем проходы друг на друга
  running = true;
  try {
    const configs = await db.publishConfig.findMany({
      where: { enabled: true, search: { status: 'ACTIVE' } },
    });
    const now = Date.now();
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    for (const cfg of configs) {
      const last = await db.publishedPost.findFirst({
        where: { searchId: cfg.searchId, ok: true },
        orderBy: { createdAt: 'desc' },
      });
      if (last && now - last.createdAt.getTime() < cfg.intervalMinutes * 60_000) continue; // ещё не пора

      const todayCount = await db.publishedPost.count({
        where: { searchId: cfg.searchId, ok: true, createdAt: { gte: since } },
      });
      if (todayCount >= cfg.maxPerDay) continue; // дневной лимит

      await publishForSearch(cfg.searchId);
    }
  } catch (e) {
    console.error('[scheduler] tick error:', (e as Error).message);
  } finally {
    running = false;
  }
}

// Опубликовать один пост за поиск (следующий по ротации). Вызывается и
// планировщиком по расписанию, и вручную с кнопки «Опубликовать сейчас».
// Возвращает результат, чтобы UI мог показать ссылку или ошибку.
export type PublishResult = { ok: boolean; permalink?: string | null; error?: string };

export async function publishForSearch(searchId: string): Promise<PublishResult> {
  const search = await db.search.findUnique({
    where: { id: searchId },
    include: { postTemplates: { orderBy: { order: 'asc' } }, publishConfig: true, connection: true },
  });
  if (!search || !search.postTemplates.length) return { ok: false, error: 'Нет шаблонов постов' };
  if (!search.publishConfig) return { ok: false, error: 'Нет настроек публикации' };
  const conn = await resolveConnection(search);
  if (!conn?.accessTokenEnc) return { ok: false, error: 'Нет подключённого Threads-аккаунта' };

  const cfg = search.publishConfig;
  let idx = cfg.nextIndex || 0;
  if (cfg.rotation === 'random') idx = Math.floor(Math.random() * search.postTemplates.length);
  const tpl = search.postTemplates[idx % search.postTemplates.length];

  const token = decrypt(conn.accessTokenEnc);
  try {
    const res = await publishPost(token, conn.threadsUserId, {
      text: tpl.text,
      mediaUrl: tpl.mediaUrl ?? undefined,
      mediaType: (tpl.mediaType as MediaType) ?? '',
    });
    await db.publishedPost.create({
      data: { searchId, threadsPostId: res.id, permalink: res.permalink, text: tpl.text.slice(0, 500), mediaType: res.mediaType, mediaUrl: tpl.mediaUrl ?? null, ok: true },
    });
    await db.publishConfig.update({
      where: { id: cfg.id },
      data: { nextIndex: (idx + 1) % search.postTemplates.length },
    });
    return { ok: true, permalink: res.permalink };
  } catch (err: any) {
    const error = String(err?.message || err);
    await db.publishedPost.create({
      data: { searchId, text: tpl.text.slice(0, 500), ok: false, error },
    });
    return { ok: false, error };
  }
}
