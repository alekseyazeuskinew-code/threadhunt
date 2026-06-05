# Threadhunt

SaaS для найма через Threads: **авто-постинг** (официальный API) + **авто-отбивка в директе** по кодовым словам (через расширение в браузере клиента) + **ИИ-генерация** постов и шаблонов.

Полная архитектура — в [ARCHITECTURE.md](./ARCHITECTURE.md), бренд (имя, палитра, шрифты) — в [BRAND.md](./BRAND.md).

## Структура (монорепо, pnpm)

```
packages/
  shared/      общие типы + чистая логика матча кодовых слов (порт bot.js)
  server/      Fastify API + BullMQ воркеры + Prisma (Postgres)
  extension/   MV3-расширение: отбивка в директе во вкладке клиента (порт bot.js)
  web/         Next.js + Tailwind дашборд
```

## Запуск для просмотра (локально, без Docker)

Dev-режим использует **SQLite** — ни Postgres, ни Redis не нужны, чтобы посмотреть интерфейс.

```bash
pnpm install

# .env сервера (секреты). Создаётся один раз:
cd packages/server
printf 'DATABASE_URL="file:./dev.db"\nTOKEN_ENCRYPTION_KEY="%s"\nSESSION_SECRET="%s"\nPORT=3010\nWEB_ORIGIN="http://localhost:3000"\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" > .env
pnpm db:push       # создать таблицы в SQLite
pnpm db:seed       # демо-данные (вход: demo@threadhunt.app / demodemo)
cd ../..

# в двух терминалах:
pnpm --filter @threadhunt/server dev   # API на :3010
pnpm --filter @threadhunt/web dev      # дашборд на :3000  → открыть в браузере
```

Открой **http://localhost:3000**, войди `demo@threadhunt.app` / `demodemo` — увидишь поиски, лиды, подключения.

ИИ-генерация и автопостинг работают **внутри API** (Redis и отдельный воркер не нужны). Для живого Claude добавь `ANTHROPIC_API_KEY` в `packages/server/.env`.

Расширение:
```bash
pnpm --filter @threadhunt/extension build  # → загрузить dist/ как unpacked в chrome://extensions
```

> Next проксирует `/api/*` на Fastify (`:3010`) — см. `rewrites` в `next.config.mjs`, CORS не нужен.
> Для прода: в `prisma/schema.prisma` поменяй `provider` на `postgresql`, задай `DATABASE_URL` (managed Postgres). См. [DEPLOY.md](./DEPLOY.md).

## Что уже готово

**Бэкенд (`server`)**
- [x] Модель данных (Prisma): users, connections, devices, **searches** (гибкая замена `config.js`), keywords, шаблоны (reply/post с медиа), leads, posts, ai-jobs, subscriptions.
- [x] Auth: регистрация/логин/сессия (подписанная httpOnly-cookie, scrypt-хеш).
- [x] CRUD поисков: слова, шаблоны отбивки, шаблоны постов, расписание, вкл/выкл.
- [x] Подключения: Threads-токен (whoami + шифрование), спаривание расширения (device-token).
- [x] Мультиарендный publisher (порт `publisher.js`): текст + фото + видео (с опросом готовности).
- [x] Протокол агента (`/api/agent/tasks|events|heartbeat`) + дедуп/лиды на сервере (с пометкой раздела).
- [x] ИИ-генерация постов/ответов (Claude, prompt caching) + воркер постинга по расписанию (BullMQ).

**Расширение (`extension`)**
- [x] Content-script (порт `bot.js`): обход 3 разделов директа (Запросы→Скрытые→основной) + приём диалога, возобновляемый автомат под MV3.
- [x] Popup для спаривания (адрес сервера + device-token), сборка через esbuild.

**Дашборд (`web`)** — дизайн-система «Lime-заряд», тёмный минимализм
- [x] Экраны: Вход/Регистрация, Поиски, Деталь поиска (вкладки: слова/отбивка/посты/лиды), Лиды, Подключения, Онбординг, Тарифы.
- [x] ИИ-генерация прямо из экрана (кнопка «Сгенерировать ИИ» на отбивке и постах).

Статус сборки: `tsc --noEmit` чист во всех пакетах, `next build` проходит, расширение собирается.

## Дальше (этап 2)

- [ ] OAuth-вход Threads в один клик (вместо ручного токена) — интерфейс publisher уже готов.
- [ ] Stripe Checkout на экране тарифов.
- [ ] Отбивка через комментарии (модель `CommentRule` заложена).
- [ ] Аналитика лидов (источник-раздел, конверсия), экспорт.
```
