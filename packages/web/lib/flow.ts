// Модель онбординг-конструктора: страницы → блоки. Используется и билдером (кабинет),
// и публичным рендером (страница кандидата). Хранится JSON-строкой в Search.obFlow.

export type BlockType =
  | 'company' // авто-презентация компании (из «Голоса бренда»)
  | 'positions' // другие активные вакансии компании
  | 'deadline' // таймер обратного отсчёта до дедлайна сдачи
  | 'heading'
  | 'text'
  | 'image'
  | 'video'
  | 'file'
  | 'faq'
  | 'support'
  | 'field'
  | 'choice'
  | 'multi'
  | 'scale'
  | 'consent'
  | 'submit';

export interface Block {
  id: string;
  type: BlockType;
  text?: string; // heading / text / текст согласия / текст поддержки
  label?: string; // подпись поля/вопроса/кнопки/файла
  key?: string; // ключ для сохранения ответа
  url?: string; // image/video/file/support — ссылка
  input?: 'text' | 'textarea' | 'email' | 'url' | 'number' | 'phone'; // тип поля
  options?: string[]; // варианты для choice/multi
  faq?: { q: string; a: string }[]; // вопросы-ответы
  max?: number; // шкала 1..max
  minLabel?: string; // подпись левого края шкалы
  maxLabel?: string; // подпись правого края шкалы
  required?: boolean;
  // ── Блок «О компании»: оформление и ручные переопределения ──
  // name/about берутся из «Голоса бренда», но их можно переопределить здесь
  // (label = название, text = «о компании»). logo/cover — картинки, style — пресет.
  logo?: string; // URL логотипа компании
  cover?: string; // URL фоновой обложки
  style?: string; // пресет оформления: minimal | gradient | dark | bold
  perks?: string[]; // чипы-преимущества компании (переопределяют perks из «Голоса бренда»)
  picks?: { label: string; emoji?: string }[]; // блок «Другие вакансии»: ручной список с эмодзи (пусто = авто из активных поисков)
}

