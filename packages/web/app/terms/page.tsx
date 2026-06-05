import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';

// Условия использования (черновик — перед запуском показать юристу).
export const metadata = { title: 'Условия использования — Threadhunt' };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-lg">
        <Wordmark />
      </Link>
      <h1 className="mt-8 text-2xl font-semibold">Условия использования</h1>
      <p className="mt-2 text-sm text-muted">Кратко и по делу. Это черновик — финальную версию утверждает юрист.</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-text/90">
        <Section title="1. Что такое Threadhunt">
          Threadhunt — инструмент автоматизации найма через Threads: помогает публиковать посты и отвечать в директе по
          кодовым словам. Сервис предоставляет функциональность «как есть», вы используете её по своему усмотрению.
        </Section>

        <Section title="2. Ответственность за аккаунт Threads — на вас">
          Автоматизация действий в Threads (массовые ответы в директе, частые публикации) находится в «серой зоне»
          правил Threads/Meta. <b>Существует риск ограничений или блокировки вашего аккаунта.</b> Используя сервис, вы
          подтверждаете, что понимаете этот риск и принимаете его на себя. Threadhunt не несёт ответственности за любые
          ограничения, блокировки, потерю доступа или иной ущерб вашему аккаунту Threads.
        </Section>

        <Section title="3. Вы отвечаете за соблюдение правил площадки">
          Вы самостоятельно знакомитесь с официальными условиями{' '}
          <a href="https://help.instagram.com/769983657850450" target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
            Threads / Meta
          </a>{' '}
          и условиями{' '}
          <a href="https://developers.facebook.com/docs/threads" target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
            Threads API
          </a>{' '}
          и решаете, какие действия выполнять. Мы рекомендуем разумные лимиты и встраиваем предохранители, но финальное
          решение — за вами.
        </Section>

        <Section title="4. Расширение работает в вашем браузере">
          Авто-отбивка в директе выполняется расширением на вашем устройстве, под вашей сессией и вашим IP. Мы не храним
          ваши пароли и cookie Threads. Токен для публикации (если подключаете) хранится в зашифрованном виде.
        </Section>

        <Section title="5. Без гарантий результата">
          Мы не гарантируем количество откликов, найм или работоспособность при изменениях на стороне Threads. Сервис
          может временно не работать, если Threads меняет вёрстку или политику.
        </Section>

        <Section title="6. Оплата">
          Подписка списывается по выбранному тарифу. Лимиты (число поисков, генераций, постов в день) зависят от тарифа
          и могут меняться для защиты аккаунтов и стабильности сервиса.
        </Section>
      </div>

      <div className="mt-10 border-t border-line pt-6 text-sm text-muted">
        Вопросы — на info@thread-hunt.com ·{' '}
        <Link href="/signup" className="text-accent-ink hover:underline">
          вернуться к регистрации
        </Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-base font-semibold text-text">{title}</h2>
      <p>{children}</p>
    </section>
  );
}
