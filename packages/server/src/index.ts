// Точка входа API-сервера Threadhunt (Fastify).
// Процессы: этот `api` + отдельный `worker` (queue/worker.ts).
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import { db } from './db.js';
import { LOCAL_UPLOAD_DIR, storageBackend } from './storage.js';
import { uploadRoutes } from './routes/uploads.js';
import { announcementRoutes } from './routes/announcements.js';
import { agentRoutes } from './routes/agent.js';
import { authRoutes } from './routes/auth.js';
import { searchRoutes } from './routes/searches.js';
import { connectionRoutes } from './routes/connections.js';
import { leadRoutes } from './routes/leads.js';
import { analyticsRoutes } from './routes/analytics.js';
import { brandRoutes } from './routes/brand.js';
import { adminRoutes } from './routes/admin.js';
import { demoRoutes } from './routes/demo.js';
import { limitsRoutes } from './routes/limits.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { workspaceRoutes } from './routes/workspace.js';
import { campaignRoutes } from './routes/campaigns.js';
import { oauthRoutes } from './routes/oauth.js';
import { waitlistRoutes } from './routes/waitlist.js';
import { promoRoutes } from './routes/promo.js';
import { integrationRoutes } from './routes/integrations.js';
import { startScheduler } from './scheduler.js';

const app = Fastify({ logger: true });

// Разрешённые источники: основной дашборд + доп. (домен лендинга для /api/waitlist).
const corsOrigins = [env.WEB_ORIGIN, ...(env.EXTRA_ORIGINS ? env.EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : [])];
await app.register(cors, { origin: corsOrigins, credentials: true });
await app.register(cookie, { secret: env.SESSION_SECRET });

// Загрузка медиа: лимит 100 МБ на файл (видео Reels умещаются). 1 файл за запрос.
await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

// Локальное хранилище медиа раздаём по /api/media/ (этот префикс Next проксирует
// на бэкенд, поэтому превью грузится с того же домена без настройки PUBLIC_BASE_URL).
if (storageBackend === 'local') {
  const { promises: fs } = await import('node:fs');
  await fs.mkdir(LOCAL_UPLOAD_DIR, { recursive: true }).catch(() => {});
  await app.register(fastifyStatic, { root: LOCAL_UPLOAD_DIR, prefix: '/api/media/', decorateReply: false });
}

// Парсер form-urlencoded — Meta шлёт signed_request (deauthorize/data-deletion) в этом формате.
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
  try {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  } catch (e) {
    done(e as Error);
  }
});

app.get('/health', async () => ({ ok: true }));

