// Контракт между расширением (агентом) и сервером.
// Этим типам следуют обе стороны — меняешь здесь, меняется везде.

import type { Keyword } from './keywords.js';

/** Одно правило отбивки для активного поиска, отдаётся агенту. */
export interface AgentSearchRule {
  searchId: string;
  title: string;
  keywords: Keyword[];
  /** Тексты ответов; агент выбирает по rotation на своей стороне или берёт первый. */
  replyTemplates: { id: string; text: string }[];
  rotation: 'sequential' | 'random';
  /** Ключи людей, которым уже отвечали (дедуп). Источник правды — сервер. */
  alreadyReplied: string[];
  /** Анти-бан: пауза между ответами и дневной лимит. */
  minDelayMs: number;
  maxRepliesPerDay: number;
  /** База персональной ссылки онбординга (если включено). Агент дописывает в конец:
   *  `${obLink}${encodeURIComponent(fromUserKey)}`. Пусто = не прикреплять. */
  obLink?: string;
  /** Авто-ответ на КОММЕНТАРИИ под постами (через расширение, не API). Если enabled —
   *  бот сканит комменты своих постов и отвечает: mode 'keyword' (только с кодовым словом)
   *  или 'all' (на любой коммент). replyText — текст ответа. */
  commentRule?: { enabled: boolean; mode: 'keyword' | 'all'; replyText: string };
}

/** Лимиты + параметры прохода отбивки (на аккаунт). Расширение строго соблюдает. */
export interface AgentLimits {
  minDelayMs: number; // пауза между ответами
  maxRepliesPerDay: number; // максимум сообщений в день
  repliesRemainingToday: number; // сколько ещё можно сегодня
  maxDialogs: number; // максимум диалогов читать за проход («чатов за проход»)
  workingHours: { enabled: boolean; from: string; to: string }; // окно «HH:MM»
  // ── Параметры прохода (настраиваются в карточке «Отбивка в директе») ──
  sweepIntervalMinutes: number; // как часто запускать обход
  safeMode: boolean; // безопасный режим: проходить и считать, но НЕ отправлять
  sections: { main: boolean; requests: boolean; hidden: boolean }; // какие разделы обходить
  runNowAt: string | null; // метка «Прогон сейчас» (ISO) — обойти расписание, если новее последнего прохода
  stopAt: string | null; // метка «Стоп» (ISO) — прервать текущий проход, если новее его начала
}

/** Запрос для research-прохода: что искать в Threads и к какому поиску относится. */
export interface AgentResearchQuery {
  searchId: string;
  query: string; // поисковый запрос (обычно название роли)
}

/** Конфиг research: сбор топовых вакансий-веток в Threads через браузер клиента. */
export interface AgentResearch {
  enabled: boolean;
  queries: AgentResearchQuery[];
  intervalMinutes: number; // как часто запускать research-проход
  maxPerQuery: number; // сколько постов собирать на один запрос
  runAt?: string | null; // «собрать сейчас»: метка, по которой агент запустит research вне расписания
}

/** ИИ-калибровка разметки под язык/вёрстку юзера: подписи кнопок, которые матчит рантайм. */
export interface CalibrationConfig {
  acceptLabels: string[]; // «Принять» запрос
  unhideLabels: string[]; // «Показать» (для Скрытых — первый шаг)
  dismissLabels: string[]; // «OK/Понятно/Продолжить» инфо-окна
  declineLabels: string[]; // «Отклонить/Удалить/Заблокировать» — НЕ нажимать
  lang?: string;
  notes?: string;
}

/** Ответ сервера на запрос задач. */
export interface AgentTasksResponse {
  /** Активен ли агент вообще (план оплачен, connection не отозван). */
  active: boolean;
  searches: AgentSearchRule[];
  /** Лимиты на аккаунт — приоритетнее полей в правилах. */
  limits: AgentLimits;
  /** Сбор топовых веток (research) — опционально. */
  research?: AgentResearch;
  /** Холостой тест отбивки запрошен из дашборда (ISO) — расширение прогонит без отправки. */
  dmTestAt?: string | null;
  /** Permalinks наших недавних опубликованных постов — где сканить комментарии (путь B).
   *  Пусто, если авто-ответ на комментарии нигде не включён. */
  commentPosts?: string[];
  /** «Перекалибровать» запрошено (ISO) ИЛИ калибровки ещё нет — расширение снимет вёрстку. */
  calibrateAt?: string | null;
  /** Готовая ИИ-калибровка разметки (если есть) — рантайм матчит кнопки по ней. */
  calibration?: CalibrationConfig | null;
  /** Сколько секунд ждать до следующего опроса. */
  pollIntervalSec: number;
}

/** Один собранный research-постом (вакансия-ветка из поиска Threads). */
export interface AgentResearchPost {
  searchId: string;
  query: string;
  threadsPostId: string;
  author?: string;
  text: string;
  permalink?: string;
  likes?: number;
  replies?: number;
  reposts?: number;
  postedAt?: string; // ISO, если удалось определить
}

export interface AgentResearchReport {
  posts: AgentResearchPost[];
}

/** Событие отбивки, которое агент отправляет серверу после действия. */
export interface AgentReplyEvent {
  searchId: string;
  /** Стабильный ключ человека (id чата из href /messages/t/<id>/). */
  fromUserKey: string;
  fromUsername?: string;
  matchedKeyword: string;
  templateId?: string;
  sent: boolean;
  /** Из какого раздела директа пришёл лид: requests | hidden | main. */
  section?: string;
  /** Вступительное сообщение кандидата (то, что он написал помимо кодового слова). */
  message?: string;
  error?: string;
  at: string; // ISO
}

export interface AgentEventsRequest {
  events: AgentReplyEvent[];
}

/** Сводка прохода отбивки — агент шлёт её серверу по завершении обхода. */
export interface AgentPassReport {
  scanned: number; // диалогов осмотрено
  sent: number; // ответов отправлено
  matched: number; // совпадений по словам найдено
  sections?: string; // какие разделы обходили (csv)
  dryRun?: boolean; // безопасный/тестовый проход
}

export interface AgentHeartbeat {
  version: string;
  /** Залогинен ли клиент в Threads в этой вкладке (агент это видит). */
  threadsLoggedIn: boolean;
}
