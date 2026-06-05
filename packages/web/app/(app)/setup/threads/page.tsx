import Link from 'next/link';
import { ArrowLeft, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';

// Пошаговый гайд получения токена Threads API (временный путь, пока нет one-click OAuth).
// Скриншоты — слоты <Shot/>: владелец сервиса вставляет реальные картинки в /public/setup/.

export const metadata = { title: 'Подключение Threads API — инструкция' };

const STEPS: { title: string; body: React.ReactNode; link?: { href: string; label: string }; shot: string }[] = [
  {
    title: 'Стань разработчиком Meta',
    body: (
      <>
        Открой портал разработчиков и войди под тем же аккаунтом, к которому привязан твой Threads/Instagram. Нажми{' '}
        <b>Get Started / Начать</b> и прими условия. Это бесплатно.
      </>
    ),
    link: { href: 'https://developers.facebook.com/', label: 'developers.facebook.com' },
    shot: 'Кнопка «Get Started» в правом верхнем углу портала Meta for Developers.',
  },
  {
    title: 'Создай приложение',
    body: (
      <>
        Перейди в <b>My Apps → Create App</b>. В типе выбери <b>«Other» → «Business»</b>. Назови приложение (например,
        «Threadhunt»), укажи email. Создай.
      </>
    ),
    link: { href: 'https://developers.facebook.com/apps/', label: 'Список приложений → Create App' },
    shot: 'Экран «Create an app»: выбор типа Business и поле названия.',
  },
  {
    title: 'Добавь продукт «Threads»',
    body: (
      <>
        На странице приложения в разделе <b>Add products / Use cases</b> найди <b>«Access the Threads API»</b> и нажми{' '}
        <b>Set up</b>. Появится раздел Threads в левом меню.
      </>
    ),
    link: { href: 'https://developers.facebook.com/docs/threads/get-started', label: 'Док: Threads · Get Started' },
    shot: 'Карточка «Access the Threads API» с кнопкой «Set up».',
  },
  {
    title: 'Добавь себя как тестировщика',
    body: (
      <>
        В разделе <b>Threads → Roles / Use case settings</b> добавь свой Threads-аккаунт как <b>Threads Tester</b>. Затем
        зайди в приложение Threads на телефоне: <b>Настройки → Аккаунт → Сайты и разрешения / Приглашения</b> и прими
        приглашение. (Без принятия токен не выпустится.)
      </>
    ),
    link: { href: 'https://www.threads.net/', label: 'threads.net — принять приглашение' },
    shot: 'Блок «Threads Tester»: добавление аккаунта и статус Pending → Accepted.',
  },
  {
    title: 'Сгенерируй токен',
    body: (
      <>
        В <b>Threads → настройки use case</b> найди <b>«Token Generator / Генератор токена пользователя»</b>, выбери свой
        аккаунт, нажми <b>Generate token</b>, подтверди доступ. Скопируй длинный токен (начинается с <code>TH…</code>).
      </>
    ),
    shot: 'Блок «Token Generator» с кнопкой Generate и полем со сгенерированным токеном.',
  },
  {
    title: 'Вставь токен в Threadhunt',
    body: (
      <>
        Вернись на страницу{' '}
        <Link href="/connections" className="text-accent-ink hover:underline">
          Подключения
        </Link>{' '}
        → секция «Threads API» → <b>по токену</b> → вставь токен. Мы проверим его и сохраним зашифрованным.
        Дальше включишь автопостинг в любом поиске.
      </>
    ),
    shot: 'Инлайн-поле «Вставь токен» на странице Подключения в Threadhunt.',
  },
];

export default function ThreadsSetupPage() {
  return (
    <>
      <PageHeader title="Подключение Threads API" subtitle="Пошагово, чтобы пройти за 10–15 минут. Это временный путь — скоро будет вход в один клик." />
      <div className="max-w-2xl space-y-5 p-8">
        <Link href="/connections" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft size={15} /> К подключениям
        </Link>

        {/* Закреплённые ссылки */}
        <Card className="bg-panel/60">
          <div className="mb-2 text-sm font-medium">Закреплённые ссылки</div>
          <div className="flex flex-wrap gap-2">
            <Pin href="https://developers.facebook.com/">Портал разработчиков</Pin>
            <Pin href="https://developers.facebook.com/apps/">Мои приложения</Pin>
            <Pin href="https://developers.facebook.com/docs/threads/get-started">Док: Get Started</Pin>
            <Pin href="https://www.threads.net/">Threads (принять инвайт)</Pin>
          </div>
        </Card>

        {STEPS.map((s, i) => (
          <Card key={i}>
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display font-semibold text-accent-ink">
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold">{s.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-text/90">{s.body}</p>
                {s.link && (
                  <a
                    href={s.link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-sm text-accent-ink hover:underline"
                  >
                    {s.link.label} <ExternalLink size={13} />
                  </a>
                )}
                <Shot caption={s.shot} src={`/setup/threads-${i + 1}.png`} />
              </div>
            </div>
          </Card>
        ))}

        <Card className="border-warning/30 bg-warning/5">
          <div className="text-sm font-medium text-warning">Если что-то не выпускается</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Токен не генерируется — проверь, что принял приглашение тестировщика в приложении Threads.</li>
            <li>Аккаунт должен быть публичным (приватные Threads API не пускает).</li>
            <li>Токен живёт ~60 дней — мы продлеваем его автоматически, пока подключение активно.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function Pin({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-text hover:border-accent/40"
    >
      {children} <ExternalLink size={12} className="text-muted" />
    </a>
  );
}

// Слот под скриншот. Владелец сервиса кладёт картинку в /public (путь src) и
// заменяет этот блок на <img src={src} .../>. Пока — аккуратная подпись-заглушка.
function Shot({ caption, src }: { caption: string; src: string }) {
  return (
    <figure className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-line bg-panel-2/30 px-3 py-3 text-xs text-muted">
      <ImageIcon size={14} className="shrink-0" />
      <span>
        Скриншот: {caption} <span className="opacity-50">({src})</span>
      </span>
    </figure>
  );
}
