// Точка входа API-сервера Threadhunt (Fastify).
// Процессы: этот `api` + отдельный `worker` (queue/worker.ts).
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env } from './env.js';
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
import { startScheduler } from './scheduler.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: [env.WEB_ORIGIN], credentials: true });
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
// Расширение (device-token).
await app.register(agentRoutes);

app.listen({ port: env.PORT, host: '0.0.0.0' }).then(() => {
  app.log.info(`Threadhunt API на :${env.PORT}`);
  startScheduler(); // автопостинг по расписанию — внутри API, без отдельного воркера
});
