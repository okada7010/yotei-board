import { describe, expect, it } from 'vitest';
import { areaOf, vehicleBars } from '../domain/derive';
import { applyOps, type Op } from '../domain/ops';
import type { BoardData, Kind, Member, Schedule } from '../domain/types';
import { addGroup, addMember, addVehicle, canDeleteGroup, moveOrder } from './admin/adminActions';
import { shouldAutoReload } from './app/autoReload';
import { moveBar, resizeBar } from './board/barActions';
import { dropMember } from './board/dropActions';
import { memberRow, validateSchedule } from './input/gridModel';
import { appUrl, parseHash } from './router';

const st = { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'test' };
const member = (id: string, name: string, groupId = 'g1', base: 'LABO' | '本社' = 'LABO', order = 0): Member => ({ id, name, groupId, base, order, active: true, ...st });
let seq = 0;
function sched(p: Partial<Schedule> & { start: string; end: string; kind: Kind }): Schedule {
  seq += 1;
  return { id: p.id ?? `s${seq}`, memberIds: [], site: '', vehicleId: null, memo: '', createdAt: `2026-11-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`, ...st, ...p };
}
function board(p: Partial<BoardData> = {}): BoardData {
  return {
    groups: [{ id: 'g1', name: '第一', order: 0, ...st }, { id: 'g2', name: '第二', order: 1, ...st }],
    members: [member('m1', '青木', 'g1', 'LABO', 0), member('m2', '赤井', 'g1', 'LABO', 1), member('m3', '白石', 'g2', '本社', 0)],
    vehicles: [{ id: 'v1', name: '1号車', order: 0, active: true, ...st }, { id: 'v2', name: '2号車', order: 1, active: true, ...st }],
    schedules: [],
    notes: [],
    ...p,
  };
}
const D = '2026-11-25'; // 水曜（平日）
const opsOf = (r: ReturnType<typeof dropMember>): Op[] => ('ops' in r ? r.ops : []);

describe('router', () => {
  it('ハッシュから画面を決める', () => {
    expect(parseHash('#/input')).toBe('/input');
    expect(parseHash('#/admin')).toBe('/admin');
    expect(parseHash('#/register')).toBe('/register');
    expect(parseHash('#/board')).toBe('/board');
    expect(parseHash('')).toBe('/board');
    expect(parseHash('#/unknown')).toBe('/board');
    expect(parseHash('#/input?x=1')).toBe('/input');
  });

  it('操作画面の URL はハッシュ以外を引き継ぐ（鍵などは含まない）', () => {
    const loc = { origin: 'https://example.github.io', pathname: '/some-repo/' } as Location;
    expect(appUrl('/input', loc)).toBe('https://example.github.io/some-repo/#/input');
  });
});

