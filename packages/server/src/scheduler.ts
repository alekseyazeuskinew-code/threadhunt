// Встроенный планировщик автопостинга (вместо отдельного worker + Redis).
// Раз в минуту проверяет активные расписания и публикует, что пора. Логика —
// порт из прототипа server.js (setInterval), но мультиарендно и через API Threads.
//
// Это «исполнитель правил»: само правило (раз в N минут, не больше M в день) лежит
// в PublishConfig, а планировщик в нужный момент реально вызывает Threads API.

import { db } from './db.js';
import { decrypt } from './crypto.js';
import { publishChain, fetchReplies, publishReply } from './threads/publisher.js';
import { parseSegments } from './threads/segments.js';
import { resolveConnection } from './threads/resolve.js';
import { sendEmail, renderEmailHtml } from './email.js';
import { resolveRecipients, parseSegment, personalizeStep, usesPromoVar } from './emailAudience.js';
import { ensurePromoForEmail } from './promoCodes.js';

let running = false;
let dripRunning = false;
let commentsRunning = false;

export function startScheduler() {
  setInterval(tick, 60_000); // автопостинг — каждую минуту
  tick(); // и сразу при старте
  setInterval(dripTick, 5 * 60_000); // email-цепочки — каждые 5 минут
  setTimeout(dripTick, 15_000); // и вскоре после старта
  setInterval(commentTick, 4 * 60_000); // отбивка в комментариях — каждые 4 минуты
  setTimeout(commentTick, 30_000); // и вскоре после старта
  console.log('🕒 Планировщик запущен (автопостинг + email-цепочки + комментарии, внутри API)');
}

