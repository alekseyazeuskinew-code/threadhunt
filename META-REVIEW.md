# Threadhunt — прохождение проверки Meta (Threads API)

Нужно ОДИН РАЗ тебе как владельцу — чтобы любой клиент мог подключать постинг через OAuth.
Без этого подключаться смогут только тест-аккаунты (до ~25, добавленных вручную).

> Точные формулировки в кабинете Meta меняются — сверяйся с developers.facebook.com/docs/threads. Суть стабильна.

## Что нужно получить
**Advanced Access** на скоупы `threads_basic` и `threads_content_publish` (для постинга).
Скорее всего потребуется **Business Verification** (документы юрлица).

## Подготовь заранее (чек-лист)
- [ ] Публичная **Privacy Policy** (URL) и **Terms** (у нас есть `/terms`, добавь `/privacy`).
- [ ] **Deauthorize callback** и **Data Deletion callback** URL (Meta требует при настройке).
- [ ] Иконка приложения, название, категория, контактный email.
- [ ] Рабочий **OAuth-флоу** на проде (кнопка «Войти через Threads» → согласие → токен).
- [ ] **Скринкаст** (видео), где показан весь путь: вход в Threadhunt → подключение Threads → публикация поста.
- [ ] Документы для Business Verification (если запросят).

## Пошагово
1. **developers.facebook.com** → создать приложение типа **Business**.
2. Добавить продукт/use case **«Access the Threads API»**.
3. Настроить **OAuth Redirect URI** = `https://api.<домен>/api/threads/callback`, заполнить deauthorize/data-deletion URL.
4. На время разработки — добавить себя и тестеров как **Threads Testers**, принять инвайт в приложении Threads (тестить флоу на Standard Access).
5. Заполнить **Privacy Policy / Terms / иконку / описание**.
6. В разделе **App Review** запросить Advanced Access на `threads_basic` + `threads_content_publish`:
   - для каждого скоупа — объяснение «зачем» (публикация постов-приманок от имени пользователя по его запросу),
   - приложить **скринкаст** полного флоу,
   - указать, что токены хранятся зашифрованно и не передаются третьим лицам.
7. Пройти **Business Verification**, если потребует.
8. Дождаться ревью (дни–недели), при отказе — поправить по замечаниям и переотправить.

## Как повысить шанс одобрения
- Скринкаст должен ясно показывать **ценность для пользователя** и что он **сам авторизует** свой аккаунт.
- Не запрашивай лишних скоупов — только нужные для постинга.
- Privacy Policy должна явно описывать, какие данные берём (профиль, публикации) и зачем.
- Приложение на скринкасте — уже рабочее (поэтому сначала деплой, потом ревью).

## Пока ревью не пройдено — как тестировать/работать
- **Отбивка в директе** — работает уже сейчас (через расширение, без Meta).
- **Постинг** — на Standard Access доступен тебе и до ~25 тест-аккаунтам, либо через ручной токен (см. `/setup/threads`).
- Полноценный публичный постинг включается после Advanced Access.

---

# Meta Ads (Marketing API) — отдельная проверка для авто-кампаний

Раздел «Кампании» (реклама → клик-в-директ) запускается через **Marketing API**. Это
ОТДЕЛЬНЫЙ и более тяжёлый трек, чем Threads API.

## Что нужно получить
- **Advanced Access** на `ads_management` (и `ads_read`, `business_management`).
- **Business Verification** (документы юрлица) — почти наверняка обязательна.
- Выход приложения из dev-режима для рекламы.

## Пошагово
1. В том же приложении (Business) добавить продукт **Marketing API**.
2. Привязать **Business Manager** и рекламный аккаунт (`act_…`).
3. Запросить в **App Review** скоуп `ads_management`: кейс — «сервис помогает работодателю запускать готовые рекламные связки лидгена на найм, пользователь сам авторизует свой рекламный кабинет».
4. Приложить **скринкаст**: вход → подключение Meta-кабинета → сборка кампании → запуск.
5. Пройти **Business Verification**.
6. Соблюсти **рекламные политики** Meta.

## Важно про политику «Employment»
Объявления о работе в ряде стран попадают в **спец-категорию занятости** с ограничениями
таргетинга (возраст/пол/часть гео). Наши связки нужно помечать как Employment при запуске.

---

# Что подогнать в КОДЕ перед подачей

✅ **Уже готово в коде** (нужно лишь вписать App ID/Secret в env и задеплоить):
- [x] **OAuth Threads**: `GET /api/threads/oauth/start` → `/api/threads/callback` (обмен code→long-lived token, whoami, сохранение в `ThreadsConnection`). Кнопка «Войти через Threads» в `/connections`.
- [x] **OAuth Meta Ads**: `GET /api/meta/oauth/start` → `/api/meta/callback` (token, ad account, сохранение в `MetaConnection`). Кнопка «Войти через Meta».
- [x] Страница **`/privacy`** (+ ссылка из формы регистрации).
- [x] **Deauthorize** `/api/meta/deauthorize`, `/api/threads/deauthorize` и **Data Deletion** `/api/meta/data-deletion`, `/api/threads/data-deletion` (проверяют `signed_request` по App Secret, отдают `{url, confirmation_code}`).

**Env-переменные**, которые надо заполнить после создания приложения:
```
THREADS_APP_ID=...           META_APP_ID=...
THREADS_APP_SECRET=...       META_APP_SECRET=...
THREADS_OAUTH_REDIRECT=https://api.<домен>/api/threads/callback
META_OAUTH_REDIRECT=https://api.<домен>/api/meta/callback
```
Пока их нет — кнопки «Войти через …» аккуратно редиректят на `?…=unconfigured` (работает ручной токен).
В кабинете Meta укажи Redirect URI = эти же значения; Deauthorize/Data-Deletion URL =
`https://api.<домен>/api/meta/deauthorize` и `.../api/meta/data-deletion` (и аналоги для Threads-приложения).

⏳ **Осталось (не код / отдельно):**
- [ ] Деплой на прод-домен с HTTPS.
- [ ] Реальный вызов **Marketing API** при «Отправить на запуск» (сейчас статус `pending_review`).
- [ ] Иконка приложения, описание, контактный email в кабинете Meta.
- [ ] Скринкасты обоих флоу на РАБОЧЕМ проде.
- [ ] Business Verification (документы юрлица).

Порядок: деплой → вписать App ID/Secret в env → проверить флоу на проде → скринкасты →
App Review (сначала Threads API, можно параллельно Ads).