describe('dropMember（名札のドロップ）', () => {
  it('同じ欄に落としたら何もしない', () => {
    expect(dropMember(board(), 'm1', 'LABO', D, 'dev')).toEqual({ noop: true });
  });

  it('予定の無い人を休みへ動かすと、その日だけの休みができる', () => {
    const data = board();
    const r = dropMember(data, 'm1', '休み', D, 'dev');
    const ops = opsOf(r);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'upsert', collection: 'schedules', record: { memberIds: ['m1'], start: D, end: D, kind: '休み', vehicleId: null, updatedBy: 'dev' } });
    const after = applyOps(data, ops);
    expect(areaOf(after, after.members[0], D)).toBe('休み');
    expect(areaOf(after, after.members[0], '2026-11-26')).toBe('LABO');
  });

  it('その日だけの予定を元の欄へ戻すと、その予定を取り消す', () => {
    const off = sched({ memberIds: ['m1'], start: D, end: D, kind: '休み' });
    const data = board({ schedules: [off] });
    const ops = opsOf(dropMember(data, 'm1', 'LABO', D, 'dev'));
    expect(ops).toEqual([{ type: 'delete', collection: 'schedules', id: off.id }]);
    expect(applyOps(data, ops).schedules).toEqual([]);
  });

  it('その日だけの予定を別の欄へ動かすと、置き換える', () => {
    const off = sched({ memberIds: ['m1'], start: D, end: D, kind: '休み' });
    const data = board({ schedules: [off] });
    const ops = opsOf(dropMember(data, 'm1', '在宅', D, 'dev'));
    const after = applyOps(data, ops);
    expect(after.schedules).toHaveLength(1);
    expect(after.schedules[0]).toMatchObject({ kind: '在宅', start: D, end: D, memberIds: ['m1'] });
  });

  it('複数日・複数人の予定の途中で1人だけ動かすと、元の予定は変えずに重ねる', () => {
    const trip = sched({ memberIds: ['m1', 'm2'], start: '2026-11-24', end: '2026-11-27', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const data = board({ schedules: [trip] });
    const ops = opsOf(dropMember(data, 'm1', '休み', D, 'dev'));
    const after = applyOps(data, ops);
    expect(after.schedules.find((s) => s.id === trip.id)).toEqual(trip);
    expect(after.schedules).toHaveLength(2);
    expect(areaOf(after, after.members[0], D)).toBe('休み');
    expect(areaOf(after, after.members[0], '2026-11-26')).toBe('現場');
    expect(areaOf(after, after.members[1], D)).toBe('現場');
    expect(vehicleBars(after, 'v1', '2026-11-23', '2026-11-29')[0]).toMatchObject({ start: '2026-11-24', end: '2026-11-27' });
  });

  it('現場の人を普段の居場所へ動かすと、その日だけ居場所の予定を重ねる', () => {
    const trip = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-27', kind: '現場', site: 'A倉庫' });
    const data = board({ schedules: [trip] });
    const after = applyOps(data, opsOf(dropMember(data, 'm1', 'LABO', D, 'dev')));
    expect(after.schedules).toHaveLength(2);
    expect(areaOf(after, after.members[0], D)).toBe('LABO');
  });

  it('現場欄へ落とすと、現場予定の入力欄を開く', () => {
    expect(dropMember(board(), 'm1', '現場', D, 'dev')).toEqual({ openDialog: { kind: '現場', memberIds: ['m1'], start: D, end: D } });
  });

  it('存在しない人員は何もしない', () => {
    expect(dropMember(board(), 'ghost', '休み', D, 'dev')).toEqual({ noop: true });
  });

  it('重ねた「その日だけの休み」を現場欄へ戻すと、入力欄は開かず休みを取り消す', () => {
    const trip = sched({ memberIds: ['m1', 'm2'], start: '2026-11-24', end: '2026-11-27', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const data = board({ schedules: [trip] });
    const overlaid = applyOps(data, opsOf(dropMember(data, 'm1', '休み', D, 'dev')));
    const off = overlaid.schedules.find((s) => s.id !== trip.id)!;
    const back = dropMember(overlaid, 'm1', '現場', D, 'dev');
    expect(back).toEqual({ ops: [{ type: 'delete', collection: 'schedules', id: off.id }] });
    const after = applyOps(overlaid, opsOf(back));
    expect(after.schedules).toEqual([trip]);
    expect(areaOf(after, after.members[0], D)).toBe('現場');
  });

  it('1人・1日だけの現場予定は、名札を動かしても消さない（現場名・車両を残して重ねる）', () => {
    const visit = sched({ memberIds: ['m1'], start: D, end: D, kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const data = board({ schedules: [visit] });
    const after = applyOps(data, opsOf(dropMember(data, 'm1', '休み', D, 'dev')));
    expect(after.schedules.find((s) => s.id === visit.id)).toEqual(visit);
    expect(after.schedules).toHaveLength(2);
    expect(areaOf(after, after.members[0], D)).toBe('休み');
  });
});

describe('shouldAutoReload（毎朝の自動読み直し）', () => {
  const four = new Date(2026, 10, 24, 4, 0, 0).getTime();
  const ok = { now: four + 60000, loadedAt: four - 3600000, online: true, status: 'ready' as const, pendingCount: 0, lastSyncAt: four + 30000 };

  it('4時を過ぎ、通信が正常で保存待ちが無ければ読み直す', () => {
    expect(shouldAutoReload(ok)).toBe(true);
    expect(shouldAutoReload({ ...ok, status: 'busy' })).toBe(true);
  });

  it('4時より後に開いた画面は、その日は読み直さない', () => {
    expect(shouldAutoReload({ ...ok, loadedAt: four + 1000 })).toBe(false);
  });

  it('4時前は読み直さない', () => {
    expect(shouldAutoReload({ ...ok, now: four - 60000, lastSyncAt: four - 70000 })).toBe(false);
  });

  it('通信できないとき・同期が古いとき・保存待ちがあるときは読み直さない', () => {
    expect(shouldAutoReload({ ...ok, online: false })).toBe(false);
    expect(shouldAutoReload({ ...ok, status: 'offline' })).toBe(false);
    expect(shouldAutoReload({ ...ok, status: 'rate-limited' })).toBe(false);
    expect(shouldAutoReload({ ...ok, lastSyncAt: four - 600000 })).toBe(false);
    expect(shouldAutoReload({ ...ok, lastSyncAt: null })).toBe(false);
    expect(shouldAutoReload({ ...ok, pendingCount: 1 })).toBe(false);
  });
});

describe('moveBar / resizeBar（車両の帯）', () => {
  const win: [string, string] = ['2026-11-23', '2026-12-06'];

  it('移動すると、帯に入っている予定すべてが同じ日数ずれ、車両も変えられる', () => {
    const a = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-25', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const b = sched({ memberIds: ['m2'], start: '2026-11-25', end: '2026-11-26', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const data = board({ schedules: [a, b] });
    const bar = vehicleBars(data, 'v1', ...win)[0];
    const after = applyOps(data, moveBar(data, bar, 2, 'v2', 'dev'));
    expect(after.schedules.map((s) => [s.id, s.start, s.end, s.vehicleId, s.updatedBy])).toEqual([
      [a.id, '2026-11-26', '2026-11-27', 'v2', 'dev'],
      [b.id, '2026-11-27', '2026-11-28', 'v2', 'dev'],
    ]);
  });

  it('動かしていなければ何も保存しない', () => {
    const a = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-25', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const data = board({ schedules: [a] });
    expect(moveBar(data, vehicleBars(data, 'v1', ...win)[0], 0, 'v1', 'dev')).toEqual([]);
  });

  it('表示範囲で切り詰められた帯でも、元の予定の実際の日付をずらす', () => {
    const a = sched({ memberIds: ['m1'], start: '2026-11-20', end: '2026-11-24', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const data = board({ schedules: [a] });
    const bar = vehicleBars(data, 'v1', ...win)[0];
    expect(bar.start).toBe('2026-11-23');
    const after = applyOps(data, moveBar(data, bar, 1, 'v1', 'dev'));
    expect([after.schedules[0].start, after.schedules[0].end]).toEqual(['2026-11-21', '2026-11-25']);
  });

  it('終了側を伸ばす・開始側を縮める', () => {
    const a = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-25', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const data = board({ schedules: [a] });
    const bar = vehicleBars(data, 'v1', ...win)[0];
    expect(applyOps(data, resizeBar(data, bar, 'end', 3, 'dev')).schedules[0]).toMatchObject({ start: '2026-11-24', end: '2026-11-28' });
    expect(applyOps(data, resizeBar(data, bar, 'start', 1, 'dev')).schedules[0]).toMatchObject({ start: '2026-11-25', end: '2026-11-25' });
  });

  it('開始が終了を追い越さない（1日分は必ず残る）', () => {
    const a = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-25', kind: '現場', site: 'A倉庫', vehicleId: 'v1' });
    const data = board({ schedules: [a] });
    const bar = vehicleBars(data, 'v1', ...win)[0];
    expect(applyOps(data, resizeBar(data, bar, 'start', 5, 'dev')).schedules[0]).toMatchObject({ start: '2026-11-25', end: '2026-11-25' });
    expect(applyOps(data, resizeBar(data, bar, 'end', -5, 'dev')).schedules[0]).toMatchObject({ start: '2026-11-24', end: '2026-11-24' });
  });
});

describe('memberRow（予定入力の1行）', () => {
  const days = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];

  it('予定の無い日は1マスずつ、連続する同じ予定は1つにまとめる', () => {
    const trip = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-26', kind: '現場', site: 'A倉庫' });
    const row = memberRow(board({ schedules: [trip] }), 'm1', days);
    expect(row.map((c) => [c.date, c.schedule?.id ?? null, c.span])).toEqual([
      ['2026-11-23', null, 1],
      ['2026-11-24', trip.id, 3],
      ['2026-11-27', null, 1],
      ['2026-11-28', null, 1],
      ['2026-11-29', null, 1],
    ]);
    expect(row.reduce((n, c) => n + c.span, 0)).toBe(7);
  });

  it('重ねた予定で分かれる場合は、前後を別のマスにする', () => {
    const trip = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-26', kind: '現場', site: 'A倉庫' });
    const off = sched({ memberIds: ['m1'], start: '2026-11-25', end: '2026-11-25', kind: '休み' });
    const row = memberRow(board({ schedules: [trip, off] }), 'm1', days);
    expect(row.map((c) => [c.schedule?.id ?? null, c.span, c.overlapped])).toEqual([
      [null, 1, 0], [trip.id, 1, 0], [off.id, 1, 1], [trip.id, 1, 0], [null, 1, 0], [null, 1, 0], [null, 1, 0],
    ]);
  });

  it('表示範囲の前から続く予定は isStart が false', () => {
    const trip = sched({ memberIds: ['m1'], start: '2026-11-20', end: '2026-11-24', kind: '現場', site: 'A倉庫' });
    const first = memberRow(board({ schedules: [trip] }), 'm1', days)[0];
    expect(first).toMatchObject({ span: 2, isStart: false, archived: false });
  });

  it('過去の記録（アーカイブ）の予定は archived になる', () => {
    const old = sched({ memberIds: ['m1'], start: '2026-11-24', end: '2026-11-24', kind: '休み' });
    const row = memberRow(board(), 'm1', days, [old]);
    expect(row[1]).toMatchObject({ archived: true, span: 1 });
    expect(row[1].schedule?.id).toBe(old.id);
  });
});

describe('validateSchedule', () => {
  const ok = { kind: '現場' as Kind, site: 'A倉庫', memberIds: ['m1'], start: D, end: D, vehicleId: null };
  it('正しければ null', () => {
    expect(validateSchedule(ok)).toBeNull();
    expect(validateSchedule({ ...ok, kind: '休み', site: '' })).toBeNull();
    expect(validateSchedule({ ...ok, memberIds: [], vehicleId: 'v1', site: '車検' })).toBeNull();
  });
  it('誤りはメッセージで返す', () => {
    expect(validateSchedule({ ...ok, start: '2026-11-26' })).toBe('終了日は開始日以降にしてください');
    expect(validateSchedule({ ...ok, site: '  ' })).toBe('現場名を入力してください');
    expect(validateSchedule({ ...ok, memberIds: [], vehicleId: null })).toBe('人員か車両を選んでください');
    expect(validateSchedule({ ...ok, memberIds: [], vehicleId: 'v1', site: '' })).toBe('内容を入力してください（車検など）');
    expect(validateSchedule({ ...ok, start: '' })).toBe('日付を入力してください');
  });
});

describe('adminActions', () => {
  it('人員は末尾に追加され、名前が空なら追加しない', () => {
    const data = board();
    const ops = addMember(data, ' 緑川 ', 'g1', '本社', 'dev');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'upsert', collection: 'members', record: { name: '緑川', groupId: 'g1', base: '本社', order: 2, active: true, updatedBy: 'dev' } });
    expect(addMember(data, '   ', 'g1', 'LABO', 'dev')).toEqual([]);
  });

  it('グループ・車両も末尾に追加される', () => {
    const data = board();
    expect(addGroup(data, '第三', 'dev')[0]).toMatchObject({ collection: 'groups', record: { name: '第三', order: 2 } });
    expect(addVehicle(data, '3号車', 'dev')[0]).toMatchObject({ collection: 'vehicles', record: { name: '3号車', order: 2, active: true } });
    expect(addGroup(data, '', 'dev')).toEqual([]);
  });

  it('並び替えは隣と入れ替わり、端では何もしない', () => {
    const data = board();
    const g1 = data.members.filter((m) => m.groupId === 'g1');
    const after = applyOps(data, moveOrder('members', g1, 'm2', -1, 'dev'));
    const sorted = after.members.filter((m) => m.groupId === 'g1').sort((a, b) => a.order - b.order).map((m) => m.id);
    expect(sorted).toEqual(['m2', 'm1']);
    expect(moveOrder('members', g1, 'm1', -1, 'dev')).toEqual([]);
    expect(moveOrder('members', g1, 'm2', 1, 'dev')).toEqual([]);
  });

  it('並び順の値が重複していても正しく入れ替わる', () => {
    const list = [member('a', 'A', 'g1', 'LABO', 0), member('b', 'B', 'g1', 'LABO', 0), member('c', 'C', 'g1', 'LABO', 0)];
    const after = applyOps({ ...board(), members: list }, moveOrder('members', list, 'c', -1, 'dev'));
    expect([...after.members].sort((x, y) => x.order - y.order).map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });

  it('所属人員のいるグループは削除できない', () => {
    const data = board();
    expect(canDeleteGroup(data, 'g1')).toBe(false);
    expect(canDeleteGroup({ ...data, members: data.members.filter((m) => m.groupId !== 'g2') }, 'g2')).toBe(true);
  });
});
