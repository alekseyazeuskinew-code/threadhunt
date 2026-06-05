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
  PORT: z.coerce.number().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
});

export const env = schema.parse(process.env);
