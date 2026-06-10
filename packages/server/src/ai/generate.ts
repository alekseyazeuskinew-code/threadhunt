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

// Форматы/«ходы» постов — пользователь выбирает, какие хочет, и ИИ делает по
// варианту на каждый. Это про то, ЧТОБЫ ВЕТКИ ЗАХОДИЛИ: разные роли реагируют на
// разные крючки (по дизайнерам заходит одно, по монтажу — другое), поэтому полезно
// гонять несколько форматов и смотреть, что даёт директы.
export const POST_FORMATS: Record<string, string> = {
  funny: 'СМЕШНОЙ ХУК: первая строка — шутка/мем/самоирония, неожиданно, вызывает улыбку. Прикол уместный, не клоунада.',
  provocative: 'ПРОВОКАЦИЯ/ВЫЗОВ: задень за живое, «слабо?», лёгкий троллинг роли («монтажёры, вы вообще существуете?»), без оскорблений.',
  price_low: 'ЦЕНОВОЙ ЯКОРЬ ВНИЗ: низкий порог входа как крючок — простая задача/понятный минимум («старт от …», «всего пара часов в день»), чтобы легко откликнуться.',
  price_high: 'ЦЕНОВОЙ ЯКОРЬ ВВЕРХ: высокая/премиальная оплата как фильтр статуса («плачу выше рынка», «X₽ за слайд/ролик») — притягивает сильных, повышает серьёзность.',
  intrigue: 'ИНТРИГА: недосказанность, «детали в директе», вопрос, который хочется дочитать; не раскрывай всё в посте.',
  story: 'МИНИ-ИСТОРИЯ/КЕЙС: короткая история «искал — и вот что вышло», живые детали, человеческая эмоция.',
  urgency: 'ДЕФИЦИТ/ДЕДЛАЙН: мало мест и срок («беру 1–2», «закрываю в пятницу»), мягко, без давления-впаривания.',
  social_proof: 'СОЦДОКАЗАТЕЛЬСТВО: «уже собрал команду из…», очередь откликов, результаты — раздаёт доверие.',
  challenge: 'ТЕСТ-КРЮЧОК: вшей микро-задачу/вопрос по профилю прямо в пост — кто «решает», тот пишет слово; фильтрует и вовлекает.',
};
export const POST_FORMAT_LABELS: Record<string, string> = {
  funny: 'Смешной хук',
  provocative: 'Провокация',
  price_low: 'Цена-якорь ↓',
  price_high: 'Цена-якорь ↑',
  intrigue: 'Интрига',
  story: 'История/кейс',
  urgency: 'Дефицит/дедлайн',
  social_proof: 'Соцдоказательство',
  challenge: 'Тест-крючок',
};

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

ЧТОБЫ ВЕТКА ЗАХОДИЛА (важно — алгоритм и люди реагируют на крючок): пробуй разные ходы. Юмор/прикол и лёгкая провокация в первой строке резко поднимают отклик. Ценовые якоря — сильный приём: иногда низкий порог («старт от …», «всего пара часов») как лёгкий вход, иногда высокая оплата («плачу выше рынка», «X₽ за слайд») как фильтр статуса — выбирай по роли. Микро-вопрос/тест в посте вовлекает («кто отличит хороший рез от плохого — пиши слово»). Разные роли заходят на разные крючки: если «в лоб» не залетает (частый случай по монтажу) — меняй угол на юмор/провокацию/историю.
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
  formats?: string[]; // выбранные «ходы»/тон (ключи POST_FORMATS); пусто = по углам ANGLES
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
            (input.formats && input.formats.length
              ? `Сгенерируй ${input.count} РАЗНЫХ вариантов, распределив по этим форматам/ходам (по кругу, по варианту на формат):\n` +
                input.formats.map((f) => `- ${POST_FORMATS[f] || f}`).join('\n')
              : `Сгенерируй ${input.count} РАЗНЫХ вариантов. Углы подачи по кругу: ${ANGLES.join(', ')}.`),
        },
      ],
    });
    const parsed = parseJsonArray(textOf(msg));
    return parsed ? { items: parsed, source: 'ai' } : { items: demoPosts(input), source: 'demo' };
  } catch {
    return { items: demoPosts(input), source: 'demo' }; // graceful
  }
}

