// Демо-данные для превью: один пользователь + два поиска с лидами и постами.
// Запуск: pnpm --filter @threadhunt/server db:seed
// Вход в дашборд: demo@threadhunt.app / demodemo

import { PrismaClient } from '@prisma/client';
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const db = new PrismaClient();
const scryptAsync = promisify(scrypt);

async function hash(pw: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(pw, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

async function main() {
  const email = 'demo@threadhunt.app';
  await db.user.deleteMany({ where: { email } }); // чистим прошлый сид

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hash('demodemo'),
      name: 'Демо',
      plan: 'VIP',
      role: 'ADMIN',
      subscription: { create: { plan: 'VIP', status: 'active' } },
      brandProfile: {
        create: {
          companyName: 'Студия Reels',
          niche: 'продакшн коротких видео для брендов',
          social: '@studio.reels',
          about: 'Небольшая команда: снимаем и монтируем Reels/Shorts для бизнеса.',
          tone: 'на ты, по-человечески, без пафоса',
          perks: 'быстрые выплаты, чёткое ТЗ, поток задач',
          signature: 'пиши в Telegram @hr_demo',
        },
      },
    },
  });

  // Поиск 1 — Видеомонтажёр (активный, с лидами)
  const editor = await db.search.create({
    data: {
      userId: user.id,
      title: 'Видеомонтажёр',
      description: 'Удалёнка, монтаж Reels/Shorts, опыт от года, сдельная оплата.',
      status: 'ACTIVE',
      obEnabled: true,
      obConditions: 'Удалёнка, поток роликов, оплата сдельно (500 ₽/ролик), быстрые выплаты, чёткое ТЗ.',
      obTestTask: 'Смонтируй один Reel (15–30 сек) из наших исходников по референсу. Срок — 2 часа. Сдай ссылкой на Google Drive.',
      obNda: 'На тестовый период обязуюсь не передавать исходные материалы третьим лицам.',
      keywords: { create: [{ text: 'монтаж' }, { text: 'монтажёр' }] },
      replyTemplates: {
        create: [
          {
            text: 'Привет! Спасибо за отклик 🙌 Напиши, пожалуйста, в Telegram @hr_demo — там пришлю тестовое и условия.',
            redirectTarget: '@hr_demo',
            order: 0,
          },
        ],
      },
      postTemplates: {
        create: [
          { text: 'Ищу монтажёра Reels на постоянку. Пиши «монтаж» в директ — расскажу детали.', order: 0 },
          { text: 'Нужен видеомонтажёр под Shorts. Оплата сдельно, удалёнка. Кодовое слово «монтаж» 👇', order: 1 },
        ],
      },
      publishConfig: { create: { enabled: true, intervalMinutes: 240, maxPerDay: 5, rotation: 'sequential' } },
    },
  });

  // Поиск 2 — UI-дизайнер (на паузе)
  await db.search.create({
    data: {
      userId: user.id,
      title: 'UI-дизайнер',
      description: 'Продуктовый дизайн, Figma, мобильные интерфейсы.',
      status: 'PAUSED',
      keywords: { create: [{ text: 'дизайн' }, { text: 'дизайнер' }] },
      publishConfig: { create: {} },
    },
  });

  // Демо-кандидаты: по карточке на каждую стадию, со ВСЕМИ полями цикла —
  // чтобы наглядно показать, как работает CRM (контакт, тест с дедлайном, оффер, отказ).
  const now = Date.now();
  const h = (n: number) => new Date(now - n * 3600_000); // n часов назад
  const inH = (n: number) => new Date(now + n * 3600_000); // через n часов
  const lead = (data: any, comment?: string) =>
    db.lead
      .create({ data: { userId: user.id, searchId: editor.id, status: 'REPLIED', matchedKeyword: 'монтаж', section: 'requests', ...data } })
      .then((l) => (comment ? db.leadComment.create({ data: { leadId: l.id, body: comment } }) : null));

  await Promise.all([
    // НОВЫЙ — только что прилетел
    lead({ fromUserKey: 'd1', fromUsername: 'pro_editor99', section: 'hidden', stage: 'NEW', createdAt: h(2) }),
    lead({ fromUserKey: 'd2', fromUsername: 'kat_video', section: 'main', status: 'FAILED', stage: 'NEW', createdAt: h(40) }),
    // НА СВЯЗИ — увели в TG, отправили условия
    lead(
      { fromUserKey: 'd3', fromUsername: 'editor_max', stage: 'CONTACTED', rating: 3, contact: '@hr_demo', conditionsSentAt: h(4), createdAt: h(6) },
      'Ответил, скинул условия — ждём решение по тестовому.',
    ),
    // ТЕСТ ИДЁТ — дедлайн ещё не вышел
    lead(
      { fromUserKey: 'd4', fromUsername: 'anna.cuts', stage: 'SCREENING', rating: 4, contact: '@hr_demo', conditionsSentAt: h(3), testSentAt: h(1), testDeadlineAt: inH(1), createdAt: h(5) },
      'Сильный шоурил, выдал тестовое — таймер пошёл.',
    ),
    // ТЕСТ ПРОСРОЧЕН
    lead(
      { fromUserKey: 'd5', fromUsername: 'slow_cuts', stage: 'SCREENING', rating: 2, contact: '@hr_demo', conditionsSentAt: h(8), testSentAt: h(6), testDeadlineAt: h(4), createdAt: h(10) },
      'Тест просрочен — темп не наш.',
    ),
    // ТЕСТ СДАН — на решении
    lead(
      { fromUserKey: 'd6', fromUsername: 'reels_master', stage: 'SCREENING', rating: 5, contact: '@hr_demo', conditionsSentAt: h(7), testSentAt: h(6), testDeadlineAt: h(4), testSubmittedUrl: 'https://drive.google.com/демо-тест', testSubmittedAt: h(5), createdAt: h(9) },
      'Сдал за час, монтаж чистый — берём!',
    ),
    // В КОМАНДЕ
    lead(
      { fromUserKey: 'd7', fromUsername: 'reels_pro', section: 'hidden', stage: 'HIRED', rating: 5, contact: '@hr_demo', role: 'Монтажёр Reels', rate: '500 ₽/ролик', startedAt: h(20), createdAt: h(30) },
      'В команде 🎉 первый ролик в работе.',
    ),
    // РЕЗЕРВ — держим тёплым
    lead(
      { fromUserKey: 'd8', fromUsername: 'editor_kg', stage: 'BENCH', rating: 3, contact: '@hr_demo', nextTouchAt: inH(24 * 7), createdAt: h(48) },
      'Хороший, но мест нет — в резерв, напомнить через неделю.',
    ),
    // ОТКАЗ — с причиной
    lead(
      { fromUserKey: 'd9', fromUsername: 'cheap_cuts', stage: 'REJECTED', rating: 2, contact: '@hr_demo', decisionReason: 'Дорого', createdAt: h(60) },
      'Ставка выше бюджета.',
    ),
  ]);

  // Опубликованные посты
  for (let i = 0; i < 3; i++) {
    await db.publishedPost.create({
      data: {
        searchId: editor.id,
        threadsPostId: `demo_post_${i}`,
        permalink: 'https://www.threads.com/',
        text: 'Ищу монтажёра Reels на постоянку…',
        mediaType: 'text',
        ok: true,
        createdAt: new Date(now - i * 6 * 3600_000),
      },
    });
  }

  console.log('✅ Сид готов. Вход: demo@threadhunt.app / demodemo');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
