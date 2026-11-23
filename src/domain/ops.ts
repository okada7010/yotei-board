import { addDays, isValidDateStr } from './dates';
import type { BoardData, DateStr, Group, Member, Note, Schedule, Vehicle } from './types';

export type Collection = 'groups' | 'members' | 'vehicles' | 'schedules' | 'notes';
export type FileKey = 'master' | 'schedules' | 'notes';
export const FILE_KEYS: FileKey[] = ['master', 'schedules', 'notes'];
export type AnyRecord = Group | Member | Vehicle | Schedule | Note;

export type Op =
  | { type: 'upsert'; collection: Collection; record: AnyRecord }
  | { type: 'delete'; collection: Collection; id: string }
  | { type: 'replaceAll'; data: BoardData };

const FILE_OF: Record<Collection, FileKey> = {
  groups: 'master',
  members: 'master',
  vehicles: 'master',
  schedules: 'schedules',
  notes: 'notes',
};

const LABEL: Record<Collection, string> = {
  groups: 'グループ',
  members: '人員',
  vehicles: '車両',
  schedules: '予定',
  notes: '掲示',
};

export function fileOf(c: Collection): FileKey {
  return FILE_OF[c];
}

export function filesOf(op: Op): FileKey[] {
  return op.type === 'replaceAll' ? [...FILE_KEYS] : [fileOf(op.collection)];
}

export function applyOp(data: BoardData, op: Op): BoardData {
  if (op.type === 'replaceAll') {
    return {
      groups: [...op.data.groups],
      members: [...op.data.members],
      vehicles: [...op.data.vehicles],
      schedules: [...op.data.schedules],
      notes: [...op.data.notes],
    };
  }
  const list = data[op.collection] as AnyRecord[];
  if (op.type === 'delete') {
    if (!list.some((r) => r.id === op.id)) return data;
    return { ...data, [op.collection]: list.filter((r) => r.id !== op.id) };
  }
  const exists = list.some((r) => r.id === op.record.id);
  const next = exists ? list.map((r) => (r.id === op.record.id ? op.record : r)) : [...list, op.record];
  return { ...data, [op.collection]: next };
}

export function applyOps(data: BoardData, ops: Op[]): BoardData {
  return ops.reduce(applyOp, data);
}

export function newId(): string {
  return crypto.randomUUID();
}

/** 更新日時・更新端末を付ける */
export function stamp<T extends { updatedAt: string; updatedBy: string }>(rec: T, device: string, now: Date = new Date()): T {
  return { ...rec, updatedAt: now.toISOString(), updatedBy: device };
}

/** コミットメッセージ用の要約（'予定 2件, 人員 1件'） */
export function summarize(ops: Op[]): string {
  if (ops.some((o) => o.type === 'replaceAll')) return '全データ置き換え';
  const order: Collection[] = ['schedules', 'notes', 'members', 'groups', 'vehicles'];
  const counts = new Map<Collection, number>();
  for (const op of ops) {
    if (op.type === 'replaceAll') continue;
    counts.set(op.collection, (counts.get(op.collection) ?? 0) + 1);
  }
  return order
    .filter((c) => counts.has(c))
    .map((c) => `${LABEL[c]} ${counts.get(c)}件`)
    .join(', ');
}

export const ARCHIVE_AFTER_DAYS = 60;

/** 終了日が「今日−60日」より前の予定を、終了日の年ごとに分ける */
export function splitArchive(schedules: Schedule[], todayStr: DateStr): { keep: Schedule[]; archive: Record<string, Schedule[]> } {
  const limit = addDays(todayStr, -ARCHIVE_AFTER_DAYS);
  const keep: Schedule[] = [];
  const archive: Record<string, Schedule[]> = {};
  for (const s of schedules) {
    if (isValidDateStr(s.end) && s.end < limit) {
      const year = s.end.slice(0, 4);
      (archive[year] ??= []).push(s);
    } else {
      keep.push(s);
    }
  }
  return { keep, archive };
}

/** 同じIDは b を優先して1件にまとめる */
export function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const override = new Map(b.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of a) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(override.get(r.id) ?? r);
  }
  for (const r of b) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export interface Backup {
  format: 'yotei-board-backup';
  version: 1;
  exportedAt: string;
  data: BoardData;
}

export function makeBackup(data: BoardData, now: Date = new Date()): Backup {
  return { format: 'yotei-board-backup', version: 1, exportedAt: now.toISOString(), data };
}

const COLLECTIONS: Collection[] = ['groups', 'members', 'vehicles', 'schedules', 'notes'];

export function isBoardData(v: unknown): v is BoardData {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return COLLECTIONS.every(
    (c) => Array.isArray(o[c]) && (o[c] as unknown[]).every((r) => typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string'),
  );
}

export function parseBackup(json: string): BoardData {
  const fail = () => new Error('バックアップファイルの形式が正しくありません');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw fail();
  }
  if (typeof parsed !== 'object' || parsed === null) throw fail();
  const b = parsed as Partial<Backup>;
  if (b.format !== 'yotei-board-backup' || b.version !== 1 || !isBoardData(b.data)) throw fail();
  return b.data;
}