// ── Генерация ЦЕПОЧКИ веток (пост + ответвления под ним) ──
// Цепочка = корневой пост-хук + 1–2 ответа-«ветки», которые догоняют деталями и
// усиливают охват (алгоритм Threads буститит активные обсуждения под постом).
// Возвращаем массив цепочек; каждая цепочка — массив текстов сегментов.
const SYSTEM_CHAIN = `Ты пишешь ЦЕПОЧКУ постов-приманок для найма в Threads: корневой пост + 1–2 ответа-«ветки» под ним (как стиль bot.js/постов-приманок). Цель — спровоцировать написать кодовое слово в директ и поднять охват за счёт продолжения в ветке.

Правила цепочки:
1. Сегмент 1 (КОРЕНЬ) — сильный хук + кто нужен, коротко. НЕ вываливай все детали — оставь, что раскрыть в ветке.
2. Сегмент 2 (ВЕТКА) — догоняет конкретикой: формат/занятость/оплата/объём (числа, деньги), 1–2 плюса команды.
3. Сегмент 3 (ВЕТКА, опционально) — усиление: дедлайн/дефицит, вирусный приём («скинь другу»), и ФИНАЛЬНЫЙ CTA с кодовым словом «{кодовое слово}» в директ + эмодзи.
Если делаешь 2 сегмента — CTA с кодовым словом ставь во второй. CTA с кодовым словом ОБЯЗАТЕЛЕН в последнем сегменте.

Тон: на «ты», живо, с лёгким юмором, как человек, а не отдел кадров. Эмодзи 1–3 по смыслу. Каждый сегмент — 1–4 коротких строки. Избегай канцелярита и клише.

Верни СТРОГО JSON-массив цепочек, где каждая цепочка — массив строк (сегментов), без markdown. Пример формата: [["корень…","ветка с деталями…","ветка с CTA «слово» 🎬"], ["…","…"]]`;

export interface ChainGenOutput {
  items: string[][]; // массив цепочек; каждая цепочка — массив текстов сегментов
  source: 'ai' | 'demo';
}

export async function generateChain(input: GenerateInput & { segments?: number }): Promise<ChainGenOutput> {
  const segCount = Math.min(3, Math.max(2, input.segments || 3));
  if (!client) return { items: demoChains(input, segCount), source: 'demo' };
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1800,
      system: [{ type: 'text', text: SYSTEM_CHAIN, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content:
            `Вакансия: ${input.title}\n` +
            `Описание (детали для уникальности): ${input.description || '—'}\n` +
            (input.brief ? `Бриф/условия (учти и впиши — цена, формат, занятость, куда писать): ${input.brief}\n` : '') +
            `Кодовое слово для директа: «${input.keyword}»\n` +
            brandBlock(input.brand) +
            (input.formats && input.formats.length
              ? `Тон/ходы корневого поста (по кругу): ${input.formats.map((f) => POST_FORMAT_LABELS[f] || f).join(', ')}.\n`
              : '') +
            `Сгенерируй ${input.count} РАЗНЫХ цепочек, в каждой по ${segCount} сегмента.`,
        },
      ],
    });
    const parsed = parseJsonChains(textOf(msg));
    return parsed ? { items: parsed, source: 'ai' } : { items: demoChains(input, segCount), source: 'demo' };
  } catch {
    return { items: demoChains(input, segCount), source: 'demo' };
  }
}

// Парсер массива цепочек: [[seg,seg], ...]. Терпим и плоский массив строк (одна цепочка).
function parseJsonChains(text: string): string[][] | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr) || !arr.length) return null;
    if (Array.isArray(arr[0])) {
      const chains = arr.map((c: any) => (Array.isArray(c) ? c.map(String).filter((s) => s.trim()) : [])).filter((c: string[]) => c.length);
      return chains.length ? chains : null;
    }
    // плоский массив строк → одна цепочка
    const flat = arr.map(String).filter((s) => s.trim());
    return flat.length ? [flat] : null;
  } catch {
    return null;
  }
}