// Авто-отбивка в комментариях через Threads API: под каждым нашим недавним постом
// ищем новые ответы и публикуем ответ по правилу (keyword — только с кодовым
// словом; all — на любой комментарий). Дедуп по CommentReply. Бюджет на проход.
// GRACEFUL: нет токена/scope (до одобрения Meta) — просто пропускаем без ошибок.
async function commentTick() {
  if (commentsRunning) return;
  commentsRunning = true;
  try {
    const rules = await db.commentRule.findMany({
      where: { enabled: true, search: { status: 'ACTIVE' } },
      include: { search: { include: { keywords: true, connection: true } } },
    });
    let budget = 30; // максимум ответов за один проход
    const since = new Date(Date.now() - 7 * 86_400_000);
    for (const rule of rules) {
      if (budget <= 0) break;
      if (!rule.replyText.trim()) continue;
      const search = rule.search;
      const conn = await resolveConnection(search);
      if (!conn?.accessTokenEnc) continue; // нет подключённого OAuth-аккаунта
      let token: string;
      try {
        token = decrypt(conn.accessTokenEnc);
      } catch {
        continue;
      }
      const keywords = (search.keywords || []).map((k) => k.text.toLowerCase()).filter(Boolean);
      // недавние успешно опубликованные посты этого поиска
      const posts = await db.publishedPost.findMany({
        where: { searchId: search.id, ok: true, threadsPostId: { not: null }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 15,
      });
      for (const post of posts) {
        if (budget <= 0) break;
        let replies;
        try {
          replies = await fetchReplies(token, post.threadsPostId!);
        } catch {
          break; // нет доступа (scope/срок токена) — дальше по этому поиску нет смысла
        }
        for (const rep of replies) {
          if (budget <= 0) break;
          if (!rep.id) continue;
          if (rep.username && conn.username && rep.username.toLowerCase() === conn.username.toLowerCase()) continue; // наш же ответ
          const text = (rep.text || '').toLowerCase();
          if (rule.mode === 'keyword' && keywords.length && !keywords.some((k) => text.includes(k))) continue;
          // дедуп: уже отвечали на этот комментарий?
          const seen = await db.commentReply.findUnique({ where: { replyId: rep.id } });
          if (seen) continue;
          try {
            await publishReply(token, conn.threadsUserId, rep.id, rule.replyText);
            await db.commentReply.create({ data: { searchId: search.id, replyId: rep.id } });
            budget--;
          } catch {
            // конкретный ответ не прошёл — помечаем как обработанный, чтобы не долбить
            await db.commentReply.create({ data: { searchId: search.id, replyId: rep.id } }).catch(() => {});
          }
        }
      }
    }
  } catch (e) {
    console.error('[comments] tick error:', (e as Error).message);
  } finally {
    commentsRunning = false;
  }
}

// Drip email-цепочек для новых пользователей: каждому подходящему юзеру шлём
// следующий неотправленный шаг, когда подошёл его срок (delayHours от якоря:
// для шага 0 — регистрация, дальше — отправка предыдущего шага). Один шаг на
// юзера за тик, с общим бюджетом писем (бережём rate-limit Resend).
async function dripTick() {
  if (dripRunning) return;
  dripRunning = true;
  try {
    const seqs = await db.emailSequence.findMany({ where: { enabled: true } }); // обе аудитории
    let budget = 20; // максимум писем за один проход
    for (const seq of seqs) {
      let steps: { delayHours?: number; subject?: string; blocks?: unknown[] }[] = [];
      try {
        steps = JSON.parse(seq.steps || '[]');
      } catch {
        continue;
      }
      if (!steps.length) continue;
      // Получатели = базовый список (по аудитории) + сегмент-фильтры цепочки.
      // Не бластим тех, кто появился раньше создания цепочки (createdAfter).
      const seg = parseSegment((seq as any).segment);
      const recipients = await resolveRecipients(seq.audience, seg, { createdAfter: seq.createdAt });
      const needPromo = seq.audience === 'waitlist' && usesPromoVar(steps as any);
      for (const rec of recipients) {
        if (budget <= 0) return;
        if (!rec.email || !rec.email.includes('@')) continue;
        const sent = await db.emailDrip.findMany({ where: { userId: rec.key, sequenceId: seq.id }, select: { stepIndex: true, sentAt: true } });
        const sentIdx = new Set(sent.map((s) => s.stepIndex));
        let nextIdx = 0;
        while (sentIdx.has(nextIdx)) nextIdx++;
        if (nextIdx >= steps.length) continue; // вся цепочка отправлена
        const step = steps[nextIdx];
        const anchor = nextIdx === 0 ? rec.createdAt : sent.find((s) => s.stepIndex === nextIdx - 1)?.sentAt;
        if (!anchor) continue;
        if (Date.now() < anchor.getTime() + (step.delayHours || 0) * 3600_000) continue; // ещё не пора
        // Персонализация: {{promo}} (выдаём код на лету, если нужно) / {{name}} / {{email}}.
        const promo = needPromo ? rec.promoCode || (await ensurePromoForEmail(rec.email)) : rec.promoCode || '';
        const vars = { promo: promo || '', name: rec.name || '', email: rec.email };
        const pers = personalizeStep(step as any, vars);
        const r = await sendEmail({ to: rec.email, subject: pers.subject || 'Threadhunt', html: renderEmailHtml(pers.blocks) });
        if (r.ok) {
          await db.emailDrip.create({ data: { userId: rec.key, sequenceId: seq.id, stepIndex: nextIdx } });
          budget--;
        } else if (r.error && r.error.includes('RESEND_API_KEY')) {
          return; // провайдер не настроен — выходим, не долбим
        } else {
          continue; // конкретный адрес не принят — пропускаем, не блокируем остальных
        }
      }
    }
  } catch (e) {
    console.error('[drip] tick error:', (e as Error).message);
  } finally {
    dripRunning = false;
  }
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
    // Публикуем цепочку: корневой пост + ветки-ответы (или просто один пост).
    const segments = parseSegments(tpl);
    const res = await publishChain(token, conn.threadsUserId, segments);
    const rootMedia = segments[0]?.media?.[0]?.url ?? tpl.mediaUrl ?? null;
    await db.publishedPost.create({
      data: { searchId, threadsPostId: res.id, permalink: res.permalink, text: (segments[0]?.text || tpl.text).slice(0, 500), mediaType: res.mediaType, mediaUrl: rootMedia, ok: true },
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
