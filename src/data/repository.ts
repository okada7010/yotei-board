import type { FileKey } from '../domain/ops';
import type { BoardData, Group, Member, Note, Schedule, Vehicle } from '../domain/types';

export interface MasterFile {
  version: 1;
  groups: Group[];
  members: Member[];
  vehicles: Vehicle[];
}
export interface SchedulesFile {
  version: 1;
  schedules: Schedule[];
}
export interface NotesFile {
  version: 1;
  notes: Note[];
}
export interface ArchiveFile {
  version: 1;
  schedules: Schedule[];
}

export interface FileMap {
  master: MasterFile;
  schedules: SchedulesFile;
  notes: NotesFile;
}

/** version: GitHub ではファイルの sha、お試しモードでは連番。null は「まだファイルが無い」 */
export interface FileState<T> {
  data: T;
  version: string | null;
  etag?: string | null;
}

export type Snapshot = { [K in FileKey]: FileState<FileMap[K]> };

export interface RateInfo {
  remaining: number | null;
  /** 回数がリセットされる時刻（ms） */
  resetAt: number | null;
}

export type RepoErrorCode = 'unauthorized' | 'rate-limited' | 'conflict' | 'network' | 'corrupt' | 'not-found';

export class RepoError extends Error {
  constructor(
    public code: RepoErrorCode,
    message: string,
    /** 再試行してよい時刻（ms） */
    public retryAt?: number,
  ) {
    super(message);
    this.name = 'RepoError';
  }
}

export interface Repository {
  readonly mode: 'local' | 'github';
  /** 全ファイルを読み込む。ファイルが無ければ空データを返す */
  load(): Promise<Snapshot>;
  /** 変更が無ければ null */
  poll(prev: Snapshot): Promise<Snapshot | null>;
  /**
   * 1ファイルを保存する。mutate は BoardData 全体を受け取り、実装が key のファイル分だけ保存する。
   * 他の端末が先に変更していた場合は、最新を読み直して mutate をやり直す（最大5回）。
   */
  write(key: FileKey, prev: Snapshot, mutate: (data: BoardData) => BoardData, message: string): Promise<Snapshot>;
  loadArchive(year: string): Promise<Schedule[]>;
  appendArchive(year: string, records: Schedule[], message: string): Promise<void>;
  rate(): RateInfo;
}

export function emptyFile<K extends FileKey>(key: K): FileMap[K] {
  const files: FileMap = {
    master: { version: 1, groups: [], members: [], vehicles: [] },
    schedules: { version: 1, schedules: [] },
    notes: { version: 1, notes: [] },
  };
  return files[key];
}

export function emptySnapshot(): Snapshot {
  return {
    master: { data: emptyFile('master'), version: null },
    schedules: { data: emptyFile('schedules'), version: null },
    notes: { data: emptyFile('notes'), version: null },
  };
}

export function toBoard(s: Snapshot): BoardData {
  return {
    groups: s.master.data.groups,
    members: s.master.data.members,
    vehicles: s.master.data.vehicles,
    schedules: s.schedules.data.schedules,
    notes: s.notes.data.notes,
  };
}

export function fileFromBoard<K extends FileKey>(key: K, data: BoardData): FileMap[K] {
  const files: FileMap = {
    master: { version: 1, groups: data.groups, members: data.members, vehicles: data.vehicles },
    schedules: { version: 1, schedules: data.schedules },
    notes: { version: 1, notes: data.notes },
  };
  return files[key];
}

function isRecordList(v: unknown): boolean {
  return Array.isArray(v) && v.every((r) => typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string');
}

/** 読み込んだ JSON がそのファイルとして正しい形かを確かめる。違えば corrupt */
export function validateFile<K extends FileKey>(key: K, value: unknown): FileMap[K] {
  const bad = () => new RepoError('corrupt', `データファイル（${key}）の形式が正しくありません`);
  if (typeof value !== 'object' || value === null) throw bad();
  const o = value as Record<string, unknown>;
  if (o.version !== 1) throw bad();
  const fields: Record<FileKey, string[]> = {
    master: ['groups', 'members', 'vehicles'],
    schedules: ['schedules'],
    notes: ['notes'],
  };
  if (!fields[key].every((f) => isRecordList(o[f]))) throw bad();
  return value as FileMap[K];
}

export function validateArchive(value: unknown): Schedule[] {
  if (typeof value !== 'object' || value === null) throw new RepoError('corrupt', '過去の記録ファイルの形式が正しくありません');
  const o = value as Record<string, unknown>;
  if (o.version !== 1 || !isRecordList(o.schedules)) throw new RepoError('corrupt', '過去の記録ファイルの形式が正しくありません');
  return o.schedules as Schedule[];
}