function demoChains(i: GenerateInput, segCount: number): string[][] {
  const role = i.title.toLowerCase();
  const detail = i.description ? i.description.split(/[.,;]/)[0].trim().toLowerCase() : 'удалёнка, оплата вовремя';
  const root = `${i.title}, вы тут?????? Расширяю команду — беру 1–2 на постоянку 🙌`;
  const branch1 = `Детали: ${detail}. Формат простой, без душнилова и созвонов-марафонов.`;
  const branchCta = `Кто в теме — кидай портфолио и слово «${i.keyword}» в директ 🎬`;
  const chainA = segCount >= 3 ? [root, branch1, branchCta] : [root, `${branch1} Пиши «${i.keyword}» в директ 🎬`];
  const root2 = `Знаешь крутого ${role}? Или сам ${role}? 👀`;
  const chainB = segCount >= 3
    ? [root2, `Расскажу условия: ${detail}. Беру тех, у кого горят глаза.`, `Слово-ключ «${i.keyword}» мне в директ — и поехали 🚀`]
    : [root2, `Условия: ${detail}. Слово «${i.keyword}» в директ 🚀`];
  return [chainA, chainB].slice(0, Math.max(1, i.count));
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

// ── Генерация ЦЕЛОГО онбординга кандидата (страницы + блоки) ──
// Чтобы настраивать в разы быстрее: ИИ собирает разумный флоу под роль, а человек
// только правит. Возвращаем структуру без id — веб разложит её по своим блокам.
const FLOW_BLOCK_TYPES = ['heading', 'text', 'field', 'choice', 'multi', 'scale', 'consent', 'submit', 'support', 'faq'];

const SYSTEM_FLOW = `Ты собираешь онбординг-флоу кандидата для найма (как в Typeform/Tally), коротко и по делу. На вход — роль и условия. Сделай 3 страницы:
1) «Знакомство»: heading + 1-2 поля (имя, контакт Telegram/почта) + consent (согласие на обработку данных).
2) «Условия и тест»: heading + text с условиями (формат, оплата, занятость) + heading + text с тестовым заданием под роль (конкретное, выполнимое за ~2 часа, с критериями).
3) «Сдача»: heading + submit (поле ссылки на работу) + support (куда написать при вопросах).

Тон — на «ты», по-человечески, без канцелярита. Тексты живые и конкретные (числа, сроки).

Верни СТРОГО JSON без markdown:
{"pages":[{"title":"...","blocks":[{"type":"heading","text":"..."},{"type":"field","label":"Как тебя зовут","key":"name","input":"text","required":true},{"type":"field","label":"Telegram или email","key":"contact","input":"text","required":true},{"type":"consent","text":"Согласен(а) на обработку данных"}]},{"title":"...","blocks":[{"type":"heading","text":"Условия"},{"type":"text","text":"..."},{"type":"heading","text":"Тестовое задание"},{"type":"text","text":"..."}]},{"title":"...","blocks":[{"type":"heading","text":"Пришли работу"},{"type":"submit","label":"Ссылка на работу"},{"type":"support","text":"Вопросы?","label":"Написать","url":""}]}]}
Разрешённые type: ${FLOW_BLOCK_TYPES.join(', ')}.`;

export interface FlowBlockDraft {
  type: string;
  text?: string;
  label?: string;
  key?: string;
  input?: string;
  required?: boolean;
  options?: string[];
  url?: string;
  max?: number;
  faq?: { q: string; a: string }[];
}
export interface FlowGenOutput {
  pages: { title: string; blocks: FlowBlockDraft[] }[];
  source: 'ai' | 'demo';
}

function normalizeFlow(obj: any): { title: string; blocks: FlowBlockDraft[] }[] | null {
  const rawPages = Array.isArray(obj?.pages) ? obj.pages : [];
  const pages = rawPages
    .map((p: any) => {
      const blocks: FlowBlockDraft[] = (Array.isArray(p?.blocks) ? p.blocks : [])
        .filter((b: any) => FLOW_BLOCK_TYPES.includes(String(b?.type)))
        .map((b: any) => {
          const blk: FlowBlockDraft = { type: String(b.type) };
          if (typeof b.text === 'string') blk.text = b.text.slice(0, 4000);
          if (typeof b.label === 'string') blk.label = b.label.slice(0, 200);
          if (typeof b.key === 'string') blk.key = b.key.slice(0, 40).replace(/[^a-z0-9_]/gi, '');
          if (typeof b.input === 'string') blk.input = b.input;
          if (typeof b.url === 'string') blk.url = b.url.slice(0, 500);
          if (b.required === true) blk.required = true;
          if (typeof b.max === 'number') blk.max = Math.max(2, Math.min(10, b.max));
          if (Array.isArray(b.options)) blk.options = b.options.map((o: any) => String(o).slice(0, 120)).slice(0, 12);
          if (Array.isArray(b.faq)) blk.faq = b.faq.map((it: any) => ({ q: String(it?.q || '').slice(0, 200), a: String(it?.a || '').slice(0, 2000) })).slice(0, 10);
          return blk;
        });
      return { title: String(p?.title || 'Страница').slice(0, 80), blocks };
    })
    .filter((p: { blocks: FlowBlockDraft[] }) => p.blocks.length);
  return pages.length ? pages : null;
}

export async function generateFlow(input: { title: string; description: string; brief?: string; brand?: BrandVoice }): Promise<FlowGenOutput> {
  if (!client) return { pages: demoFlow(input.title), source: 'demo' };
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1800,
      system: [{ type: 'text', text: SYSTEM_FLOW, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content:
            `Роль: ${input.title}\nОписание: ${input.description || '—'}\n` +
            (input.brief ? `Условия/бриф (учти в текстах): ${input.brief}\n` : '') +
            brandBlock(input.brand) +
            `Собери онбординг-флоу.`,
        },
      ],
    });
    const obj = parseJsonObject(textOf(msg));
    const pages = obj ? normalizeFlow(obj) : null;
    return pages ? { pages, source: 'ai' } : { pages: demoFlow(input.title), source: 'demo' };
  } catch {
    return { pages: demoFlow(input.title), source: 'demo' };
  }
}

