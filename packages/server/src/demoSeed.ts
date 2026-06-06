// Демо-данные для ТУРА по админке: создаёт реалистичную когорту аккаунтов со
// всей сопутствующей активностью (поиски, лиды по всем стадиям, посты, кампании,
// устройства, расход ИИ), плюс лист ожидания и email-цепочки. Цель — чтобы каждый
// экран админки (метрики, рост, выручка, расходники, лист ожидания, email) выглядел
// «живым» во время демонстрации.
//
// Всё помечается isDemo=true и удаляется одной кнопкой. Каскады по userId/searchId
// зачищают связанные строки автоматически.
import type { PrismaClient } from '@prisma/client';
import { today } from './ai/limits.js';

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: T[]): T => a[rnd(a.length)];
const chance = (p: number) => Math.random() < p;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000 - rnd(86_400_000));

const ROLES = [
  { title: 'Видеомонтажёр', kw: 'монтаж', desc: 'Reels/Shorts для блогеров, удалёнка, сдельно' },
  { title: 'Таргетолог', kw: 'таргет', desc: 'Запуск рекламы в Meta, бюджеты от 100к/мес' },
  { title: 'Дизайнер карточек', kw: 'дизайн', desc: 'Маркетплейсы, 15–20 креативов в неделю' },
  { title: 'SMM-менеджер', kw: 'смм', desc: 'Ведение Threads/Instagram, контент-план' },
  { title: 'Копирайтер', kw: 'текст', desc: 'Продающие тексты, прогревы, воронки' },
  { title: 'Ассистент', kw: 'ассистент', desc: 'Операционка, нейросети, таблицы, порядок в хаосе' },
];
const NICKS = ['alina', 'max', 'daria', 'igor', 'olya', 'nik', 'vera', 'artem', 'polina', 'sergei', 'yulia', 'denis', 'kate', 'roman', 'lera'];
const NAMES = ['Алина', 'Максим', 'Дарья', 'Игорь', 'Ольга', 'Никита', 'Вероника', 'Артём', 'Полина', 'Сергей', 'Юлия', 'Денис', 'Екатерина', 'Роман', 'Валерия'];
const MAILHOSTS = ['gmail.com', 'yandex.ru', 'mail.ru', 'icloud.com', 'outlook.com'];
const STAGES = ['NEW', 'CONTACTED', 'SCREENING', 'HIRED', 'BENCH', 'REJECTED'];
const SECTIONS = ['requests', 'hidden', 'main'];
const UTM_SOURCES = ['facebook', 'instagram', 'tiktok', 'telegram', 'youtube'];
const UTM_CAMPAIGNS = ['launch_ru', 'recruiters_wide', 'lookalike_3', 'retarget_7d', 'bloggers'];
const UTM_CREATIVES = ['video_a', 'static_b', 'carousel_c', 'reels_d'];

export interface DemoResult {
  users: number;
  searches: number;
  leads: number;
  posts: number;
  campaigns: number;
  waitlist: number;
  sequences: number;
}

// Полная очистка демо-данных.
export async function clearDemo(db: PrismaClient): Promise<{ deletedUsers: number; deletedWaitlist: number; deletedSequences: number }> {
  const demoUsers = await db.user.findMany({ where: { isDemo: true }, select: { id: true } });
  const ids = demoUsers.map((u) => u.id);
  const demoSeqs = await db.emailSequence.findMany({ where: { isDemo: true }, select: { id: true } });
  const seqIds = demoSeqs.map((s) => s.id);
  if (seqIds.length) await db.emailDrip.deleteMany({ where: { sequenceId: { in: seqIds } } });
  if (ids.length) await db.emailDrip.deleteMany({ where: { userId: { in: ids } } });
  await db.emailSequence.deleteMany({ where: { isDemo: true } });
  await db.waitlistEntry.deleteMany({ where: { isDemo: true } });
  await db.promoCode.deleteMany({ where: { isDemo: true } });
  // Каскады по User зачистят searches/leads/posts/devices/campaigns/subscription/aiUsage.
  const del = ids.length ? await db.user.deleteMany({ where: { id: { in: ids } } }) : { count: 0 };
  return { deletedUsers: del.count, deletedWaitlist: 0, deletedSequences: seqIds.length };
}

