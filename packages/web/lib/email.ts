// Модель конструктора email-цепочек: цепочка → шаги (письма) с задержкой → блоки.
// Хранится JSON-строкой в EmailSequence.steps. Рендер блоков общий для превью и
// (позже) генерации HTML-письма при отправке через Resend.

export type EmailBlockType = 'heading' | 'text' | 'button' | 'image' | 'divider' | 'spacer';

export type EmailFont = 'system' | 'arial' | 'verdana' | 'tahoma' | 'trebuchet' | 'georgia' | 'times' | 'courier';

export interface EmailBlock {
  id: string;
  type: EmailBlockType;
  text?: string; // heading / text / подпись кнопки
  url?: string; // button (ссылка) / image (картинка)
  align?: 'left' | 'center' | 'right';
  width?: 'full' | 'half' | 'small'; // image: ширина (100% / 50% / 30%)
  linkUrl?: string; // image: куда ведёт клик по картинке (необязательно)
  // Оформление текста (heading / text / button):
  fontFamily?: EmailFont;
  fontSize?: number; // px
  bold?: boolean;
  italic?: boolean;
  color?: string; // #rrggbb
}

export interface EmailStep {
  id: string;
  delayHours: number; // через сколько часов после предыдущего шага (для 1-го — после старта)
  subject: string;
  blocks: EmailBlock[];
}

// Сегмент-фильтры получателей цепочки.
export interface EmailSegment {
  statuses?: string[]; // waitlist: new | invited | converted
  sourceContains?: string; // waitlist: подстрока в источнике
  withPromo?: 'any' | 'with' | 'without'; // waitlist: есть ли промокод
  plans?: string[]; // users: FREE | PRO | VIP
  activation?: 'any' | 'connected' | 'not_connected' | 'with_lead' | 'no_lead'; // users
  signupWithinDays?: number; // оба: только за последние N дней
}

export interface EmailSequence {
  id: string;
  name: string;
  audience: 'new_users' | 'waitlist';
  enabled: boolean;
  steps: EmailStep[];
  segment?: EmailSegment;
}

// Доступные шрифты для UI.
export const EMAIL_FONTS: { value: EmailFont; label: string }[] = [
  { value: 'system', label: 'Системный (sans)' },
  { value: 'arial', label: 'Arial' },
  { value: 'verdana', label: 'Verdana' },
  { value: 'tahoma', label: 'Tahoma' },
  { value: 'trebuchet', label: 'Trebuchet MS' },
  { value: 'georgia', label: 'Georgia (serif)' },
  { value: 'times', label: 'Times New Roman' },
  { value: 'courier', label: 'Courier (моно)' },
];
export const EMAIL_FONT_CSS: Record<EmailFont, string> = {
  system: '-apple-system,Segoe UI,Roboto,Arial,sans-serif',
  arial: 'Arial,Helvetica,sans-serif',
  verdana: 'Verdana,Geneva,sans-serif',
  tahoma: 'Tahoma,Geneva,sans-serif',
  trebuchet: "'Trebuchet MS',Helvetica,sans-serif",
  georgia: "Georgia,'Times New Roman',serif",
  times: "'Times New Roman',Times,serif",
  courier: "'Courier New',Courier,monospace",
};

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
  if (type === 'image') return { ...base, url: '', width: 'full', align: 'center' };
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