function demoFlow(title: string): { title: string; blocks: FlowBlockDraft[] }[] {
  const role = title || 'роль';
  return [
    {
      title: 'Знакомство',
      blocks: [
        { type: 'heading', text: 'Привет! Пару слов о тебе' },
        { type: 'field', label: 'Как тебя зовут', key: 'name', input: 'text', required: true },
        { type: 'field', label: 'Telegram или email', key: 'contact', input: 'text', required: true },
        { type: 'consent', text: 'Согласен(а) на обработку данных для отбора' },
      ],
    },
    {
      title: 'Условия и тест',
      blocks: [
        { type: 'heading', text: 'Условия' },
        { type: 'text', text: 'Удалёнка, сдельная оплата, быстрые выплаты, чёткое ТЗ.' },
        { type: 'heading', text: 'Тестовое задание' },
        { type: 'text', text: `Небольшая задача по профилю «${role}» по нашему референсу. Срок — 2 часа. Оцениваем: качество, скорость, соответствие ТЗ.` },
      ],
    },
    {
      title: 'Сдача',
      blocks: [
        { type: 'heading', text: 'Пришли ссылку на работу' },
        { type: 'submit', label: 'Ссылка на работу' },
        { type: 'support', text: 'Что-то непонятно?', label: 'Написать нам', url: '' },
      ],
    },
  ];
}

// Сгенерировать/улучшить текст ОДНОГО блока (heading/text) — точечная помощь в билдере.
export async function generateBlockText(input: { title: string; description: string; purpose: string; current?: string; brand?: BrandVoice }): Promise<{ text: string; source: 'ai' | 'demo' }> {
  if (!client) return { text: input.current || `${input.purpose} для роли «${input.title}»`, source: 'demo' };
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: [{ type: 'text', text: 'Ты пишешь короткий, живой текст для страницы онбординга кандидата (найм). На «ты», по делу, без канцелярита. Верни ТОЛЬКО текст, без markdown и кавычек.', cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content:
            `Роль: ${input.title}\nОписание: ${input.description || '—'}\n` +
            `Назначение блока: ${input.purpose}\n` +
            (input.current ? `Текущий текст (улучши/перепиши): ${input.current}\n` : '') +
            brandBlock(input.brand) +
            `Напиши текст для этого блока.`,
        },
      ],
    });
    const text = textOf(msg).trim();
    return text ? { text, source: 'ai' } : { text: input.current || '', source: 'demo' };
  } catch {
    return { text: input.current || '', source: 'demo' };
  }
}

