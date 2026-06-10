// Разбор шаблона поста в цепочку сегментов для публикации.
// Источник правды — segmentsJson (карусель + ветки). Если его нет — собираем
// один сегмент из легаси-полей text/mediaUrl/mediaType (обратная совместимость).

import type { ChainSegment, MediaItem } from './publisher.js';

export interface TemplateRow {
  text: string;
  mediaUrl: string | null;
  mediaType: string | null;
  segmentsJson: string | null;
}

function cleanMedia(raw: any): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m.url === 'string' && (m.type === 'image' || m.type === 'video'))
    .map((m) => ({ url: m.url as string, type: m.type as 'image' | 'video' }));
}

export function parseSegments(tpl: TemplateRow): ChainSegment[] {
  if (tpl.segmentsJson) {
    try {
      const arr = JSON.parse(tpl.segmentsJson);
      if (Array.isArray(arr)) {
        const segs: ChainSegment[] = arr
          .map((s: any) => ({ text: typeof s?.text === 'string' ? s.text : '', media: cleanMedia(s?.media) }))
          .filter((s: ChainSegment) => (s.text && s.text.trim()) || (s.media && s.media.length));
        if (segs.length) return segs;
      }
    } catch {
      /* битый JSON — падаем на легаси */
    }
  }
  const media: MediaItem[] =
    tpl.mediaUrl && (tpl.mediaType === 'image' || tpl.mediaType === 'video')
      ? [{ url: tpl.mediaUrl, type: tpl.mediaType }]
      : [];
  return [{ text: tpl.text || '', media }];
}
