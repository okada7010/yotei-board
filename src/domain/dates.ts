import holidayJp from '@holiday-jp/holiday_jp';
import type { DateStr } from './types';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 端末ローカルの日付を 'YYYY-MM-DD' にする（toISOString は UTC になるため使わない） */
export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' をローカル0時の Date にする */
export function parseDate(s: DateStr): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(now: Date = new Date()): DateStr {
  return toDateStr(now);
}

export function addDays(s: DateStr, n: number): DateStr {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** b - a（日数） */
export function diffDays(a: DateStr, b: DateStr): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function mondayOf(s: DateStr): DateStr {
  const dow = parseDate(s).getDay(); // 0=日
  return addDays(s, dow === 0 ? -6 : 1 - dow);
}

export function rangeDays(start: DateStr, count: number): DateStr[] {
  const out: DateStr[] = [];
  for (let i = 0; i < count; i++) out.push(addDays(start, i));
  return out;
}

export function isHoliday(s: DateStr): boolean {
  return holidayJp.isHoliday(s as unknown as Date);
}

export function dayKind(s: DateStr): 'sat' | 'sun' | 'holiday' | 'weekday' {
  if (isHoliday(s)) return 'holiday';
  const dow = parseDate(s).getDay();
  if (dow === 0) return 'sun';
  if (dow === 6) return 'sat';
  return 'weekday';
}

/** 土日祝 */
export function isOffDay(s: DateStr): boolean {
  return dayKind(s) !== 'weekday';
}

export function weekdayLabel(s: DateStr): string {
  return WEEKDAYS[parseDate(s).getDay()];
}

/** '11月23日（月）' */
export function formatMD(s: DateStr): string {
  const d = parseDate(s);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

/** '11/23' */
export function formatShort(s: DateStr): string {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** その月の1日 */
export function firstOfMonth(s: DateStr): DateStr {
  return `${s.slice(0, 8)}01`;
}

export function daysInMonth(s: DateStr): number {
  const d = parseDate(s);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function addMonths(s: DateStr, n: number): DateStr {
  const d = parseDate(firstOfMonth(s));
  d.setMonth(d.getMonth() + n);
  return toDateStr(d);
}

export function isValidDateStr(s: unknown): s is DateStr {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toDateStr(parseDate(s)) === s;
}
