// Часовые пояса и хелперы конвертации/форматирования (через Intl).

export const TIMEZONES: { tz: string; label: string }[] = [
  { tz: '', label: 'Локальное время кандидата' },
  { tz: 'Europe/Moscow', label: 'Москва (МСК, UTC+3)' },
  { tz: 'Europe/Kyiv', label: 'Киев (UTC+2/3)' },
  { tz: 'Europe/Minsk', label: 'Минск (UTC+3)' },
  { tz: 'Asia/Almaty', label: 'Алматы (UTC+5)' },
  { tz: 'Asia/Tashkent', label: 'Ташкент (UTC+5)' },
  { tz: 'Asia/Tbilisi', label: 'Тбилиси (UTC+4)' },
  { tz: 'Asia/Yerevan', label: 'Ереван (UTC+4)' },
  { tz: 'Asia/Dubai', label: 'Дубай (UTC+4)' },
  { tz: 'Europe/Berlin', label: 'Берлин (UTC+1/2)' },
  { tz: 'UTC', label: 'UTC' },
];

// Смещение зоны (мин) для конкретного момента.
function tzOffsetMin(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: any = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}

// Локальное «настенное» время в зоне tz → абсолютный момент (UTC).
// localStr: 'YYYY-MM-DDTHH:MM' (из datetime-local).
export function zonedToUtc(localStr: string, tz: string): Date {
  if (!tz) return new Date(localStr); // локальная машина
  const guess = new Date(localStr + 'Z'); // поля как UTC
  const off = tzOffsetMin(guess, tz);
  return new Date(guess.getTime() - off * 60000);
}

// Форматировать момент в зоне tz (для показа кандидату/в кабинете).
export function fmtInTz(iso: string, tz: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz || undefined,
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleString('ru-RU');
  }
}
