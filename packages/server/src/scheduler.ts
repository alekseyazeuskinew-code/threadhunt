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
import { applyPostWatermark } from './branding.js';
import { resolveConnection } from './threads/resolve.js';
import { sendEmail, renderEmailHtml } from './email.js';
import { resolveRecipients, parseSegment, personalizeStep, usesPromoVar } from './emailAudience.js';
import { ensurePromoForEmail } from './promoCodes.js';
import { tgSend, tgEnabled } from './telegram.js';
import { cleanupOrphanMedia } from './mediaCleanup.js';

let running = false;
let dripRunning = false;
let commentsRunning = false;
let remindersRunning = false;
let tgSummaryRunning = false;
let mediaCleanupRunning = false;

export function startScheduler() {
  setInterval(tick, 60_000); // автопостинг — каждую минуту
  tick(); // и сразу при старте
  setInterval(dripTick, 5 * 60_000); // email-цепочки — каждые 5 минут
  setTimeout(dripTick, 15_000); // и вскоре после старта
  setInterval(commentTick, 4 * 60_000); // отбивка в комментариях — каждые 4 минуты
  setTimeout(commentTick, 30_000); // и вскоре после старта
  setInterval(onbReminderTick, 15 * 60_000); // напоминания о дедлайне теста — каждые 15 минут
  setTimeout(onbReminderTick, 45_000); // и вскоре после старта
  setInterval(tgSummaryTick, 30 * 60_000); // ежедневная Telegram-сводка — проверка каждые 30 минут
  setTimeout(tgSummaryTick, 60_000); // и вскоре после старта
  setInterval(mediaCleanupTick, 24 * 60 * 60_000); // чистка осиротевшего медиа — раз в сутки
  setTimeout(mediaCleanupTick, 10 * 60_000); // и через 10 мин после старта
  console.log('🕒 Планировщик запущен (автопостинг + email-цепочки + комментарии + напоминания + telegram-сводки + чистка медиа)');
}

// Чистка осиротевшего медиа в R2: удаляем объекты без ссылок в БД старше 14 дней.
async function mediaCleanupTick() {
  if (mediaCleanupRunning) return;
  mediaCleanupRunning = true;
  try {
    const deleted = await cleanupOrphanMedia(14);
    if (deleted) console.log(`🧹 Медиа-очистка: удалено осиротевших объектов — ${deleted}`);
  } catch (e) {
    console.error('[scheduler] mediaCleanup error:', (e as Error).message);
  } finally {
    mediaCleanupRunning = false;
  }
}

// Ежедневная Telegram-сводка владельцам: раз в день (после 8:00 UTC), анти-дубль по дате.
async function tgSummaryTick() {
  if (tgSummaryRunning || !tgEnabled()) return;
  tgSummaryRunning = true;
  try {
    const now = new Date();
    if (now.getUTCHours() < 8) return; // не будим ночью
    const today = now.toISOString().slice(0, 10);
    const users = await db.user.findMany({
      where: { telegramChatId: { not: null }, tgDailySummary: true, NOT: { tgSummarySentOn: today } },
      select: { id: true, telegramChatId: true },
      take: 500,
    });
    const since = new Date(Date.now() - 24 * 3600_000);
    for (const u of users) {
     try {
      const [newLeads, submitted, overdue, hired, screening] = await Promise.all([
        db.lead.count({ where: { userId: u.id, createdAt: { gte: since } } }),
        db.lead.count({ where: { userId: u.id, testSubmittedAt: { gte: since } } }),
        db.lead.count({ where: { userId: u.id, stage: 'SCREENING', testSubmittedAt: null, testDeadlineAt: { lt: now } } }),
        db.lead.count({ where: { userId: u.id, stage: 'HIRED' } }),
        db.lead.count({ where: { userId: u.id, stage: 'SCREENING' } }),
      ]);
      const lines = [
        '📊 <b>Сводка Threadhunt за сутки</b>',
        `🆕 Новых кандидатов: <b>${newLeads}</b>`,
        `✅ Сдали тест: <b>${submitted}</b>`,
        `🧪 На тесте/собесе: <b>${screening}</b>`,
        overdue > 0 ? `⏰ Просрочено тестов: <b>${overdue}</b>` : '',
        `👥 В команде всего: <b>${hired}</b>`,
      ].filter(Boolean);
      await tgSend(u.telegramChatId!, lines.join('\n'));
      await db.user.update({ where: { id: u.id }, data: { tgSummarySentOn: today } }).catch(() => {});
     } catch (e) {
       console.error('[scheduler] tgSummary user error:', (e as Error).message);
     }
    }
  } catch (e) {
    console.error('[scheduler] tgSummary error:', (e as Error).message);
  } finally {
    tgSummaryRunning = false;
  }
}

