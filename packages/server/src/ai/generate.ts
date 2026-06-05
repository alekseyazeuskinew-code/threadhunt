// ИИ-генерация постов-приманок и шаблонов отбивки.
// Claude через @anthropic-ai/sdk (Haiku — дёшево и достаточно для коротких текстов).
//
// КАК ДОБИВАЕМСЯ КАЧЕСТВА (без файнтюна):
//   1) few-shot — в системный промпт зашиты примеры сильных «цепляющих» постов;
//   2) приёмы копирайтинга в инструкции (хук в первой строке, конкретика, без клише);
//   3) «Голос бренда» (BrandProfile) — персонализация под клиента: тон, фишки,
//      пример его удачного поста. Это и есть «обучение под себя» — клиент задаёт
//      критерии, ИИ их повторяет. Уникальность на масштабе: см. описание поиска + углы.
//
// GRACEFUL: при ошибке API (rate limit, сбой) и при отсутствии ключа — отдаём
// локальные демо-вариации, никогда не падаем. Возвращаем source: 'ai' | 'demo'.

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';

const MODEL = 'claude-haiku-4-5-20251001';
const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

const ANGLES = ['боль/проблема', 'выгода/оффер', 'любопытство/интрига', 'личный тон', 'прямой призыв', 'история/кейс'];

export interface BrandVoice {
  companyName?: string;
  niche?: string;
  tone?: string;
  audience?: string;
  perks?: string;
  signature?: string;
  sample?: string;
  avoid?: string;
}

export interface GenOutput {
  items: string[];
  source: 'ai' | 'demo';
}

// few-shot + формула «постов-приманок» (по реальным залетевшим постам). Якорь качества.
const SYSTEM_POSTS = `Ты пишешь пост-приманку для найма в Threads — живой, от первого лица, как сообщение друга (НЕ вакансия с HH). Цель — не описать вакансию, а спровоцировать написать кодовое слово в директ. Алгоритм Threads любит человеческие эмоциональные посты.

Структура (сверху вниз):
1. ХУК (1 строка): обращение к площадке («Тредс, найди…», «Тредссс, я люблю тебя»), или к роли во мн.ч. с эмоцией/вопросом («Дизайнеры, вы тут??????», «Коллеги-таргетологи, найдитесь 🙏»), или лёгкий юмор/самоирония.
2. Кто нужен — живым языком, 1–2 «человеческих» критерия (насмотренность, горят глаза, отличить г-дизайн от не г).
3. Конкретика — формат/занятость/оплата/объём (числа, часы, деньги: «5/2, 3 часа в день», «15-20 креативов/нед, 500₽ за слайд», «удалёнка, плачу вовремя»).
4. (опц.) Плюсы команды буллетами; (опц.) вирусный механизм «скинь другу/подруге, если в поисках».
5. CTA с кодовым словом — главный элемент: Пиши «{кодовое слово}» в директ + 1 эмодзи. (опц. дедлайн «закрываем 30 марта в 21:00».)

Тон: на «ты», уверенно, дружелюбно, с лёгким юмором — как живой человек, не отдел кадров. Символы внимания (??????, !!!, растянутые буквы «Тредссс») — дозированно 1–2 на пост. Эмодзи (🤝🙏💪🔥🎬🎨) — 1–3 по смыслу, не декор. Длина 2–5 коротких строк. РАЗНЫЕ заходы под роли — не повторяй один шаблон.
Избегай: канцелярита («требуется специалист», «обязанности», «коммуникабельность»), клише («динамично развивающаяся компания», «дружный коллектив», «командный игрок»), гарантий, стен текста, перебора символов/эмодзи.

Примеры эталонного стиля (НЕ копировать дословно):
- «Монтажёры, вы тут?????? Отзовитесь!!! Беру 1-2 на постоянку, 15-20 роликов в неделю. Деньги вовремя, без душнилова. Кидай портфолио и слово «монтаж» в директ 🎬»
- «Коллеги-таргетологи, найдитесь 🙏 Расширяю трафик-команду — нужен ассистент с горящими глазами. Сильная база и отделы дизайна+видео. Ставь «таргет» в директ — пришлю бриф 💪»
- «Дизайнеры карточек, вы Тут?????? Беру 2 на постоянку, 15-20 креативов в неделю, 500₽ за слайд. Работы + слово «дизайн» в директ 🎨»
- «Тредсс, найди ассистента с шилом в попе 🤝 Нужен с насмотренностью: нейронки, эксель, отличить г-дизайн от не г, собрать хаос в порядок. Пиши «ассистент» в директ.»

Верни СТРОГО JSON-массив строк, без markdown.`;

