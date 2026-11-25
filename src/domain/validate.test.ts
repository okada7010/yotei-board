import { describe, expect, it } from 'vitest';
import { isRecord } from './validate';

const base = { id: 'n1', category: '来客予定', text: 'H社', date: '2026-11-24', endDate: null, done: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'test' };

describe('掲示の時間（開始〜終了）', () => {
  it('時間の項目が無い古いレコードも通る', () => {
    expect(isRecord('notes', base)).toBe(true);
  });

  it('HH:MM の文字列と null は通る', () => {
    expect(isRecord('notes', { ...base, timeStart: '09:00', timeEnd: '17:30' })).toBe(true);
    expect(isRecord('notes', { ...base, timeStart: '14:00', timeEnd: null })).toBe(true);
    expect(isRecord('notes', { ...base, timeStart: null, timeEnd: null })).toBe(true);
  });

  it('形の違う時間は通さない', () => {
    expect(isRecord('notes', { ...base, timeStart: 900 })).toBe(false);
    expect(isRecord('notes', { ...base, timeStart: '9時' })).toBe(false);
    expect(isRecord('notes', { ...base, timeEnd: '25:00' })).toBe(false);
  });
});

describe('掲示の名前', () => {
  it('文字列と null は通る（項目が無い古いレコードも通る）', () => {
    expect(isRecord('notes', { ...base, person: '岡田' })).toBe(true);
    expect(isRecord('notes', { ...base, person: null })).toBe(true);
    expect(isRecord('notes', base)).toBe(true);
  });

  it('文字列でない名前は通さない', () => {
    expect(isRecord('notes', { ...base, person: 1 })).toBe(false);
    expect(isRecord('notes', { ...base, person: ['岡田'] })).toBe(false);
  });
});
