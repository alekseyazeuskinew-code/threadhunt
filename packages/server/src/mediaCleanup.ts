// Авто-очистка хранилища медиа (R2/S3).
//
// ЗАЧЕМ: загруженные фото/видео не должны копиться вечно. Удаляем «сироты» — объекты,
// на которые НЕ ссылается ни одна запись в БД (брошенные черновики, удалённые поиски,
// заменённые медиа), и только старше grace-периода (на всякий случай — чтобы не задеть
// только что загруженное, но ещё не сохранённое в пост).
//
// БЕЗОПАСНОСТЬ: множество «используемых» ключей собираем регуляркой из всех полей, где
// может лежать ссылка на медиа. Что в этом множестве — НЕ удаляем никогда. Если сбор
// упал (исключение) — джоба падает целиком и ничего не удаляет.

import { db } from './db.js';
import { canList, listAllObjects, deleteUpload } from './storage.js';

// Ключи вида uploads/<userId>/<rand>.<ext> — вытаскиваем из любого текста/JSON.
const KEY_RE = /uploads\/[A-Za-z0-9_-]+\/[A-Za-z0-9]+\.[A-Za-z0-9]+/g;

function extractKeys(set: Set<string>, text: string | null | undefined) {
  if (!text) return;
  for (const m of text.matchAll(KEY_RE)) set.add(m[0]);
}

// Все ключи медиа, на которые есть ссылки в БД (их трогать нельзя).
async function collectReferencedKeys(): Promise<Set<string>> {
  const set = new Set<string>();

  const posts = await db.postTemplate.findMany({ select: { segmentsJson: true, mediaUrl: true } });
  for (const p of posts) {
    extractKeys(set, p.segmentsJson);
    extractKeys(set, p.mediaUrl);
  }
  const searches = await db.search.findMany({ select: { obFlow: true } });
  for (const s of searches) extractKeys(set, s.obFlow);

  const flows = await db.flowTemplate.findMany({ select: { flow: true } });
  for (const f of flows) extractKeys(set, f.flow);

  const camps = await db.adCampaign.findMany({ select: { mediaUrl: true } });
  for (const c of camps) extractKeys(set, c.mediaUrl);

  const published = await db.publishedPost.findMany({ select: { mediaUrl: true } });
  for (const p of published) extractKeys(set, p.mediaUrl);

  return set;
}

/**
 * Удалить осиротевшие объекты медиа старше graceDays. Возвращает число удалённых.
 * Работает только при настроенном R2/S3 (иначе нечего листать).
 */
export async function cleanupOrphanMedia(graceDays = 14): Promise<number> {
  if (!canList) return 0;

  const objects = await listAllObjects();
  if (!objects.length) return 0;

  const referenced = await collectReferencedKeys();
  const cutoff = Date.now() - graceDays * 24 * 60 * 60 * 1000;

  let deleted = 0;
  for (const o of objects) {
    if (!o.key.startsWith('uploads/')) continue; // чужие объекты не трогаем
    if (o.lastModified && o.lastModified > cutoff) continue; // слишком свежий
    if (referenced.has(o.key)) continue; // используется — не удаляем
    await deleteUpload(o.key);
    deleted++;
  }
  return deleted;
}
