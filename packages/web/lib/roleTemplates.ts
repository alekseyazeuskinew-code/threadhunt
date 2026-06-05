// Библиотека пресетов ролей для малого бизнеса/HR. Это СТАРТОВЫЕ ТОЧКИ:
// они заполняют название, кодовые слова и описание-затравку. Финальные посты
// всё равно собирает ИИ под индивидуальные детали клиента — поэтому даже при
// одном пресете тексты у разных команд получаются разными (см. ai/generate.ts).

export interface RoleTemplate {
  key: string;
  emoji: string;
  title: string;
  keywords: string[];
  description: string;
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: 'editor', emoji: '🎬', title: 'Видеомонтажёр', keywords: ['монтаж', 'монтажёр'], description: 'Монтаж Reels/Shorts, удалёнка, опыт от года, оплата сдельно.' },
  { key: 'designer', emoji: '🎨', title: 'Графдизайнер', keywords: ['дизайн', 'дизайнер'], description: 'Креативы, баннеры, оформление соцсетей. Figma/Photoshop.' },
  { key: 'target', emoji: '🎯', title: 'Таргетолог', keywords: ['таргет', 'таргетолог'], description: 'Запуск и ведение рекламы в соцсетях, опыт с бюджетами.' },
  { key: 'smm', emoji: '📱', title: 'SMM-менеджер', keywords: ['смм', 'smm'], description: 'Контент-план, ведение аккаунтов, сторис и вовлечённость.' },
  { key: 'copy', emoji: '✍️', title: 'Копирайтер', keywords: ['копирайт', 'текст'], description: 'Тексты для постов и продаж, грамотность, скорость.' },
  { key: 'motion', emoji: '✨', title: 'Моушн-дизайнер', keywords: ['моушн', 'motion'], description: 'Анимация, After Effects, динамичные ролики.' },
  { key: 'dev', emoji: '💻', title: 'Веб-разработчик', keywords: ['разработчик', 'верстка'], description: 'Лендинги и сайты, адаптив, аккуратность к срокам.' },
  { key: 'assistant', emoji: '🗂', title: 'Ассистент', keywords: ['ассистент', 'помощник'], description: 'Операционка, переписки, организация задач, удалённо.' },
  { key: 'sales', emoji: '📈', title: 'Менеджер продаж', keywords: ['продажи', 'sales'], description: 'Обработка лидов, переписка, закрытие сделок.' },
];
