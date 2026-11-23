import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayKind,
  diffDays,
  formatMD,
  isHoliday,
  isOffDay,
  mondayOf,
  parseDate,
  rangeDays,
  toDateStr,
  today,
  weekdayLabel,
} from './dates';

describe('dates', () => {
  it('ローカル時刻の日付を文字列にする（深夜でも前後にずれない）', () => {
    expect(toDateStr(new Date(2026, 10, 23, 23, 59))).toBe('2026-11-23');
    expect(toDateStr(new Date(2026, 10, 24, 0, 0))).toBe('2026-11-24');
    expect(today(new Date(2026, 0, 1, 0, 0, 1))).toBe('2026-01-01');
  });

  it('文字列をローカル0時の Date に戻す', () => {
    const d = parseDate('2026-11-23');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 23, 0]);
  });

  it('日数の加算は月末・年末をまたぐ', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-11-23', 0)).toBe('2026-11-23');
  });

  it('日数の差を返す', () => {
    expect(diffDays('2026-11-23', '2026-11-25')).toBe(2);
    expect(diffDays('2026-11-25', '2026-11-23')).toBe(-2);
    expect(diffDays('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('その週の月曜を返す', () => {
    expect(mondayOf('2026-11-29')).toBe('2026-11-23'); // 日曜
    expect(mondayOf('2026-11-23')).toBe('2026-11-23'); // 月曜
    expect(mondayOf('2026-11-25')).toBe('2026-11-23'); // 水曜
  });

  it('連続する日付の一覧を返す', () => {
    const days = rangeDays('2026-11-23', 14);
    expect(days).toHaveLength(14);
    expect(days[0]).toBe('2026-11-23');
    expect(days[13]).toBe('2026-12-06');
  });

  it('祝日と土日を判定する', () => {
    expect(isHoliday('2026-11-23')).toBe(true); // 勤労感謝の日
    expect(isHoliday('2026-11-24')).toBe(false);
    expect(isOffDay('2026-11-24')).toBe(false);
    expect(isOffDay('2026-11-23')).toBe(true);
    expect(isOffDay('2026-11-28')).toBe(true);
    expect(dayKind('2026-11-28')).toBe('sat');
    expect(dayKind('2026-11-29')).toBe('sun');
    expect(dayKind('2026-11-23')).toBe('holiday');
    expect(dayKind('2026-11-24')).toBe('weekday');
    expect(isHoliday('2027-01-01')).toBe(true); // 元日
  });

  it('曜日と表示用の日付を返す', () => {
    expect(weekdayLabel('2026-11-23')).toBe('月');
    expect(weekdayLabel('2026-11-29')).toBe('日');
    expect(formatMD('2026-11-23')).toBe('11月23日（月）');
  });
});
