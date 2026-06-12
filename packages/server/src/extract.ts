// Извлечение текста из источника для авто-сбора «Голоса бренда»:
//  • URL сайта/презентации (HTML → чистый текст)
//  • ссылка на PDF в открытом доступе
//  • загруженный PDF (буфер)
// Защита от SSRF: только http/https и не внутренние адреса.

import { PDFParse } from 'pdf-parse';

function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Некорректная ссылка');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Поддерживаются только http/https ссылки');
  const h = u.hostname.toLowerCase();
  const blocked =
    h === 'localhost' ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^0\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /\.(local|internal|lan)$/.test(h);
  if (blocked) throw new Error('Этот адрес недоступен');
  return u;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function textFromPdfBuffer(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const r = await parser.getText();
  return (r.text || '').trim();
}

// Извлечь текст по URL: PDF — парсим, иначе чистим HTML. Лимит на размер/время.
export async function textFromUrl(raw: string): Promise<string> {
  const u = assertSafeUrl(raw);
  const isPdfByExt = u.pathname.toLowerCase().endsWith('.pdf');
  const res = await fetch(u.toString(), { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'ThreadhuntBot/1.0' } });
  if (!res.ok) throw new Error(`Не удалось загрузить (${res.status})`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new Error('Источник слишком большой');
  if (isPdfByExt || ct.includes('pdf')) return textFromPdfBuffer(buf);
  return htmlToText(buf.toString('utf8'));
}