function demoDoc(kind: DocKind, title: string): string {
  const role = title.toLowerCase();
  if (kind === 'conditions') return `Удалёнка, гибкий график, оплата сдельно, быстрые выплаты, чёткое ТЗ. Ищем ${role} в команду на постоянку.`;
  if (kind === 'nda') return `На время тестового периода обязуюсь не передавать третьим лицам исходные материалы, доступы и внутреннюю информацию, полученные в ходе сотрудничества.`;
  return `Тестовое задание для роли «${title}»: выполни небольшую задачу по профилю (по нашему референсу). Срок — 2 часа. Сдай ссылкой (Google Drive/облако). Оцениваем: качество, скорость, соответствие ТЗ.`;
}

// ── Генерация ЦЕЛОГО письма для email-цепочки ──
// По кратким вводным («бриф») собираем готовое письмо и раскидываем по блокам
// конструктора: заголовок → текст → (картинка) → кнопка. Картинку не генерим —
// отдаём текстовую «идею», что на ней изобразить, плюс пустой блок под URL.
export interface EmailBlockDraft {
  type: 'heading' | 'text' | 'button' | 'image' | 'divider' | 'spacer';
  text?: string;
  url?: string;
  align?: 'left' | 'center' | 'right';
  width?: 'full' | 'half' | 'small';
}
export interface EmailGenInput {
  brief: string;
  audience: 'new_users' | 'waitlist';
  ctaUrl: string;
}
export interface EmailGenOutput {
  subject: string;
  blocks: EmailBlockDraft[];
  imageIdea?: string;
  source: 'ai' | 'demo';
}

const SYSTEM_EMAIL = `Ты — копирайтер сервиса Threadhunt. Пишешь готовое email-письмо от лица продукта и раскидываешь его по блокам конструктора.

ЧТО ТАКОЕ THREADHUNT: SaaS для найма через соцсеть Threads. Возможности: авто-отбивка в директе (бот сам отвечает кандидатам на кодовое слово через расширение Chrome), автопостинг постов-приманок (вакансии-«крючки» публикуются по расписанию), мини-CRM и онбординг кандидатов (условия, тестовое, NDA, дедлайны). Тон бренда: на «ты», по-человечески, тепло и бодро, без канцелярита и пафоса. Эмодзи — дозированно (0–2 на письмо).

АУДИТОРИЯ:
- new_users — уже зарегистрировались. Цель письма: помочь активироваться (подключить аккаунт Threads, поставить расширение, запустить первый поиск/отбивку), показать ценность, мягко довести до целевого действия.
- waitlist — оставили почту в листе ожидания до запуска. Цель: прогрев, анонсы, ожидание запуска, промокод/ранний доступ.

ЗАДАЧА: по вводным («бриф») напиши ОДНО письмо. Раскидай по блокам:
- ровно 1 heading — короткий цепляющий заголовок (до ~60 символов);
- 1–3 text — основной текст, живой, по абзацу на блок, по делу, без воды;
- ровно 1 image — блок под картинку (url оставь пустым "" — пользователь вставит сам);
- ровно 1 button — призыв к действию; в поле url ПОДСТАВЬ РОВНО переданный CTA-URL, в text — короткую подпись кнопки (2–4 слова);
- divider/spacer — только если реально улучшают читаемость.
Порядок блоков логичный (обычно: heading → text → image → text → button). Заголовок align "left", кнопку и картинку — "center".

Также придумай imageIdea — короткое описание (1 предложение) того, что изобразить на картинке, чтобы письмо выглядело живо.

Верни СТРОГО JSON-объект без markdown:
{"subject":"...","blocks":[{"type":"heading","text":"...","align":"left"},{"type":"text","text":"...","align":"left"},{"type":"image","align":"center","width":"full"},{"type":"button","text":"...","url":"<CTA_URL>","align":"center"}],"imageIdea":"..."}`;