// Лёгкие идемпотентные миграции схемы на старте (Postgres, ADD COLUMN IF NOT
// EXISTS). Так аддитивные колонки появляются при деплое сами — без ручного
// `prisma db push` и без окна, когда сгенерированный клиент уже запрашивает
// ещё не существующую в БД колонку. Только безопасные (необнуляемые/additive) изменения.
async function ensureSchema() {
  const stmts = [
    'ALTER TABLE "Keyword" ADD COLUMN IF NOT EXISTS "replyText" TEXT',
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "acceptedDataUseAt" TIMESTAMP',
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "extraSeats" INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "webhookUrl" TEXT',
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "webhookSecret" TEXT',
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "webhookEvents" TEXT',
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetTokenHash" TEXT',
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetTokenExpiresAt" TIMESTAMP',
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false',
    // Лист ожидания с лендинга (создаётся на старте — без отдельной миграции).
    `CREATE TABLE IF NOT EXISTS "WaitlistEntry" (
      "id" TEXT PRIMARY KEY,
      "email" TEXT NOT NULL UNIQUE,
      "name" TEXT,
      "source" TEXT,
      "status" TEXT NOT NULL DEFAULT 'new',
      "createdAt" TIMESTAMP NOT NULL DEFAULT now()
    )`,
    'ALTER TABLE "CommentRule" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT \'keyword\'',
    `CREATE TABLE IF NOT EXISTS "CommentReply" (
      "id" TEXT PRIMARY KEY,
      "searchId" TEXT NOT NULL,
      "replyId" TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now()
    )`,
    'CREATE INDEX IF NOT EXISTS "CommentReply_searchId_idx" ON "CommentReply" ("searchId")',
    'ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "utm" TEXT',
    'ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "promoCode" TEXT',
    'ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false',
    `CREATE TABLE IF NOT EXISTS "EmailSequence" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "audience" TEXT NOT NULL DEFAULT 'new_users',
      "steps" TEXT NOT NULL DEFAULT '[]',
      "enabled" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
    )`,
    'ALTER TABLE "EmailSequence" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false',
    'ALTER TABLE "EmailSequence" ADD COLUMN IF NOT EXISTS "segment" TEXT',
    // Промокоды запуска (уникальные, защита от повторного применения).
    `CREATE TABLE IF NOT EXISTS "PromoCode" (
      "id" TEXT PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "percentOff" INTEGER NOT NULL DEFAULT 50,
      "durationMonths" INTEGER NOT NULL DEFAULT 2,
      "maxRedemptions" INTEGER NOT NULL DEFAULT 1,
      "redeemedCount" INTEGER NOT NULL DEFAULT 0,
      "expiresAt" TIMESTAMP,
      "campaign" TEXT NOT NULL DEFAULT 'early',
      "issuedToEmail" TEXT,
      "isDemo" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now()
    )`,
    'CREATE INDEX IF NOT EXISTS "PromoCode_issuedToEmail_idx" ON "PromoCode" ("issuedToEmail")',
    'CREATE INDEX IF NOT EXISTS "PromoCode_campaign_idx" ON "PromoCode" ("campaign")',
    `CREATE TABLE IF NOT EXISTS "PromoRedemption" (
      "id" TEXT PRIMARY KEY,
      "codeId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now()
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "PromoRedemption_codeId_userId_key" ON "PromoRedemption" ("codeId","userId")',
    'CREATE INDEX IF NOT EXISTS "PromoRedemption_userId_idx" ON "PromoRedemption" ("userId")',
    `CREATE TABLE IF NOT EXISTS "EmailDrip" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "sequenceId" TEXT NOT NULL,
      "stepIndex" INTEGER NOT NULL,
      "sentAt" TIMESTAMP NOT NULL DEFAULT now(),
      UNIQUE("userId","sequenceId","stepIndex")
    )`,
    // Карусель + цепочки веток в шаблонах постов.
    'ALTER TABLE "PostTemplate" ADD COLUMN IF NOT EXISTS "segmentsJson" TEXT',
    // Параметры прохода отбивки (расширяют Limits).
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "sweepIntervalMinutes" INTEGER NOT NULL DEFAULT 180',
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "safeMode" BOOLEAN NOT NULL DEFAULT false',
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "sweepMain" BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "sweepRequests" BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "sweepHidden" BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "runNowAt" TIMESTAMP',
    // Журнал проходов отбивки (телеметрия для статистики и хронологии).
    `CREATE TABLE IF NOT EXISTS "AgentPass" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "scanned" INTEGER NOT NULL DEFAULT 0,
      "sent" INTEGER NOT NULL DEFAULT 0,
      "matched" INTEGER NOT NULL DEFAULT 0,
      "sections" TEXT,
      "dryRun" BOOLEAN NOT NULL DEFAULT false,
      "at" TIMESTAMP NOT NULL DEFAULT now()
    )`,
    'CREATE INDEX IF NOT EXISTS "AgentPass_userId_at_idx" ON "AgentPass" ("userId","at")',
    // Объявления основателя + отметка прочтения у пользователя.
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastSeenAnnouncementAt" TIMESTAMP',
    `CREATE TABLE IF NOT EXISTS "Announcement" (
      "id" TEXT PRIMARY KEY,
      "title" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "level" TEXT NOT NULL DEFAULT 'info',
      "published" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now()
    )`,
    'CREATE INDEX IF NOT EXISTS "Announcement_createdAt_idx" ON "Announcement" ("createdAt")',
    // Email-напоминания кандидату о дедлайне теста.
    'ALTER TABLE "Search" ADD COLUMN IF NOT EXISTS "obRemindersEnabled" BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "obReminderCount" INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "obLastReminderAt" TIMESTAMP',
    // Research топовых веток (сбор через расширение).
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "researchEnabled" BOOLEAN NOT NULL DEFAULT false',
    `CREATE TABLE IF NOT EXISTS "ResearchPost" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "searchId" TEXT,
      "query" TEXT NOT NULL,
      "threadsPostId" TEXT NOT NULL,
      "author" TEXT,
      "text" TEXT NOT NULL,
      "permalink" TEXT,
      "likes" INTEGER NOT NULL DEFAULT 0,
      "replies" INTEGER NOT NULL DEFAULT 0,
      "reposts" INTEGER NOT NULL DEFAULT 0,
      "postedAt" TIMESTAMP,
      "fetchedAt" TIMESTAMP NOT NULL DEFAULT now()
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "ResearchPost_userId_threadsPostId_key" ON "ResearchPost" ("userId","threadsPostId")',
    'CREATE INDEX IF NOT EXISTS "ResearchPost_userId_searchId_idx" ON "ResearchPost" ("userId","searchId")',
    // Холостой тест отбивки из дашборда.
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "dmTestAt" TIMESTAMP',
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "lastTestAt" TIMESTAMP',
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "lastTestScanned" INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "Limits" ADD COLUMN IF NOT EXISTS "lastTestMatched" INTEGER NOT NULL DEFAULT 0',
  ];
  for (const sql of stmts) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch (e) {
      app.log.error({ err: e }, `ensureSchema: не удалось выполнить ${sql}`);
    }
  }
}
await ensureSchema();

// Дашборд (cookie-сессия).
await app.register(authRoutes);
await app.register(searchRoutes);
await app.register(connectionRoutes);
await app.register(leadRoutes);
await app.register(analyticsRoutes);
await app.register(brandRoutes);
await app.register(adminRoutes);
await app.register(demoRoutes);
await app.register(limitsRoutes);
await app.register(onboardingRoutes);
await app.register(workspaceRoutes);
await app.register(campaignRoutes);
await app.register(oauthRoutes);
await app.register(waitlistRoutes);
await app.register(promoRoutes);
await app.register(integrationRoutes);
await app.register(uploadRoutes);
await app.register(announcementRoutes);
// Расширение (device-token).
await app.register(agentRoutes);

app.listen({ port: env.PORT, host: '0.0.0.0' }).then(() => {
  app.log.info(`Threadhunt API на :${env.PORT}`);
  startScheduler(); // автопостинг по расписанию — внутри API, без отдельного воркера
});