// Засеять демо-когорту. Идемпотентно: сначала чистим прошлые демо-данные.
export async function seedDemo(db: PrismaClient): Promise<DemoResult> {
  await clearDemo(db);
  const res: DemoResult = { users: 0, searches: 0, leads: 0, posts: 0, campaigns: 0, waitlist: 0, sequences: 0 };

  // План по тарифам: реалистичная воронка (большинство FREE, платящих ~⅓).
  const plans = ['FREE', 'FREE', 'FREE', 'FREE', 'FREE', 'PRO', 'PRO', 'PRO', 'PRO', 'PRO', 'PRO', 'VIP', 'VIP', 'VIP'];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const nick = NICKS[i % NICKS.length];
    const name = NAMES[i % NAMES.length];
    const email = `${nick}${rnd(900) + 100}@${pick(MAILHOSTS)}`;
    // первые трое — «новички недели» (для new7); остальные — за 8 недель.
    const createdAt = i < 3 ? daysAgo(rnd(7)) : daysAgo(7 + rnd(49));

    const user = await db.user.create({
      data: {
        email,
        name,
        plan,
        role: 'USER',
        isDemo: true,
        createdAt,
        acceptedTermsAt: createdAt,
      },
    });
    res.users++;

    // Подписка для платящих (для MRR/выручки). 1 — churned.
    if (plan !== 'FREE') {
      const status = i === plans.length - 1 ? 'canceled' : chance(0.1) ? 'past_due' : 'active';
      await db.subscription.create({
        data: { userId: user.id, plan, status, currentPeriodEnd: new Date(Date.now() + (15 + rnd(20)) * 86_400_000) },
      });
    }

    // Устройство-расширение (отбивка): у большинства, у активных — свежий heartbeat
    // (для DAU/WAU/MAU). У части — без heartbeat.
    if (chance(0.8)) {
      const active = chance(0.55);
      await db.device.create({
        data: {
          userId: user.id,
          tokenHash: `demo_dev_${user.id}_${rnd(1e9)}`,
          label: pick(['MacBook Air', 'Chrome / Windows', 'Рабочий ноут', 'Домашний ПК']),
          version: '1.2.0',
          threadsLoggedIn: true,
          lastHeartbeat: active ? daysAgo(rnd(2)) : daysAgo(10 + rnd(20)),
          createdAt,
        },
      });
    }

    // Расход ИИ за последние 14 дней (для расходников и aiToday).
    if (chance(0.7)) {
      for (let d = 0; d < 14; d++) {
        if (chance(0.4)) {
          const day = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
          await db.aiUsage.create({ data: { userId: user.id, day, count: 1 + rnd(6) } });
        }
      }
      // гарантированно немного «сегодня» у нескольких
      if (i < 5) await db.aiUsage.upsert({ where: { userId_day: { userId: user.id, day: today() } }, create: { userId: user.id, day: today(), count: 2 + rnd(5) }, update: { count: { increment: 2 } } });
    }

    // Голос бренда для платящих (заполненность профиля).
    if (plan !== 'FREE' && chance(0.7)) {
      const role = pick(ROLES);
      await db.brandProfile.create({
        data: {
          userId: user.id,
          companyName: pick(['Студия Рост', 'MediaBoost', 'Контент-Завод', 'Digital Nomads', 'Агентство Пик']),
          niche: pick(['продюсерский центр', 'онлайн-школа', 'агентство трафика', 'маркетплейс-селлер']),
          tone: 'на ты, дружелюбно, с лёгким юмором',
          audience: role.title,
          perks: 'удалёнка, быстрые выплаты, чёткое ТЗ',
          signature: 'Пиши в директ — обсудим',
        },
      });
    }

    // Поиски + лиды + посты + кампании — у активных аккаунтов (не у всех FREE).
    const searchCount = plan === 'FREE' ? (chance(0.5) ? 1 : 0) : 1 + (chance(0.5) ? 1 : 0);
    for (let s = 0; s < searchCount; s++) {
      const role = ROLES[(i + s) % ROLES.length];
      const autopost = chance(0.5);
      const onboarding = chance(0.5);
      const search = await db.search.create({
        data: {
          userId: user.id,
          title: role.title,
          description: role.desc,
          status: chance(0.85) ? 'ACTIVE' : 'PAUSED',
          createdAt,
          obEnabled: onboarding,
          obConditions: onboarding ? 'Удалёнка, сдельно, быстрые выплаты, чёткое ТЗ.' : '',
          obTestTask: onboarding ? `Небольшое тестовое по профилю «${role.title}». Срок 2 часа, сдать ссылкой.` : '',
          goalEnabled: chance(0.5),
          goalHires: 1 + rnd(4),
          goalConversion: 8 + rnd(8),
          goalDueAt: new Date(Date.now() + (14 + rnd(21)) * 86_400_000),
          goalStartedAt: daysAgo(rnd(20)),
          keywords: { create: [{ text: role.kw, mode: 'root' }] },
          replyTemplates: { create: [{ text: `Привет! Спасибо за отклик 🙌 Напиши в Telegram — пришлю детали и тестовое.`, redirectTarget: '@hr_demo', order: 0 }] },
          postTemplates: {
            create: [
              { text: `${role.title}, вы тут?? Беру в команду на постоянку. Пиши «${role.kw}» в директ 👇`, order: 0 },
              { text: `Расширяю команду: нужен ${role.title.toLowerCase()}. Кодовое слово «${role.kw}» в личку.`, order: 1 },
            ],
          },
          publishConfig: { create: { enabled: autopost, intervalMinutes: 240, maxPerDay: 4 } },
        },
      });
      res.searches++;

      // Лиды по всем стадиям, секциям и датам (воронка + динамика + DAU через createdAt).
      const leadN = 4 + rnd(12);
      for (let j = 0; j < leadN; j++) {
        const stage = pick(STAGES);
        const lcreated = j === 0 ? daysAgo(rnd(1)) : daysAgo(rnd(28)); // часть — «сегодня»
        const hired = stage === 'HIRED';
        await db.lead.create({
          data: {
            userId: user.id,
            searchId: search.id,
            fromUserKey: `demo_${search.id}_${j}`,
            fromUsername: `@${pick(NICKS)}_${rnd(99)}`,
            matchedKeyword: role.kw,
            section: pick(SECTIONS),
            status: chance(0.9) ? 'REPLIED' : 'MANUAL',
            stage,
            rating: rnd(6),
            createdAt: lcreated,
            contact: chance(0.6) ? '@' + pick(NICKS) : null,
            conditionsSentAt: stage !== 'NEW' ? lcreated : null,
            testSentAt: ['SCREENING', 'HIRED', 'BENCH'].includes(stage) ? lcreated : null,
            testSubmittedAt: chance(0.5) && ['SCREENING', 'HIRED'].includes(stage) ? lcreated : null,
            role: hired ? role.title : null,
            rate: hired ? pick(['500₽/слайд', '60к/мес', 'сдельно', '1500₽/ролик']) : null,
            startedAt: hired ? lcreated : null,
            obStep: onboarding ? rnd(4) : 0,
          },
        });
        res.leads++;
      }

      // Опубликованные посты (история автопостинга).
      const postN = autopost ? 3 + rnd(6) : rnd(3);
      for (let p = 0; p < postN; p++) {
        await db.publishedPost.create({
          data: {
            searchId: search.id,
            text: `${role.title}, ищу в команду! Пиши «${role.kw}» в директ 🔥`,
            mediaType: chance(0.4) ? 'image' : 'text',
            mediaUrl: null,
            ok: chance(0.92),
            error: chance(0.92) ? null : 'rate limit',
            threadsPostId: 'demo_' + rnd(1e9),
            permalink: 'https://www.threads.net/@demo/post/' + rnd(1e9),
            createdAt: daysAgo(rnd(20)),
          },
        });
        res.posts++;
      }

      // Рекламная связка (черновик — Meta на модерации).
      if (chance(0.5)) {
        await db.adCampaign.create({
          data: {
            userId: user.id,
            searchId: search.id,
            name: `Лидген: ${role.title}`,
            status: pick(['draft', 'pending_review', 'paused']),
            dailyBudget: 500 + rnd(20) * 100,
            currency: 'RUB',
            geo: pick(['Россия', 'РФ + СНГ', 'Москва, СПб']),
            interests: 'фриланс, удалённая работа, ' + role.title.toLowerCase(),
            creativeHeadline: `Нужен ${role.title}?`,
            creativeText: `Пиши «${role.kw}» в директ — расскажу условия.`,
            codeWord: role.kw,
          },
        });
        res.campaigns++;
      }
    }
  }

  // Лист ожидания: заявки с лендинга и из рекламы (с UTM), разные статусы.
  for (let i = 0; i < 36; i++) {
    const fromAd = chance(0.6);
    const utm = fromAd
      ? JSON.stringify({ source: pick(UTM_SOURCES), medium: 'cpc', campaign: pick(UTM_CAMPAIGNS), content: pick(UTM_CREATIVES) })
      : null;
    const src = fromAd ? (JSON.parse(utm!).source as string) : 'landing';
    await db.waitlistEntry.create({
      data: {
        email: `wl_${pick(NICKS)}${rnd(9000) + 1000}@${pick(MAILHOSTS)}`,
        name: chance(0.7) ? pick(NAMES) : null,
        source: src,
        utm,
        status: pick(['new', 'new', 'new', 'invited', 'converted']),
        isDemo: true,
        createdAt: daysAgo(rnd(40)),
      },
    });
    res.waitlist++;
  }

  // Email-цепочки + статистика отправок (drip).
  const demoUserIds = (await db.user.findMany({ where: { isDemo: true }, select: { id: true } })).map((u) => u.id);
  const heroBtn = (label: string, url: string) => ({ id: 'b' + rnd(1e6), type: 'button', text: label, url, align: 'center' });
  const seqs = [
    {
      name: '[DEMO] Онбординг новых пользователей',
      audience: 'new_users',
      steps: [
        { id: 's1', delayHours: 0, subject: 'Добро пожаловать в Threadhunt 👋', blocks: [{ id: 'h1', type: 'heading', text: 'Ты в деле!', align: 'left' }, { id: 't1', type: 'text', text: 'Подключи Threads и поставь расширение — отбивка начнёт отвечать кандидатам сама.', align: 'left' }, heroBtn('Перейти в кабинет', 'https://serene-seahorse-a5102e.netlify.app')] },
        { id: 's2', delayHours: 48, subject: 'Запусти первый пост-приманку', blocks: [{ id: 'h2', type: 'heading', text: 'Первые лиды — сегодня', align: 'left' }, { id: 't2', type: 'text', text: 'Сгенерируй пост-приманку в один клик и поставь автопостинг.', align: 'left' }, heroBtn('Создать пост', 'https://serene-seahorse-a5102e.netlify.app')] },
      ],
    },
    {
      name: '[DEMO] Прогрев листа ожидания',
      audience: 'waitlist',
      steps: [
        { id: 's1', delayHours: 0, subject: 'Скоро открываем Threadhunt 🚀', blocks: [{ id: 'h1', type: 'heading', text: 'Ты в списке первых', align: 'left' }, { id: 't1', type: 'text', text: 'Готовим запуск. Совсем скоро дадим ранний доступ и твой промокод.', align: 'left' }, heroBtn('Открыть сайт', 'https://thread-hunt.com')] },
      ],
    },
  ];
  for (const sq of seqs) {
    const row = await db.emailSequence.create({ data: { name: sq.name, audience: sq.audience, enabled: true, isDemo: true, steps: JSON.stringify(sq.steps) } });
    res.sequences++;
    // отметим часть демо-юзеров как получивших шаги (для статистики отправок)
    for (let stepIndex = 0; stepIndex < sq.steps.length; stepIndex++) {
      for (const uid of demoUserIds) {
        if (chance(0.55)) {
          await db.emailDrip.create({ data: { userId: uid, sequenceId: row.id, stepIndex, sentAt: daysAgo(rnd(20)) } });
        }
      }
    }
  }

  return res;
}