const SYSTEM_REPLIES = `Ты пишешь авто-ответы для директа Threads при найме.
Кандидат прислал кодовое слово — бот отвечает этим текстом.
Тепло, коротко, человечно, с чётким следующим шагом (куда перейти/что прислать).
Варианты отличаются тоном и формулировками. Верни СТРОГО JSON-массив строк, без markdown.`;

function brandBlock(b?: BrandVoice): string {
  if (!b) return '';
  const lines: string[] = [];
  if (b.companyName) lines.push(`Компания/проект: ${b.companyName}`);
  if (b.niche) lines.push(`Ниша: ${b.niche}`);
  if (b.tone) lines.push(`Тон: ${b.tone}`);
  if (b.audience) lines.push(`Аудитория: ${b.audience}`);
  if (b.perks) lines.push(`Чем привлекаем: ${b.perks}`);
  if (b.signature) lines.push(`Куда вести/подпись: ${b.signature}`);
  if (b.avoid) lines.push(`НЕ использовать: ${b.avoid}`);
  if (b.sample) lines.push(`Примеры удачных постов клиента (эталон ТОНА — повтори стиль, не копируй дословно):\n${b.sample}`);
  return lines.length ? `\nГолос бренда (соблюдай строго):\n${lines.join('\n')}\n` : '';
}

export interface GenerateInput {
  title: string;
  description: string;
  keyword: string;
  count: number;
  brand?: BrandVoice;
  brief?: string; // бриф/условия от пользователя на этой генерации (цена, формат, куда писать)
}

export async function generatePosts(input: GenerateInput): Promise<GenOutput> {
  if (!client) return { items: demoPosts(input), source: 'demo' };
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM_POSTS, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content:
            `Вакансия: ${input.title}\n` +
            `Описание (используй детали для уникальности): ${input.description || '—'}\n` +
            (input.brief ? `Бриф/условия (ОБЯЗАТЕЛЬНО учти и впиши в посты — цена, формат, занятость, куда писать): ${input.brief}\n` : '') +
            `Кодовое слово для директа: «${input.keyword}»\n` +
            brandBlock(input.brand) +
            `Сгенерируй ${input.count} РАЗНЫХ вариантов. Углы подачи по кругу: ${ANGLES.join(', ')}.`,
        },
      ],
    });
    const parsed = parseJsonArray(textOf(msg));
    return parsed ? { items: parsed, source: 'ai' } : { items: demoPosts(input), source: 'demo' };
  } catch {
    return { items: demoPosts(input), source: 'demo' }; // graceful
  }
}

export async function generateReplies(input: {
  title: string;
  description: string;
  redirectTarget: string;
  count: number;
  brand?: BrandVoice;
}): Promise<GenOutput> {
  if (!client) return { items: demoReplies(input), source: 'demo' };
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: [{ type: 'text', text: SYSTEM_REPLIES, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content:
            `Вакансия: ${input.title}\nОписание: ${input.description || '—'}\n` +
            `Куда перенаправляем кандидата: ${input.redirectTarget || '—'}\n` +
            brandBlock(input.brand) +
            `Сгенерируй ${input.count} разных вариантов авто-ответа.`,
        },
      ],
    });
    const parsed = parseJsonArray(textOf(msg));
    return parsed ? { items: parsed, source: 'ai' } : { items: demoReplies(input), source: 'demo' };
  } catch {
    return { items: demoReplies(input), source: 'demo' };
  }
}

// ── Генерация документа онбординга (тест / условия / NDA) — один текст ──
export type DocKind = 'test' | 'conditions' | 'nda';

