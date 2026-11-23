import { describe, expect, it } from 'vitest';
import {
  applyOp,
  applyOps,
  fileOf,
  filesOf,
  makeBackup,
  mergeById,
  newId,
  parseBackup,
  parseBackupFile,
  splitArchive,
  stamp,
  summarize,
  type Op,
} from './ops';
import { emptyBoard, type BoardData, type Group, type Schedule } from './types';

const st = { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'test' };
const group = (id: string, name: string, order = 0): Group => ({ id, name, order, ...st });
const sched = (id: string, end: string, start = end): Schedule => ({
  id, memberIds: ['m1'], start, end, kind: '休み', site: '', vehicleId: null, memo: '', createdAt: st.updatedAt, ...st,
});

describe('applyOp', () => {
  it('upsert は無ければ追加、あれば置き換える（元データは変えない）', () => {
    const d0 = emptyBoard();
    const d1 = applyOp(d0, { type: 'upsert', collection: 'groups', record: group('g1', '第一') });
    expect(d0.groups).toEqual([]);
    expect(d1.groups.map((g) => g.name)).toEqual(['第一']);
    const d2 = applyOp(d1, { type: 'upsert', collection: 'groups', record: group('g1', '改名') });
    expect(d2.groups.map((g) => g.name)).toEqual(['改名']);
    expect(d1.groups.map((g) => g.name)).toEqual(['第一']);
  });

  it('delete は該当IDを消し、無いIDでは何も変えない', () => {
    const d1 = applyOps(emptyBoard(), [
      { type: 'upsert', collection: 'groups', record: group('g1', '第一') },
      { type: 'upsert', collection: 'groups', record: group('g2', '第二') },
    ]);
    expect(applyOp(d1, { type: 'delete', collection: 'groups', id: 'g1' }).groups.map((g) => g.id)).toEqual(['g2']);
    expect(applyOp(d1, { type: 'delete', collection: 'groups', id: 'zzz' }).groups).toEqual(d1.groups);
  });

  it('applyOps は順番に適用する', () => {
    const ops: Op[] = [
      { type: 'upsert', collection: 'groups', record: group('g1', 'A') },
      { type: 'delete', collection: 'groups', id: 'g1' },
      { type: 'upsert', collection: 'groups', record: group('g1', 'B') },
    ];
    expect(applyOps(emptyBoard(), ops).groups.map((g) => g.name)).toEqual(['B']);
  });

  it('replaceAll は全データを置き換える', () => {
    const next: BoardData = { ...emptyBoard(), groups: [group('g9', '新')] };
    const d = applyOp({ ...emptyBoard(), groups: [group('g1', '旧')] }, { type: 'replaceAll', data: next });
    expect(d.groups.map((g) => g.id)).toEqual(['g9']);
  });
});

describe('fileOf / filesOf / summarize', () => {
  it('コレクションを保存先ファイルに対応づける', () => {
    expect(fileOf('groups')).toBe('master');
    expect(fileOf('members')).toBe('master');
    expect(fileOf('vehicles')).toBe('master');
    expect(fileOf('schedules')).toBe('schedules');
    expect(fileOf('notes')).toBe('notes');
    expect(filesOf({ type: 'delete', collection: 'notes', id: 'x' })).toEqual(['notes']);
    expect(filesOf({ type: 'replaceAll', data: emptyBoard() })).toEqual(['master', 'schedules', 'notes']);
  });

  it('変更内容を要約する', () => {
    const ops: Op[] = [
      { type: 'upsert', collection: 'schedules', record: sched('s1', '2026-11-24') },
      { type: 'delete', collection: 'schedules', id: 's2' },
      { type: 'upsert', collection: 'members', record: { id: 'm1', name: '佐藤', groupId: 'g1', base: 'LABO', order: 0, active: true, ...st } },
    ];
    expect(summarize(ops)).toBe('予定 2件, 人員 1件');
    expect(summarize([{ type: 'replaceAll', data: emptyBoard() }])).toBe('全データ置き換え');
  });
});