export async function generateEmail(input: EmailGenInput): Promise<EmailGenOutput> {
  if (!client) return { ...demoEmail(input), source: 'demo' };
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1400,
      system: [{ type: 'text', text: SYSTEM_EMAIL, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content:
            `Аудитория: ${input.audience}\n` +
            `CTA-URL для кнопки (подставь ровно так): ${input.ctaUrl}\n` +
            `Вводные (бриф) — о чём письмо: ${input.brief}\n` +
            `Собери готовое письмо по блокам.`,
        },
      ],
    });
    const obj = parseJsonObject(textOf(msg));
    const norm = obj ? normalizeEmail(obj, input.ctaUrl) : null;
    return norm ? { ...norm, source: 'ai' } : { ...demoEmail(input), source: 'demo' };
  } catch {
    return { ...demoEmail(input), source: 'demo' }; // graceful
  }
}

const BLOCK_TYPES = new Set(['heading', 'text', 'button', 'image', 'divider', 'spacer']);

// Нормализуем ответ модели в безопасные блоки конструктора.
function normalizeEmail(obj: any, ctaUrl: string): Omit<EmailGenOutput, 'source'> | null {
  const rawBlocks = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks: EmailBlockDraft[] = [];
  for (const b of rawBlocks) {
    const type = String(b?.type || '');
    if (!BLOCK_TYPES.has(type)) continue;
    const blk: EmailBlockDraft = { type: type as EmailBlockDraft['type'] };
    const align = b?.align;
    if (align === 'left' || align === 'center' || align === 'right') blk.align = align;
    if (type === 'heading' || type === 'text') blk.text = String(b?.text || '').slice(0, 4000);
    if (type === 'button') {
      blk.text = String(b?.text || 'Открыть').slice(0, 60);
      blk.url = ctaUrl; // всегда наш URL — модель не выдумывает ссылки
      blk.align = blk.align || 'center';
    }
    if (type === 'image') {
      blk.url = '';
      blk.width = b?.width === 'half' || b?.width === 'small' ? b.width : 'full';
      blk.align = blk.align || 'center';
    }
    blocks.push(blk);
  }
  if (!blocks.length) return null;
  // гарантируем наличие кнопки с CTA
  if (!blocks.some((b) => b.type === 'button')) blocks.push({ type: 'button', text: 'Открыть Threadhunt', url: ctaUrl, align: 'center' });
  return {
    subject: String(obj.subject || 'Письмо от Threadhunt').slice(0, 200),
    blocks,
    imageIdea: obj.imageIdea ? String(obj.imageIdea).slice(0, 300) : undefined,
  };
}

function parseJsonObject(text: string): any | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    const o = JSON.parse(slice);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

// Демо-фолбэк (без ключа/при сбое) — осмысленная заготовка под аудиторию.
function demoEmail(i: EmailGenInput): Omit<EmailGenOutput, 'source'> {
  const wl = i.audience === 'waitlist';
  const brief = i.brief.trim();
  return {
    subject: wl ? 'Скоро открываем Threadhunt 🚀' : 'Запусти первый наём в Threadhunt',
    blocks: [
      { type: 'heading', text: wl ? 'Ты в списке первых' : 'Давай настроим за 5 минут', align: 'left' },
      { type: 'text', text: brief ? `Коротко: ${brief}` : (wl ? 'Готовим запуск — совсем скоро дадим ранний доступ и промокод. Спасибо, что с нами!' : 'Подключи аккаунт Threads и поставь расширение — и отбивка начнёт отвечать кандидатам сама.'), align: 'left' },
      { type: 'image', url: '', width: 'full', align: 'center' },
      { type: 'button', text: wl ? 'Открыть сайт' : 'Перейти в кабинет', url: i.ctaUrl, align: 'center' },
    ],
    imageIdea: wl ? 'Скриншот дашборда Threadhunt с лёгким свечением — намёк на скорый запуск.' : 'Шаги подключения: иконки Threads + расширения Chrome со стрелкой к кнопке «Запустить».',
  };
}

// Проверка ключа: настроен ли + живой ли (минимальный реальный вызов на 1 токен).
export function aiConfigured(): boolean {
  return !!client;
}
export async function pingAi(): Promise<{ ok: boolean; error?: string }> {
  if (!client) return { ok: false, error: 'ANTHROPIC_API_KEY не задан на сервере' };
  try {
    await client.messages.create({ model: MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message).slice(0, 200) : 'ошибка вызова Anthropic' };
  }
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