const DOC_SYSTEM: Record<DocKind, string> = {
  test: 'Ты составляешь чёткое тестовое задание для найма. Коротко и по делу: что сделать, в каком виде сдать, срок (1–2 часа), 2–3 критерия оценки. Без воды. Только текст.',
  conditions: 'Ты описываешь условия участия/работы для кандидата: формат, занятость, оплата, что предлагаем. Коротко, по-человечески. Только текст.',
  nda: 'Ты пишешь короткое соглашение о неразглашении (NDA) на тестовый период простым языком, 1–2 абзаца, без юридического канцелярита. Только текст.',
};

export async function generateDoc(
  kind: DocKind,
  input: { title: string; description: string; brand?: BrandVoice },
): Promise<{ text: string; source: 'ai' | 'demo' }> {
  if (!client) return { text: demoDoc(kind, input.title), source: 'demo' };
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: [{ type: 'text', text: DOC_SYSTEM[kind], cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Роль: ${input.title}\nОписание: ${input.description || '—'}\n${brandBlock(input.brand)}Сгенерируй ${kind === 'test' ? 'тестовое задание' : kind === 'nda' ? 'NDA' : 'условия участия'}.`,
        },
      ],
    });
    const text = textOf(msg).trim();
    return text ? { text, source: 'ai' } : { text: demoDoc(kind, input.title), source: 'demo' };
  } catch {
    return { text: demoDoc(kind, input.title), source: 'demo' };
  }
}

function demoDoc(kind: DocKind, title: string): string {
  const role = title.toLowerCase();
  if (kind === 'conditions') return `Удалёнка, гибкий график, оплата сдельно, быстрые выплаты, чёткое ТЗ. Ищем ${role} в команду на постоянку.`;
  if (kind === 'nda') return `На время тестового периода обязуюсь не передавать третьим лицам исходные материалы, доступы и внутреннюю информацию, полученные в ходе сотрудничества.`;
  return `Тестовое задание для роли «${title}»: выполни небольшую задачу по профилю (по нашему референсу). Срок — 2 часа. Сдай ссылкой (Google Drive/облако). Оцениваем: качество, скорость, соответствие ТЗ.`;
}

function textOf(msg: any): string {
  return msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
}

function parseJsonArray(text: string): string[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const arr = JSON.parse(cleaned);
    return Array.isArray(arr) && arr.length ? arr.map(String) : null;
  } catch {
    return null;
  }
}

// ── Демо-фолбэк (локальные вариации по углам + детали описания) ──
function demoPosts(i: GenerateInput): string[] {
  const role = i.title.toLowerCase();
  const detail = i.description ? ` ${i.description.split(/[.,;]/)[0].trim().toLowerCase()}.` : '';
  const variants = [
    `Расширяю команду: ищу ${role}.${detail} Если про тебя — кинь «${i.keyword}» в директ, обсудим.`,
    `Знаешь сильного ${role}? Или сам ${role}? Пиши «${i.keyword}» — расскажу условия.`,
    `${i.title} нужен ещё вчера 🙂${detail} Кодовое слово «${i.keyword}» в личку.`,
    `Беру в команду ${role} на постоянку. Без созвонов-марафонов — сразу к делу. Слово-ключ: «${i.keyword}».`,
    `Хочешь работать как ${role} в адекватной команде?${detail} Напиши «${i.keyword}» в директ.`,
    `Открыта позиция: ${i.title}. Откликнуться просто — «${i.keyword}» мне в сообщения.`,
  ];
  return variants.slice(0, i.count);
}

function demoReplies(i: { redirectTarget: string; count: number }): string[] {
  const to = i.redirectTarget || 'в личку';
  return [
    `Привет! Спасибо за отклик 🙌 Напиши, пожалуйста, ${to} — там пришлю детали и тестовое.`,
    `О, супер! Расскажи в двух словах про опыт и кинь пример работ ${to}.`,
    `Привет! Рад, что откликнулся. Перейдём ${to} — задам пару вопросов и обсудим условия.`,
    `Спасибо! Чтобы не потеряться — продублируй сообщение ${to}, там и продолжим.`,
  ].slice(0, i.count || 4);
}
