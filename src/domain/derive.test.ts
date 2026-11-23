import { describe, expect, it } from 'vitest';
import {
  activeNotes,
  areaOf,
  barLabel,
  effectiveSchedule,
  eventsOn,
  overlappingSchedules,
  placement,
  siteSuggestions,
  sitesOn,
  sortedMembers,
  vehicleBars,
} from './derive';
import type { BoardData, Kind, Member, Note, NoteCategory, Schedule } from './types';

const stamp = { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'test' };

function member(id: string, name: string, groupId = 'g1', base: 'LABO' | '本社' = 'LABO', order = 0, active = true): Member {
  return { id, name, groupId, base, order, active, ...stamp };
}

let seq = 0;
function sched(p: Partial<Schedule> & { start: string; end: string; kind: Kind }): Schedule {
  seq += 1;
  return {
    id: p.id ?? `s${seq}`,
    memberIds: [],
    site: '',
    vehicleId: null,
    memo: '',
    createdAt: `2026-11-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    ...stamp,
    ...p,
  };
}

function note(category: NoteCategory, text: string, p: Partial<Note> = {}): Note {
  seq += 1;
  return { id: `n${seq}`, category, text, date: null, endDate: null, done: false, createdAt: `2026-11-01T00:01:${String(seq % 60).padStart(2, '0')}.000Z`, ...stamp, ...p };
}

function board(p: Partial<BoardData>): BoardData {
  return {
    groups: [
      { id: 'g1', name: '第一グループ', order: 0, ...stamp },
      { id: 'g2', name: '第二グループ', order: 1, ...stamp },
    ],
    members: [
      member('m1', '佐藤', 'g1', 'LABO', 0),
      member('m2', '鈴木', 'g1', 'LABO', 1),
      member('m3', '高橋', 'g2', '本社', 0),
      member('m4', '田中', 'g2', '本社', 1),
    ],
    vehicles: [
      { id: 'v1', name: '1号車', order: 0, active: true, ...stamp },
      { id: 'v2', name: '2号車', order: 1, active: true, ...stamp },
    ],
    schedules: [],
    notes: [],
    ...p,
  };
}

// 2026-11-24(火)〜27(金) は平日、28(土) 29(日)、23(月) は祝日
describe('effectiveSchedule（優先ルール）', () => {
  it('5日間の現場の3日目に1日休みを重ねると、3日目だけ休みになる', () => {
    const long = sched({ memberIds: ['m1', 'm2'], start: '2026-11-24', end: '2026-11-28', kind: '現場', site: 'A倉庫' });
    const off = sched({ memberIds: ['m1'], start: '2026-11-26', end: '2026-11-26', kind: '休み' });
    const data = board({ schedules: [long, off] });
    expect(effectiveSchedule(data, 'm1', '2026-11-25')?.id).toBe(long.id);
    expect(effectiveSchedule(data, 'm1', '2026-11-26')?.id).toBe(off.id);
    expect(effectiveSchedule(data, 'm1', '2026-11-27')?.id).toBe(long.id);
    expect(effectiveSchedule(data, 'm2', '2026-11-26')?.id).toBe(long.id);
  });

  it('同じ長さなら後から作った方が有効', () => {
    const a = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-25', kind: '在宅', createdAt: '2026-11-01T00:00:00.000Z' });
    const b = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-25', kind: '休み', createdAt: '2026-11-02T00:00:00.000Z' });
    expect(effectiveSchedule(board({ schedules: [a, b] }), 'm1', '2026-11-24')?.id).toBe(b.id);
    expect(effectiveSchedule(board({ schedules: [b, a] }), 'm1', '2026-11-24')?.id).toBe(b.id);
  });

  it('予定が無ければ null、重なりは有効順に返す', () => {
    const long = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-28', kind: '現場', site: 'A倉庫' });
    const off = sched({ memberIds: ['m1'], start: '2026-11-26', end: '2026-11-26', kind: '休み' });
    const data = board({ schedules: [long, off] });
    expect(effectiveSchedule(data, 'm3', '2026-11-26')).toBeNull();
    expect(overlappingSchedules(data, 'm1', '2026-11-26').map((s) => s.id)).toEqual([off.id, long.id]);
  });

  it('開始日が終了日より後の予定は無視する', () => {
    const bad = sched({ memberIds: ['m1'], start: '2026-11-27', end: '2026-11-24', kind: '休み' });
    expect(effectiveSchedule(board({ schedules: [bad] }), 'm1', '2026-11-25')).toBeNull();
  });
});

describe('areaOf / placement', () => {
  it('平日で予定なしは普段の居場所', () => {
    const data = board({});
    expect(areaOf(data, data.members[0], '2026-11-24')).toBe('LABO');
    expect(areaOf(data, data.members[2], '2026-11-24')).toBe('本社');
  });

  it('土日祝で予定なしは休み', () => {
    const data = board({});
    expect(areaOf(data, data.members[0], '2026-11-28')).toBe('休み');
    expect(areaOf(data, data.members[0], '2026-11-29')).toBe('休み');
    expect(areaOf(data, data.members[0], '2026-11-23')).toBe('休み');
  });

  it('土曜に LABO の予定を入れた人は LABO に出る', () => {
    const data = board({ schedules: [sched({ memberIds: ['m3'], start: '2026-11-28', end: '2026-11-28', kind: 'LABO' })] });
    expect(areaOf(data, data.members[2], '2026-11-28')).toBe('LABO');
  });

  it('現場の人は配置欄に出ず、他はグループ順・並び順で出る', () => {
    const data = board({
      schedules: [
        sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-24', kind: '現場', site: 'A倉庫' }),
        sched({ memberIds: ['m4'], start: '2026-11-24', end: '2026-11-24', kind: '在宅' }),
        sched({ memberIds: ['m3'], start: '2026-11-24', end: '2026-11-24', kind: 'LABO' }),
      ],
    });
    const p = placement(data, '2026-11-24');
    expect(p.LABO.map((m) => m.name)).toEqual(['鈴木', '高橋']);
    expect(p['本社']).toEqual([]);
    expect(p['在宅'].map((m) => m.name)).toEqual(['田中']);
    expect(p['休み']).toEqual([]);
  });

  it('非表示の人員は出ない', () => {
    const data = board({});
    data.members[1] = { ...data.members[1], active: false };
    expect(sortedMembers(data).map((m) => m.name)).toEqual(['佐藤', '高橋', '田中']);
    expect(placement(data, '2026-11-24').LABO.map((m) => m.name)).toEqual(['佐藤']);
  });
});

describe('sitesOn', () => {
  it('現場の人を現場名ごとにまとめる', () => {
    const data = board({
      schedules: [
        sched({ memberIds: ['m1', 'm3'], start: '2026-11-24', end: '2026-11-25', kind: '現場', site: 'A倉庫' }),
        sched({ memberIds: ['m2'], start: '2026-11-24', end: '2026-11-24', kind: '現場', site: 'B工場' }),
      ],
    });
    const sites = sitesOn(data, '2026-11-24');
    expect(sites.map((s) => [s.site, s.members.map((m) => m.name)])).toEqual([
      ['A倉庫', ['佐藤', '高橋']],
      ['B工場', ['鈴木']],
    ]);
    expect(sitesOn(data, '2026-11-26')).toEqual([]);
  });

  it('その日だけ休みを重ねた人は現場欄から外れる', () => {
    const data = board({
      schedules: [
        sched({ memberIds: ['m1', 'm2'], start: '2026-11-24', end: '2026-11-27', kind: '現場', site: 'A倉庫' }),
        sched({ memberIds: ['m1'], start: '2026-11-25', end: '2026-11-25', kind: '休み' }),
      ],
    });
    expect(sitesOn(data, '2026-11-25')[0].members.map((m) => m.name)).toEqual(['鈴木']);
    expect(placement(data, '2026-11-25')['休み'].map((m) => m.name)).toEqual(['佐藤']);
  });
});

describe('vehicleBars', () => {
  const from = '2026-11-23';
  const to = '2026-12-06';

  it('複数人の予定1件は帯1本、ラベルは「現場名／氏名・氏名」', () => {
    const s = sched({ memberIds: ['m1', 'm2'], start: '2026-11-24', end: '2026-11-25', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const bars = vehicleBars(board({ schedules: [s] }), 'v1', from, to);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ start: '2026-11-24', end: '2026-11-25', site: 'A倉庫', scheduleIds: [s.id], row: 0, conflict: false });
    expect(barLabel(bars[0])).toBe('A倉庫／佐藤・鈴木');
    expect(vehicleBars(board({ schedules: [s] }), 'v2', from, to)).toEqual([]);
  });

  it('3人以上は「氏名 他n名」', () => {
    const s = sched({ memberIds: ['m1', 'm2', 'm3'], start: '2026-11-24', end: '2026-11-24', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    expect(barLabel(vehicleBars(board({ schedules: [s] }), 'v1', from, to)[0])).toBe('A倉庫／佐藤 他2名');
  });

  it('人員0人（車両だけの予定）は現場名のみ', () => {
    const s = sched({ start: '2026-12-03', end: '2026-12-04', kind: '現場', site: '車検', vehicleId: 'v1' });
    expect(barLabel(vehicleBars(board({ schedules: [s] }), 'v1', from, to)[0])).toBe('車検');
  });

  it('別々の予定でも同じ現場で日付が重なれば1本にまとめる', () => {
    const a = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-25', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const b = sched({ memberIds: ['m2'], start: '2026-11-25', end: '2026-11-27', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const bars = vehicleBars(board({ schedules: [a, b] }), 'v1', from, to);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ start: '2026-11-24', end: '2026-11-27', conflict: false });
    expect(bars[0].memberNames).toEqual(['佐藤', '鈴木']);
    expect([...bars[0].scheduleIds].sort()).toEqual([a.id, b.id].sort());
  });

  it('現場の違う予定が重なると警告つきで段を分ける', () => {
    const a = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-25', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const b = sched({ memberIds: ['m2'], start: '2026-11-25', end: '2026-11-26', kind: '現場', site: 'B工場', vehicleId: 'v1' });
    const c = sched({ memberIds: ['m3'], start: '2026-11-30', end: '2026-11-30', kind: '現場', site: 'C商店', vehicleId: 'v1' });
    const bars = vehicleBars(board({ schedules: [a, b, c] }), 'v1', from, to);
    const bySite = Object.fromEntries(bars.map((x) => [x.site, x]));
    expect(bySite['A倉庫'].conflict).toBe(true);
    expect(bySite['B工場'].conflict).toBe(true);
    expect(bySite['A倉庫'].row).not.toBe(bySite['B工場'].row);
    expect(bySite['C商店']).toMatchObject({ conflict: false, row: 0 });
  });

  it('表示範囲からはみ出す帯は切り詰め、範囲外は出さない', () => {
    const a = sched({ memberIds: ['m1'], start: '2026-11-20', end: '2026-11-24', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const b = sched({ memberIds: ['m1'], start: '2026-12-05', end: '2026-12-10', kind: '現場', site: 'B工場', vehicleId: 'v1' });
    const c = sched({ memberIds: ['m1'], start: '2026-12-07', end: '2026-12-08', kind: '現場', site: 'C商店', vehicleId: 'v1' });
    const bars = vehicleBars(board({ schedules: [a, b, c] }), 'v1', from, to);
    expect(bars.map((x) => [x.site, x.start, x.end, x.openStart, x.openEnd])).toEqual([
      ['A倉庫', '2026-11-23', '2026-11-24', true, false],
      ['B工場', '2026-12-05', '2026-12-06', false, true],
    ]);
  });

  it('参照切れ（存在しない人員・開始>終了）でも例外を出さない', () => {
    const a = sched({ memberIds: ['ghost', 'm1'], start: '2026-11-24', end: '2026-11-24', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const bad = sched({ memberIds: ['m2'], start: '2026-11-27', end: '2026-11-25', kind: '現場', site: 'B工場', vehicleId: 'v1' });
    const orphan = sched({ memberIds: ['m2'], start: '2026-11-25', end: '2026-11-25', kind: '現場', site: 'D', vehicleId: 'gone' });
    const data = board({ schedules: [a, bad, orphan] });
    const bars = vehicleBars(data, 'v1', from, to);
    expect(bars).toHaveLength(1);
    expect(bars[0].memberNames).toEqual(['佐藤']);
    expect(() => placement(data, '2026-11-25')).not.toThrow();
    expect(() => sitesOn(data, '2026-11-25')).not.toThrow();
    expect(() => eventsOn(data, '2026-11-25')).not.toThrow();
  });
});

describe('eventsOn / activeNotes', () => {
  it('車両だけの予定は開始30日前から終了日までイベント欄に出る', () => {
    const s = sched({ start: '2026-12-03', end: '2026-12-04', kind: '現場', site: '車検', vehicleId: 'v1' });
    const data = board({ schedules: [s] });
    expect(eventsOn(data, '2026-11-02')).toEqual([]);
    expect(eventsOn(data, '2026-11-03')).toHaveLength(1);
    expect(eventsOn(data, '2026-11-23')[0]).toMatchObject({ text: '1号車 車検 12/3〜12/4', source: 'vehicle', refId: s.id });
    expect(eventsOn(data, '2026-12-04')).toHaveLength(1);
    expect(eventsOn(data, '2026-12-05')).toEqual([]);
  });

  it('人員のいる車両予定はイベント欄に出ない', () => {
    const s = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-24', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    expect(eventsOn(board({ schedules: [s] }), '2026-11-24')).toEqual([]);
  });

  it('イベントは日付順、日付なしは末尾、過ぎたものと完了は出ない', () => {
    const data = board({
      notes: [
        note('イベント', '日付なし'),
        note('イベント', '後', { date: '2026-12-10' }),
        note('イベント', '先', { date: '2026-11-25', endDate: '2026-11-26' }),
        note('イベント', '過去', { date: '2026-11-20' }),
        note('イベント', '完了', { date: '2026-12-01', done: true }),
        note('連絡事項', '別区分'),
      ],
    });
    expect(eventsOn(data, '2026-11-26').map((e) => e.text)).toEqual(['先', '後', '日付なし']);
    expect(eventsOn(data, '2026-11-27').map((e) => e.text)).toEqual(['後', '日付なし']);
  });

  it('トラブルは未解決のみ、来客予定は当日以降のみ', () => {
    const data = board({
      notes: [
        note('トラブル', '発生中'),
        note('トラブル', '解決済み', { done: true }),
        note('来客予定', '昨日', { date: '2026-11-23' }),
        note('来客予定', '今日', { date: '2026-11-24' }),
        note('来客予定', '日付なし'),
        note('連絡事項', '連絡'),
      ],
    });
    expect(activeNotes(data, 'トラブル', '2026-11-24').map((n) => n.text)).toEqual(['発生中']);
    expect(activeNotes(data, '来客予定', '2026-11-24').map((n) => n.text)).toEqual(['今日', '日付なし']);
    expect(activeNotes(data, '連絡事項', '2026-11-24').map((n) => n.text)).toEqual(['連絡']);
  });
});

describe('siteSuggestions', () => {
  it('現場名を重複なしで新しい順に返す', () => {
    const data = board({
      schedules: [
        sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-24', kind: '現場', site: 'A倉庫', updatedAt: '2026-11-01T00:00:00.000Z' }),
        sched({ memberIds: ['m1'], start: '2026-11-25', end: '2026-11-25', kind: '現場', site: 'B工場', updatedAt: '2026-11-03T00:00:00.000Z' }),
        sched({ memberIds: ['m2'], start: '2026-11-26', end: '2026-11-26', kind: '現場', site: 'A倉庫', updatedAt: '2026-11-02T00:00:00.000Z' }),
        sched({ memberIds: ['m2'], start: '2026-11-26', end: '2026-11-26', kind: '休み', site: '' }),
      ],
    });
    expect(siteSuggestions(data)).toEqual(['B工場', 'A倉庫']);
  });
});
