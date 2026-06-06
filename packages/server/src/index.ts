// Точка входа API-сервера Threadhunt (Fastify).
// Процессы: этот `api` + отдельный `worker` (queue/worker.ts).
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env } from './env.js';
import { db } from './db.js';
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
// Расширение (device-token).
await app.register(agentRoutes);

app.listen({ port: env.PORT, host: '0.0.0.0' }).then(() => {
  app.log.info(`Threadhunt API на :${env.PORT}`);
  startScheduler(); // автопостинг по расписанию — внутри API, без отдельного воркера
});