describe('stamp / newId', () => {
  it('更新日時と端末名を付ける', () => {
    const r = stamp({ id: 'x', name: 'n', updatedAt: '', updatedBy: '' }, '事務所パネル', new Date('2026-11-23T01:02:03.000Z'));
    expect(r).toMatchObject({ id: 'x', name: 'n', updatedAt: '2026-11-23T01:02:03.000Z', updatedBy: '事務所パネル' });
  });

  it('IDは毎回違う', () => {
    expect(newId()).not.toBe(newId());
  });
});

describe('splitArchive', () => {
  it('終了日が今日の61日以上前の予定を、終了日の年ごとに分ける', () => {
    const list = [sched('old', '2026-09-23'), sched('edge', '2026-09-24'), sched('new', '2026-11-20'), sched('lastyear', '2025-12-31')];
    const r = splitArchive(list, '2026-11-23');
    expect(r.keep.map((s) => s.id)).toEqual(['edge', 'new']);
    expect(Object.keys(r.archive).sort()).toEqual(['2025', '2026']);
    expect(r.archive['2026'].map((s) => s.id)).toEqual(['old']);
    expect(r.archive['2025'].map((s) => s.id)).toEqual(['lastyear']);
  });

  it('対象が無ければ archive は空', () => {
    expect(splitArchive([sched('a', '2026-11-22')], '2026-11-23').archive).toEqual({});
  });
});

describe('mergeById', () => {
  it('同じIDは後の一覧を優先し、重複させない', () => {
    const a = [group('g1', '旧'), group('g2', '二')];
    const b = [group('g1', '新'), group('g3', '三')];
    expect(mergeById(a, b).map((g) => `${g.id}:${g.name}`)).toEqual(['g1:新', 'g2:二', 'g3:三']);
  });
});

describe('backup', () => {
  it('書き出したバックアップを読み込める', () => {
    const data: BoardData = { ...emptyBoard(), groups: [group('g1', '第一')], schedules: [sched('s1', '2026-11-24')] };
    const backup = makeBackup(data, new Date('2026-11-23T00:00:00.000Z'));
    expect(backup).toMatchObject({ format: 'yotei-board-backup', version: 1, exportedAt: '2026-11-23T00:00:00.000Z' });
    expect(parseBackup(JSON.stringify(backup))).toEqual(data);
  });

  it('壊れたファイル・形式違いは読み込まない', () => {
    const msg = 'バックアップファイルの形式が正しくありません';
    expect(() => parseBackup('{oops')).toThrow(msg);
    expect(() => parseBackup(JSON.stringify({ format: 'other', version: 1, data: emptyBoard() }))).toThrow(msg);
    expect(() => parseBackup(JSON.stringify({ format: 'yotei-board-backup', version: 1, data: { groups: [] } }))).toThrow(msg);
    expect(() => parseBackup(JSON.stringify({ format: 'yotei-board-backup', version: 2, data: emptyBoard() }))).toThrow(msg);
  });

  it('項目の欠けたレコードを含むバックアップは読み込まない', () => {
    const bad = { format: 'yotei-board-backup', version: 1, exportedAt: 'x', data: { ...emptyBoard(), schedules: [{ id: 's1' }] } };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow('バックアップファイルの形式が正しくありません');
  });

  it('過去の記録（年別）も一緒に書き出し、読み戻せる', () => {
    const data: BoardData = { ...emptyBoard(), groups: [group('g1', '第一')] };
    const archive = { '2025': [sched('old1', '2025-05-01')], '2026': [sched('old2', '2026-02-01')] };
    const json = JSON.stringify(makeBackup(data, new Date('2026-11-23T00:00:00.000Z'), archive));
    const parsed = parseBackupFile(json);
    expect(parsed.data).toEqual(data);
    expect(parsed.archive).toEqual(archive);
    expect(parseBackupFile(JSON.stringify(makeBackup(data))).archive).toEqual({});
  });
});
