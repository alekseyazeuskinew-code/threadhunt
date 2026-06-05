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
}

/** Лимиты авто-отбивки (на аккаунт). Расширение строго соблюдает. */
export interface AgentLimits {
  minDelayMs: number; // пауза между ответами
  maxRepliesPerDay: number; // максимум сообщений в день
  repliesRemainingToday: number; // сколько ещё можно сегодня
  maxDialogs: number; // максимум диалогов читать за проход
  workingHours: { enabled: boolean; from: string; to: string }; // окно «HH:MM»
}

/** Ответ сервера на запрос задач. */
export interface AgentTasksResponse {
  /** Активен ли агент вообще (план оплачен, connection не отозван). */
  active: boolean;
  searches: AgentSearchRule[];
  /** Лимиты на аккаунт — приоритетнее полей в правилах. */
  limits: AgentLimits;
  /** Сколько секунд ждать до следующего опроса. */
  pollIntervalSec: number;
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
  error?: string;
  at: string; // ISO
}

export interface AgentEventsRequest {
  events: AgentReplyEvent[];
}

export interface AgentHeartbeat {
  version: string;
  /** Залогинен ли клиент в Threads в этой вкладке (агент это видит). */
  threadsLoggedIn: boolean;
}
