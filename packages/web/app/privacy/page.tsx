import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';

// Политика конфиденциальности (черновик — перед запуском показать юристу).
// Нужна для подачи на App Review Meta (Threads API / Marketing API).
export const metadata = { title: 'Политика конфиденциальности — Threadhunt' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-lg">
        <Wordmark />
      </Link>
      <h1 className="mt-8 text-2xl font-semibold">Политика конфиденциальности</h1>
      <p className="mt-2 text-sm text-muted">Какие данные мы собираем, зачем и как их удалить. Черновик — финальную версию утверждает юрист.</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-text/90">
        <Section title="1. Какие данные мы собираем">
          <ul className="ml-4 list-disc space-y-1">
            <li><b>Аккаунт:</b> email и (по желанию) имя.</li>
            <li><b>Threads:</b> при подключении через официальный API — ваш профиль (id, username) и токен доступа для публикации от вашего имени.</li>
            <li><b>Meta Ads:</b> при подключении рекламного кабинета — его идентификатор, название бизнеса и токен доступа.</li>
            <li><b>Рабочие данные:</b> поиски, тексты постов, кодовые слова, кандидаты и заметки, которые вы заводите сами.</li>
          </ul>
        </Section>

        <Section title="2. Зачем">
          Только чтобы сервис работал: публиковать посты по вашему запросу, отвечать в директе по кодовым словам, вести
          кандидатов и (опционально) собирать рекламные кампании. Мы не продаём ваши данные третьим лицам.
        </Section>

        <Section title="3. Как храним">
          Токены доступа (Threads, Meta) хранятся <b>в зашифрованном виде</b> (AES-256-GCM) и не отдаются в API. Пароль
          хранится в виде криптографического хэша. Авто-отбивка в директе выполняется расширением в вашем браузере —
          ваши пароли и cookie Threads мы не получаем и не храним.
        </Section>

        <Section title="4. Передача третьим сторонам">
          <ul className="ml-4 list-disc space-y-1">
            <li><b>Meta / Threads</b> — для публикации и рекламы через официальные API (только когда вы это инициируете).</li>
            <li><b>Anthropic (Claude)</b> — тексты заданий на ИИ-генерацию (тема поиска, «голос бренда»). Персональные данные кандидатов туда не отправляются.</li>
          </ul>
        </Section>

        <Section title="5. Удаление данных">
          Вы можете отключить подключения в разделе «Подключения» в любой момент. Чтобы полностью удалить аккаунт и все
          данные — напишите на <a href="mailto:support@threadhunt.app" className="text-accent-ink hover:underline">support@threadhunt.app</a>.
          Для Meta мы поддерживаем автоматические колбэки <b>deauthorize</b> и <b>data deletion</b>: при отзыве доступа в
          настройках Meta связанные токены и подключение удаляются автоматически.
        </Section>

        <Section title="6. Хранение и срок">
          Данные храним, пока активен ваш аккаунт. После удаления аккаунта связанные данные удаляются в разумный срок,
          за исключением того, что обязаны хранить по закону.
        </Section>
      </div>

      <div className="mt-10 border-t border-line pt-6 text-sm text-muted">
        Вопросы — на support@threadhunt.app ·{' '}
        <Link href="/terms" className="text-accent-ink hover:underline">Условия использования</Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-base font-semibold text-text">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
