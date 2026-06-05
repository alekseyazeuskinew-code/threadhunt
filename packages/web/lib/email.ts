// Модель конструктора email-цепочек: цепочка → шаги (письма) с задержкой → блоки.
// Хранится JSON-строкой в EmailSequence.steps. Рендер блоков общий для превью и
// (позже) генерации HTML-письма при отправке через Resend.

export type EmailBlockType = 'heading' | 'text' | 'button' | 'image' | 'divider' | 'spacer';

export interface EmailBlock {
  id: string;
  type: EmailBlockType;
  text?: string; // heading / text / подпись кнопки
  url?: string; // button (ссылка) / image (картинка)
  align?: 'left' | 'center';
}

export interface EmailStep {
  id: string;
  delayHours: number; // через сколько часов после предыдущего шага (для 1-го — после старта)
  subject: string;
  blocks: EmailBlock[];
}

export interface EmailSequence {
  id: string;
  name: string;
  audience: 'new_users' | 'waitlist';
  enabled: boolean;
  steps: EmailStep[];
}

let _n = 0;
export const eid = (p = 'e') => `${p}${Date.now().toString(36)}${(_n++).toString(36)}`;

export const EMAIL_BLOCK_LABELS: Record<EmailBlockType, string> = {
  heading: 'Заголовок',
  text: 'Текст',
  button: 'Кнопка',
  image: 'Картинка',
  divider: 'Разделитель',
  spacer: 'Отступ',
};

export function newBlock(type: EmailBlockType): EmailBlock {
  const base: EmailBlock = { id: eid('b'), type, align: 'left' };
  if (type === 'heading') return { ...base, text: 'Заголовок письма' };
  if (type === 'text') return { ...base, text: 'Текст письма. Расскажи, что важно для нового пользователя.' };
  if (type === 'button') return { ...base, text: 'Открыть Threadhunt', url: 'https://serene-seahorse-a5102e.netlify.app', align: 'center' };
  if (type === 'image') return { ...base, url: '' };
  return base; // divider / spacer
}

export function newStep(isFirst: boolean): EmailStep {
  return {
    id: eid('s'),
    delayHours: isFirst ? 0 : 24,
    subject: isFirst ? 'Добро пожаловать в Threadhunt 👋' : 'Не забудь подключить отбивку',
    blocks: [newBlock('heading'), newBlock('text'), newBlock('button')],
  };
}

export function emptySequence(): Omit<EmailSequence, 'id'> {
  return { name: 'Онбординг новых пользователей', audience: 'new_users', enabled: false, steps: [newStep(true)] };
}

// Человеческая подпись задержки шага.
export function delayLabel(delayHours: number, isFirst: boolean): string {
  if (isFirst) return 'сразу после регистрации';
  if (delayHours <= 0) return 'сразу после предыдущего';
  if (delayHours % 24 === 0) return `через ${delayHours / 24} дн. после предыдущего`;
  return `через ${delayHours} ч после предыдущего`;
}
