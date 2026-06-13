import 'dotenv/config';
import { z } from 'zod';

// Валидация окружения на старте — падаем рано, если чего-то нет.
const schema = z.object({
  DATABASE_URL: z.string().min(1), // sqlite: file:./dev.db | postgres: postgresql://…
  TOKEN_ENCRYPTION_KEY: z.string().length(64), // 32 байта в hex
  SESSION_SECRET: z.string().min(16),
  THREADS_APP_ID: z.string().optional(),
  THREADS_APP_SECRET: z.string().optional(),
  THREADS_OAUTH_REDIRECT: z.string().url().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_OAUTH_REDIRECT: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(), // отправка писем (Resend)
  EMAIL_FROM: z.string().optional(), // напр. «Threadhunt <noreply@домен>»
  TELEGRAM_BOT_TOKEN: z.string().optional(), // токен бота из @BotFather
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(), // секрет в пути вебхука
  PORT: z.coerce.number().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  // Доп. источники для CORS (через запятую) — напр. домен лендинга, который шлёт заявки в /api/waitlist.
  EXTRA_ORIGINS: z.string().optional(),
});

export const env = schema.parse(process.env);