export interface Page {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Flow {
  pages: Page[];
  accent?: string; // акцентный цвет страницы кандидата (hex) — перекрашивает кнопки/прогресс/чипы
}

let _n = 0;
export const uid = (p = 'b') => `${p}${Date.now().toString(36)}${(_n++).toString(36)}`;

export const BLOCK_LABELS: Record<BlockType, string> = {
  company: 'О компании (авто)',
  positions: 'Другие вакансии',
  deadline: 'Таймер / дедлайн',
  heading: 'Заголовок',
  text: 'Текст',
  image: 'Фото',
  video: 'Видео',
  file: 'Файл / материалы',
  faq: 'Вопросы-ответы',
  support: 'Поддержка (контакт)',
  field: 'Поле ввода',
  choice: 'Один из вариантов',
  multi: 'Несколько вариантов',
  scale: 'Шкала / оценка',
  consent: 'Согласие (галочка)',
  submit: 'Сдача (ссылка)',
};

export function newBlock(type: BlockType): Block {
  const id = uid();
  const key = 'q_' + id.slice(-4);
  switch (type) {
    case 'company':
      return { id, type }; // данные подтянутся автоматически из «Голоса бренда»
    case 'positions':
      return { id, type };
    case 'deadline':
      return { id, type, text: 'До дедлайна сдачи' };
    case 'heading':
      return { id, type, text: 'Заголовок' };
    case 'text':
      return { id, type, text: 'Текст для кандидата…' };
    case 'image':
      return { id, type, url: '' };
    case 'video':
      return { id, type, url: '' };
    case 'file':
      return { id, type, url: '', label: 'Скачать материалы / тестовое' };
    case 'faq':
      return { id, type, faq: [{ q: 'Что нужно сделать?', a: 'Опиши ответ…' }] };
    case 'support':
      return { id, type, text: 'Не понятно задание? Напиши нам — поможем.', label: 'Написать', url: '' };
    case 'field':
      return { id, type, key: 'field_' + id.slice(-3), label: 'Вопрос', input: 'text', required: true };
    case 'choice':
      return { id, type, key, label: 'Выбери вариант', options: ['Вариант 1', 'Вариант 2'], required: true };
    case 'multi':
      return { id, type, key, label: 'Отметь подходящее', options: ['Вариант 1', 'Вариант 2', 'Вариант 3'] };
    case 'scale':
      return { id, type, key, label: 'Оцени по шкале', max: 5, minLabel: 'мало', maxLabel: 'много', required: true };
    case 'consent':
      return { id, type, text: 'Согласен(на) с условиями.' };
    case 'submit':
      return { id, type, key: 'work_url', label: 'Ссылка на тестовое' };
  }
}

export function newPage(title = 'Новая страница'): Page {
  return { id: uid('p'), title, blocks: [] };
}

// Дефолтный флоу (классический онбординг).
export function defaultFlow(): Flow {
  return {
    pages: [
      {
        id: uid('p'),
        title: 'О компании',
        blocks: [
          { id: uid(), type: 'company' },
          { id: uid(), type: 'positions' },
        ],
      },
      {
        id: uid('p'),
        title: 'О себе',
        blocks: [
          { id: uid(), type: 'heading', text: 'Оставь контакты' },
          { id: uid(), type: 'field', key: 'name', label: 'Как тебя зовут', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'contact', label: 'Telegram или email', input: 'text', required: true },
          { id: uid(), type: 'consent', text: 'Согласен(на) на обработку моих данных для участия в отборе.' },
        ],
      },
      {
        id: uid('p'),
        title: 'Условия и тест',
        blocks: [
          { id: uid(), type: 'text', text: 'Условия: удалёнка, сдельная оплата, быстрые выплаты.' },
          { id: uid(), type: 'heading', text: 'Тестовое задание' },
          { id: uid(), type: 'text', text: 'Опиши тестовое здесь…' },
        ],
      },
      {
        id: uid('p'),
        title: 'Сдача',
        blocks: [
          { id: uid(), type: 'heading', text: 'Пришли ссылку на работу' },
          { id: uid(), type: 'submit', key: 'work_url', label: 'Ссылка на тестовое (Google Drive и т.п.)' },
        ],
      },
    ],
  };
}

// Встроенные шаблоны под роли (стартовая точка, дальше редактируешь в билдере).
export const FLOW_TEMPLATES: { key: string; emoji: string; label: string; flow: Flow }[] = [
  {
    key: 'editor',
    emoji: '🎬',
    label: 'Видеомонтажёр',
    flow: {
      pages: [
        { id: uid('p'), title: 'О себе', blocks: [
          { id: uid(), type: 'heading', text: 'Привет! Пару слов о тебе' },
          { id: uid(), type: 'field', key: 'name', label: 'Имя', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'contact', label: 'Telegram', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'reel', label: 'Ссылка на шоурил/работы', input: 'url' },
          { id: uid(), type: 'consent', text: 'Согласен(на) на обработку данных.' },
        ] },
        { id: uid('p'), title: 'Тестовое', blocks: [
          { id: uid(), type: 'text', text: 'Условия: поток Reels, оплата сдельно, быстрые выплаты.' },
          { id: uid(), type: 'heading', text: 'Задание' },
          { id: uid(), type: 'text', text: 'Смонтируй Reel 15–30 сек из наших исходников по референсу. Срок — 2 часа.' },
          { id: uid(), type: 'consent', text: 'На тестовый период не передаю исходники третьим лицам (NDA).' },
        ] },
        { id: uid('p'), title: 'Сдача', blocks: [
          { id: uid(), type: 'submit', key: 'work_url', label: 'Ссылка на смонтированный ролик' },
        ] },
      ],
    },
  },
  {
    key: 'designer',
    emoji: '🎨',
    label: 'Дизайнер',
    flow: {
      pages: [
        { id: uid('p'), title: 'О себе', blocks: [
          { id: uid(), type: 'heading', text: 'Расскажи о себе' },
          { id: uid(), type: 'field', key: 'name', label: 'Имя', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'contact', label: 'Telegram', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'portfolio', label: 'Behance/портфолио', input: 'url' },
          { id: uid(), type: 'consent', text: 'Согласен(на) на обработку данных.' },
        ] },
        { id: uid('p'), title: 'Тестовое', blocks: [
          { id: uid(), type: 'heading', text: 'Задание' },
          { id: uid(), type: 'text', text: 'Сделай 1 баннер/обложку по нашему брифу. Срок — 2 часа, сдай ссылкой на Figma.' },
        ] },
        { id: uid('p'), title: 'Сдача', blocks: [
          { id: uid(), type: 'submit', key: 'work_url', label: 'Ссылка на Figma' },
        ] },
      ],
    },
  },
  {
    key: 'target',
    emoji: '🎯',
    label: 'Таргетолог',
    flow: {
      pages: [
        { id: uid('p'), title: 'О себе', blocks: [
          { id: uid(), type: 'field', key: 'name', label: 'Имя', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'contact', label: 'Telegram', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'cases', label: 'Кейсы/результаты', input: 'textarea' },
          { id: uid(), type: 'consent', text: 'Согласен(на) на обработку данных.' },
        ] },
        { id: uid('p'), title: 'Мини-задача', blocks: [
          { id: uid(), type: 'heading', text: 'Стратегия' },
          { id: uid(), type: 'text', text: 'Опиши стратегию запуска для нашего оффера: аудитории, 3 связки, ожидаемые метрики.' },
          { id: uid(), type: 'submit', key: 'work_url', label: 'Ссылка на документ' },
        ] },
      ],
    },
  },
  {
    key: 'smm',
    emoji: '📱',
    label: 'SMM-менеджер',
    flow: {
      pages: [
        { id: uid('p'), title: 'Анкета', blocks: [
          { id: uid(), type: 'field', key: 'name', label: 'Имя', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'contact', label: 'Telegram', input: 'text', required: true },
          { id: uid(), type: 'choice', key: 'exp', label: 'Опыт в SMM', options: ['до 1 года', '1–3 года', '3+ года'], required: true },
          { id: uid(), type: 'multi', key: 'tools', label: 'С чем работал(а)', options: ['Reels', 'Сторис', 'Контент-план', 'Таргет', 'Аналитика'] },
          { id: uid(), type: 'consent', text: 'Согласен(на) на обработку данных.' },
        ] },
        { id: uid('p'), title: 'Мини-тест', blocks: [
          { id: uid(), type: 'heading', text: 'Задание' },
          { id: uid(), type: 'text', text: 'Контент-план на неделю (7 постов: тема + формат + 1 пример текста).' },
          { id: uid(), type: 'submit', key: 'work_url', label: 'Ссылка на документ' },
        ] },
      ],
    },
  },
  {
    key: 'copy',
    emoji: '✍️',
    label: 'Копирайтер',
    flow: {
      pages: [
        { id: uid('p'), title: 'О себе', blocks: [
          { id: uid(), type: 'field', key: 'name', label: 'Имя', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'contact', label: 'Telegram', input: 'text', required: true },
          { id: uid(), type: 'multi', key: 'niches', label: 'В каких нишах писал(а)', options: ['Инфобиз', 'E-com', 'Услуги', 'B2B', 'Личный бренд'] },
          { id: uid(), type: 'scale', key: 'self', label: 'Оцени свою грамотность', max: 5 },
          { id: uid(), type: 'consent', text: 'Согласен(на) на обработку данных.' },
        ] },
        { id: uid('p'), title: 'Тест', blocks: [
          { id: uid(), type: 'text', text: 'Напиши 2 коротких продающих поста по нашему офферу (разные углы).' },
          { id: uid(), type: 'submit', key: 'work_url', label: 'Ссылка на текст' },
        ] },
      ],
    },
  },
  {
    key: 'survey',
    emoji: '📋',
    label: 'Универсальная анкета',
    flow: {
      pages: [
        { id: uid('p'), title: 'Анкета', blocks: [
          { id: uid(), type: 'heading', text: 'Расскажи о себе' },
          { id: uid(), type: 'field', key: 'name', label: 'Имя', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'contact', label: 'Telegram / email', input: 'text', required: true },
          { id: uid(), type: 'field', key: 'rate', label: 'Желаемая ставка', input: 'text' },
          { id: uid(), type: 'choice', key: 'busy', label: 'Занятость', options: ['Полная', 'Частичная', 'Проектно'], required: true },
          { id: uid(), type: 'field', key: 'about', label: 'Пара слов о себе', input: 'textarea' },
          { id: uid(), type: 'consent', text: 'Согласен(на) на обработку данных.' },
        ] },
      ],
    },
  },
];
