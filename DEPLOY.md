# Threadhunt — деплой в прод (чтобы тестировать вживую)

Сейчас локальная «коробка» на SQLite. Для реального теста выносим на сервис.

## Что где разворачиваем (упрощённая схема — без Redis и без отдельного воркера)
| Часть | Где | Примечание |
|---|---|---|
| API + планировщик автопостинга (`packages/server`) | Railway / Render / Fly.io | один Node-процесс `start`; планировщик встроен в API |
| Веб (`packages/web`) | Netlify / Vercel | Next.js |
| Postgres | managed (Neon / Railway / Supabase) | вместо SQLite |
| Расширение | Chrome Web Store | сборка `dist/`, разовая модерация |

> Redis и отдельный worker больше не нужны: постинг по расписанию выполняет `setInterval` внутри API (`src/scheduler.ts`). Отбивка в директе — в браузере клиента (расширение).
> ⚠️ Нюанс масштаба: планировщик внутри API рассчитан на **один экземпляр** сервера. Если будешь запускать API в нескольких репликах — выноси планировщик в один (или вернёшь очередь). Для старта — одного достаточно.

## Шаги

### 1. Переключить БД на Postgres
В `packages/server/prisma/schema.prisma`:
```prisma
datasource db { provider = "postgresql"  url = env("DATABASE_URL") }
```
(enum'ы не возвращаем — строки работают на обоих.) Затем:
```bash
pnpm --filter @threadhunt/server exec prisma migrate deploy   # или db push
```

### 2. Переменные окружения API (в настройках хостинга)
```
DATABASE_URL=postgresql://...        # от managed Postgres (Neon/Railway)
TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>
SESSION_SECRET=<длинная случайная строка>
ANTHROPIC_API_KEY=sk-ant-...         # ← включает живой ИИ для всех
THREADS_APP_ID=...                   # после регистрации Meta-приложения
THREADS_APP_SECRET=...
THREADS_OAUTH_REDIRECT=https://api.<домен>/api/threads/callback
PORT=3010
WEB_ORIGIN=https://app.<домен>
```

### 3. Веб (Vercel)
- `NEXT_PUBLIC_AGENT_API=https://api.<домен>` (адрес, который расширение опрашивает).
- `API_ORIGIN=https://api.<домен>` (прокси `/api/*` → бэкенд; см. `next.config.mjs`).
- Корневая директория сборки — `packages/web`.

### 4. Расширение
- В `manifest.json` host_permissions и pair-скрипт уже включают `https://api.threadhunt.app/*` и `https://app.threadhunt.app/*` — поменяй на свои домены.
- `pnpm --filter @threadhunt/extension build` → загрузить `dist/` в Chrome Web Store (нужны иконки, описание, политика).

### 5. Домены
- `app.<домен>` → веб, `api.<домен>` → API. HTTPS обязателен (для cookie и Meta OAuth).

### 6. Прод-харднинг (до публичного запуска)
- Cookie сессии: добавить `Secure` в проде (сейчас httpOnly+SameSite=Lax).
- Бэкапы Postgres, алерты, мониторинг (Sentry).
- Бюджет-алерт в консоли Anthropic.
- Лимиты ИИ по тарифам уже на месте; постинг — анти-бан потолки уже на месте.

## Минимальный «живой тест» без Chrome Store
Расширение можно грузить как **unpacked** (`chrome://extensions` → Load unpacked → `dist/`) у себя/тестеров — этого хватает, чтобы протестировать отбивку вживую до публикации в Store.
