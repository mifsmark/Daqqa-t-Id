import { HttpError } from './http';
import type { ExceptionRow, HourRow } from './types';

export function resolveStartAt(value: string, isAsap: boolean, now: Date): Date {
  const requested = new Date(value);
  if (!Number.isFinite(requested.valueOf())) throw new HttpError(400, 'Choose a valid start time.');
  if (!isAsap) return requested;
  if (requested.valueOf() > now.valueOf() + 15 * 60000) throw new HttpError(400, 'ASAP cannot specify a future scheduled time.');
  return new Date(now.valueOf() + 5 * 60000);
}
export function validEnd(start: Date, durationMinutes: number, now: Date): Date {
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 720)
    throw new HttpError(400, 'Duration must be between 15 and 720 minutes.');
  if (start.valueOf() <= now.valueOf()) throw new HttpError(400, 'Choose a future start time.');
  return new Date(start.valueOf() + durationMinutes * 60000);
}
const malta = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Malta', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23' });
function parts(date: Date) {
  const p = Object.fromEntries(malta.formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
    millis: ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 + Number(p.fractionalSecond || 0) };
}
export function maltaDate(date: Date): string { return parts(date).date; }
function timeMillis(value: string): number { const [h, m, s = '0'] = value.split(':'); return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000; }
export function isAvailableAt(hours: HourRow[], exceptions: ExceptionRow[], start: Date, end: Date): boolean {
  const a = parts(start), b = parts(end);
  if (a.date !== b.date || exceptions.some(x => x.date === a.date && !x.is_available)) return false;
  return hours.some(x => x.weekday === a.weekday && timeMillis(x.start_time) <= a.millis && timeMillis(x.end_time) >= b.millis);
}
export function distanceKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const rad = (d: number) => d * Math.PI / 180;
  const h = Math.sin(rad(latB - latA) / 2) ** 2 + Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(rad(lonB - lonA) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