// Авто-напоминания кандидату на email о дедлайне тестового — поднимают доходимость.
// Кандидат оставил email на 1-м шаге, но не сдал тест → шлём 1-2 деликатных письма
// с обратным отсчётом и ссылкой. Анти-спам: не чаще раза в час, максимум 2 письма.
async function onbReminderTick() {
  if (remindersRunning) return;
  remindersRunning = true;
  try {
    if (!process.env.RESEND_API_KEY) return; // без почтового ключа слать нечем
    const webOrigin = (process.env.WEB_ORIGIN || '').replace(/\/$/, '');
    const now = Date.now();
    const leads = await db.lead.findMany({
      where: {
        onboardToken: { not: null },
        testDeadlineAt: { not: null, gt: new Date() }, // дедлайн ещё впереди
        testSubmittedAt: null, // ещё не сдал
        candidateContact: { contains: '@' }, // оставил похожее на email
      },
      include: { search: { select: { title: true, obFlow: true, obRemindersEnabled: true } } },
      take: 300,
    });
    const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    for (const l of leads) {
      const s = l.search;
      if (!s?.obRemindersEnabled) continue;
      if (l.obLastReminderAt && now - new Date(l.obLastReminderAt).getTime() < 60 * 60_000) continue; // не чаще раза в час
      const email = (l.candidateContact || '').trim();
      if (!EMAIL_RX.test(email)) continue;
      // завершил ли флоу? (obStep дошёл до числа страниц)
      const pages = pageCount(s.obFlow);
      if (pages && l.obStep >= pages) continue;
      const hLeft = (new Date(l.testDeadlineAt!).getTime() - now) / 3600_000;
      const count = l.obReminderCount || 0;
      // 1-е письмо — когда осталось ≤24ч, 2-е — когда ≤4ч. Больше двух не шлём.
      const shouldRemind = (count === 0 && hLeft <= 24) || (count === 1 && hLeft <= 4);
      if (!shouldRemind) continue;
      const link = webOrigin ? `${webOrigin}/c/${l.onboardToken}` : '';
      const res = await sendEmail({
        to: email,
        subject: `Напоминание: тестовое по «${s.title}» — осталось ~${Math.max(1, Math.round(hLeft))} ч`,
        html: reminderHtml({ role: s.title, link, deadline: l.testDeadlineAt!, name: l.candidateName }),
      });
      // и при успехе, и при ошибке ставим метку времени, чтобы не долбить каждые 15 мин;
      // счётчик растёт только при реальной отправке.
      await db.lead
        .update({ where: { id: l.id }, data: { obLastReminderAt: new Date(), ...(res.ok ? { obReminderCount: count + 1 } : {}) } })
        .catch(() => {});
    }
  } catch (e) {
    console.error('[reminders] tick error:', (e as Error).message);
  } finally {
    remindersRunning = false;
  }
}

function pageCount(obFlow: string | null): number {
  if (!obFlow) return 0;
  try {
    const f = JSON.parse(obFlow);
    return Array.isArray(f?.pages) ? f.pages.length : 0;
  } catch {
    return 0;
  }
}

function reminderHtml({ role, link, deadline, name }: { role: string; link: string; deadline: Date; name: string | null }): string {
  const when = new Date(deadline).toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  const hi = name ? `Привет, ${name}!` : 'Привет!';
  const btn = link
    ? `<div style="text-align:center;margin:22px 0 6px"><a href="${link}" style="display:inline-block;background:#6d5cf6;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:12px;font-size:15px">Продолжить и сдать тест</a></div>`
    : '';
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:8px">
    <p style="font-size:16px;color:#16151c;margin:0 0 8px"><b>${hi}</b></p>
    <p style="font-size:15px;line-height:1.6;color:#333;margin:0">Ты начал(а) отклик на роль <b>${role}</b>, но ещё не сдал(а) тестовое. Дедлайн — <b>${when}</b>. Успеешь? 🙌</p>
    ${btn}
    <p style="font-size:13px;color:#888;margin:14px 0 0">Если уже не актуально — просто проигнорируй это письмо.</p>
  </div>`;
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
      // Интервал считаем по последней ПОПЫТКЕ (ok ИЛИ ошибка) — иначе при постоянных
      // сбоях (напр. недоступное медиа) не было бы «последнего успешного», и планировщик
      // долбил бы Threads каждую минуту. Так неудача тоже выдерживает паузу.
      const last = await db.publishedPost.findFirst({
        where: { searchId: cfg.searchId },
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
    // FREE-тариф: добавляем вотермарк к последнему сегменту (клиент убрать не может).
    const owner = await db.user.findUnique({ where: { id: search.userId }, select: { plan: true } });
    if (segments.length) {
      const last = segments[segments.length - 1];
      last.text = applyPostWatermark(last.text || '', owner?.plan);
    }
    const res = await publishChain(token, conn.threadsUserId, segments);
    const rootMedia = segments[0]?.media?.[0]?.url ?? tpl.mediaUrl ?? null;
    await db.publishedPost.create({
      data: { searchId, threadsPostId: res.id, permalink: res.permalink, text: (segments[0]?.text || tpl.text || '').slice(0, 500), mediaType: res.mediaType, mediaUrl: rootMedia, ok: true },
    });
    await db.publishConfig.update({
      where: { id: cfg.id },
      data: { nextIndex: (idx + 1) % search.postTemplates.length },
    });
    return { ok: true, permalink: res.permalink };
  } catch (err: any) {
    const error = String(err?.message || err);
    // text может быть null (карусель/цепочка хранится в segmentsJson) — иначе сам catch
    // упадёт на .slice и наружу улетит 500, скрыв реальную ошибку Threads.
    await db.publishedPost.create({
      data: { searchId, text: (tpl.text || '').slice(0, 500), ok: false, error },
    });
    return { ok: false, error };
  }
}
