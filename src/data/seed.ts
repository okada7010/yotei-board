import { addDays, mondayOf } from '../domain/dates';
import type { Base, BoardData, DateStr, Kind, NoteCategory } from '../domain/types';

/** お試しモード用の初期データ（すべて架空） */
export function seedData(todayStr: DateStr): BoardData {
  const at = '2026-01-01T00:00:00.000Z';
  const st = { updatedAt: at, updatedBy: 'お試しデータ' };
  const mon = mondayOf(todayStr);
  const d = (offset: number) => addDays(mon, offset);

  const groups = ['機械グループ', '制御グループ', 'システムグループ'].map((name, i) => ({ id: `g${i + 1}`, name, order: i, ...st }));

  const people: [string, string, Base][] = [
    ['青木', 'g1', 'LABO'], ['赤井', 'g1', 'LABO'], ['白石', 'g1', 'LABO'], ['黒田', 'g1', 'LABO'],
    ['緑川', 'g2', 'LABO'], ['紺野', 'g2', 'LABO'], ['桃井', 'g2', '本社'], ['茶谷', 'g2', '本社'],
    ['灰原', 'g3', '本社'], ['藍沢', 'g3', '本社'], ['金森', 'g3', 'LABO'], ['銀林', 'g3', '本社'],
  ];
  const members = people.map(([name, groupId, base], i) => ({ id: `m${i + 1}`, name, groupId, base, order: i, active: true, ...st }));

  const vehicles = ['1号車', '2号車', '3号車', '4号車', '5号車', '6号車'].map((name, i) => ({ id: `v${i + 1}`, name, order: i, active: true, ...st }));

  let n = 0;
  const sched = (memberIds: string[], start: DateStr, end: DateStr, kind: Kind, site = '', vehicleId: string | null = null, memo = '') => {
    n += 1;
    return { id: `s${n}`, memberIds, start, end, kind, site, vehicleId, memo, createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`, ...st };
  };
  const schedules = [
    sched(['m1', 'm2', 'm3'], d(0), d(2), '現場', 'A倉庫', 'v3'),
    sched(['m5'], d(0), d(0), '現場', 'B工場', 'v4'),
    sched(['m6'], d(1), d(4), '現場', 'C物流センター', 'v1'),
    sched(['m9'], d(0), d(1), '現場', 'D商事', 'v6'),
    sched(['m7'], d(2), d(2), '在宅'),
    sched(['m4'], d(0), d(0), '休み'),
    sched(['m10'], d(3), d(4), '休み'),
    sched(['m11', 'm12'], d(7), d(9), '現場', 'E配送センター', 'v2'),
    sched(['m2'], d(8), d(10), '現場', 'A倉庫', 'v5'),
    sched([], d(10), d(11), '現場', '車検', 'v4', '10:00〜'),
  ];

  let k = 0;
  const note = (category: NoteCategory, text: string, date: DateStr | null = null) => {
    k += 1;
    return { id: `n${k}`, category, text, date, endDate: null, done: false, createdAt: `2026-01-01T00:01:${String(k).padStart(2, '0')}.000Z`, ...st };
  };
  const notes = [
    note('トラブル', 'F機工 搬送ライン停止'),
    note('トラブル', 'G運輸 仕分け不良'),
    note('連絡事項', '月末に棚卸しがあります'),
    note('来客予定', '14:00 H社 ご来社', d(1)),
    note('イベント', '全体ミーティング', d(4)),
  ];

  return { groups, members, vehicles, schedules, notes };
}
