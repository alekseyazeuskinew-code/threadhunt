// Демо-данные для ТЕКУЩЕГО аккаунта — кнопка «Заполнить демо» в пустом дашборде.
// Создаёт демо-поиск с кандидатами по всем стадиям (со всеми полями цикла),
// чтобы пользователь сразу увидел, как работает CRM. Идемпотентно: повторный
// вызов не плодит дубликаты.

import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { getUserId } from '../auth/session.js';

export async function demoRoutes(app: FastifyInstance) {
  app.post('/api/demo/seed', async (req, reply) => {
    const userId = getUserId(app, req);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const TITLE = 'Демо: Видеомонтажёр';
    let search = await db.search.findFirst({ where: { userId, title: TITLE } });
    if (!search) {
      search = await db.search.create({
        data: {
          userId,
          title: TITLE,
          description: 'Демо-воронка: монтаж Reels/Shorts, удалёнка, сдельно.',
          status: 'ACTIVE',
          obEnabled: true,
          obConditions: 'Удалёнка, поток роликов, оплата сдельно, быстрые выплаты.',
          obTestTask: 'Смонтируй один Reel (15–30 сек) по референсу. Срок 2 часа, сдай ссылкой.',
          obNda: 'На тестовый период не передаю исходники третьим лицам.',
          goalEnabled: true,
          goalHires: 3,
          goalConversion: 10,
          goalDueAt: new Date(Date.now() + 21 * 86400_000),
          goalStartedAt: new Date(Date.now() - 9 * 86400_000),
          keywords: { create: [{ text: 'монтаж' }, { text: 'монтажёр' }] },
          replyTemplates: { create: [{ text: 'Привет! Спасибо за отклик 🙌 Напиши в Telegram @hr_demo — пришлю детали.', redirectTarget: '@hr_demo', order: 0 }] },
          postTemplates: { create: [{ text: 'Ищу монтажёра Reels. Пиши «монтаж» в директ 👇', order: 0 }] },
          publishConfig: { create: { enabled: false } },
        },
      });
    }

    const existing = await db.lead.count({ where: { searchId: search.id } });
    if (existing > 0) return { ok: true, already: true, searchId: search.id };

    const now = Date.now();
    const h = (n: number) => new Date(now - n * 3600_000);
    const inH = (n: number) => new Date(now + n * 3600_000);
    const mk = (data: any, comment?: string) =>
      db.lead
        .create({ data: { userId, searchId: search!.id, status: 'REPLIED', matchedKeyword: 'монтаж', section: 'requests', ...data } })
        .then((l) => (comment ? db.leadComment.create({ data: { leadId: l.id, body: comment } }) : null));

    await Promise.all([
      mk({ fromUserKey: `${userId}-1`, fromUsername: 'pro_editor99', section: 'hidden', stage: 'NEW', createdAt: h(2) }),
      mk({ fromUserKey: `${userId}-2`, fromUsername: 'kat_video', section: 'main', status: 'FAILED', stage: 'NEW', createdAt: h(40) }),
      mk({ fromUserKey: `${userId}-3`, fromUsername: 'editor_max', stage: 'CONTACTED', rating: 3, contact: '@hr_demo', conditionsSentAt: h(4), createdAt: h(6) }, 'Ответил, скинул условия — ждём тест.'),
      mk({ fromUserKey: `${userId}-4`, fromUsername: 'anna.cuts', stage: 'SCREENING', rating: 4, contact: '@hr_demo', conditionsSentAt: h(3), testSentAt: h(1), testDeadlineAt: inH(1), createdAt: h(5) }, 'Выдал тестовое — таймер пошёл.'),
      mk({ fromUserKey: `${userId}-5`, fromUsername: 'slow_cuts', stage: 'SCREENING', rating: 2, contact: '@hr_demo', conditionsSentAt: h(8), testSentAt: h(6), testDeadlineAt: h(4), createdAt: h(10) }, 'Тест просрочен.'),
      mk({ fromUserKey: `${userId}-6`, fromUsername: 'reels_master', stage: 'SCREENING', rating: 5, contact: '@hr_demo', conditionsSentAt: h(7), testSentAt: h(6), testDeadlineAt: h(4), testSubmittedUrl: 'https://drive.google.com/демо-тест', testSubmittedAt: h(5), createdAt: h(9) }, 'Сдал быстро, монтаж чистый — берём!'),
      mk({ fromUserKey: `${userId}-7`, fromUsername: 'reels_pro', section: 'hidden', stage: 'HIRED', rating: 5, contact: '@hr_demo', role: 'Монтажёр Reels', rate: '500 ₽/ролик', startedAt: h(20), createdAt: h(30) }, 'В команде 🎉'),
      mk({ fromUserKey: `${userId}-8`, fromUsername: 'editor_kg', stage: 'BENCH', rating: 3, contact: '@hr_demo', nextTouchAt: inH(24 * 7), createdAt: h(48) }, 'В резерв — напомнить через неделю.'),
      mk({ fromUserKey: `${userId}-9`, fromUsername: 'cheap_cuts', stage: 'REJECTED', rating: 2, contact: '@hr_demo', decisionReason: 'Дорого', createdAt: h(60) }, 'Ставка выше бюджета.'),
    ]);

    // история публикаций (с превью и ссылками) для демонстрации
    await db.publishedPost.createMany({
      data: [
        { searchId: search!.id, text: 'Ищу монтажёра Reels на поток 🎬\nУдалёнка, сдельно, быстрые выплаты. Пиши «монтаж» в директ.', mediaType: 'text', permalink: 'https://www.threads.net/@demo/post/abc1', threadsPostId: 'demo_abc1', ok: true, createdAt: h(2) },
        { searchId: search!.id, text: 'Нужен видеомонтажёр в команду. Покажи шоурил — отвечаю всем по слову «reels».', mediaType: 'image', mediaUrl: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400', permalink: 'https://www.threads.net/@demo/post/abc2', threadsPostId: 'demo_abc2', ok: true, createdAt: h(8) },
        { searchId: search!.id, text: 'Старый текст приманки (упал на публикации).', mediaType: 'text', ok: false, error: 'Threads API 400: токен истёк', createdAt: h(14) },
      ],
    });

    // демо-кампании (рекламные связки) — черновик + на модерации
    const camps = await db.adCampaign.count({ where: { searchId: search!.id } });
    if (camps === 0) {
      await db.adCampaign.createMany({
        data: [
          {
            userId, searchId: search!.id, name: 'Монтажёры Reels — связка А', bundleKey: 'editor', status: 'pending_review',
            dailyBudget: 500, currency: 'RUB', geo: 'Россия, СНГ', ageMin: 18, ageMax: 40,
            interests: 'Видеомонтаж, CapCut, фриланс, Reels',
            creativeHeadline: 'Монтируешь Reels? Берём в команду',
            creativeText: 'Ищем монтажёра на поток Reels 🎬\nУдалёнка, выплаты сразу. Напиши «монтаж» в директ 👇',
            codeWord: 'монтаж', ctaLabel: 'Написать в директ',
          },
          {
            userId, searchId: search!.id, name: 'Монтажёры — тест видео-креатива', bundleKey: 'editor', status: 'draft',
            dailyBudget: 300, currency: 'RUB', geo: 'Россия', ageMin: 18, ageMax: 35,
            interests: 'Adobe Premiere, монтаж, фриланс',
            creativeHeadline: 'Видеомонтажёр в активную команду',
            creativeText: 'Нужен монтажёр Reels. Покажи шоурил — пиши «монтаж» 👇',
            mediaType: 'video', codeWord: 'монтаж', ctaLabel: 'Написать в директ',
          },
        ],
      });
    }

    // демо-подключение рекламного кабинета (на модерации)
    await db.metaConnection.upsert({
      where: { userId },
      create: { userId, adAccountId: 'act_1029384756', businessName: 'Студия Reels', status: 'pending' },
      update: {},
    });

    return { ok: true, searchId: search.id };
  });
}
