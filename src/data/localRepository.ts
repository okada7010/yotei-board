import { today } from '../domain/dates';
import { FILE_KEYS, mergeById, type FileKey } from '../domain/ops';
import type { BoardData, DateStr, Schedule } from '../domain/types';
import {
  fileFromBoard,
  toBoard,
  validateFile,
  type FileMap,
  type FileState,
  type RateInfo,
  type Repository,
  type Snapshot,
} from './repository';
import { seedData } from './seed';

const PREFIX = 'yb.demo.';

interface Stored<T> {
  v: number;
  data: T;
}

/** お試しモード：ブラウザ内（localStorage）に保存する。別タブとも共有される */
export class LocalRepository implements Repository {
  readonly mode = 'local' as const;

  constructor(
    private storage: Storage = localStorage,
    private todayStr: DateStr = today(),
  ) {}

  private read<K extends FileKey>(key: K): FileState<FileMap[K]> | null {
    const raw = this.storage.getItem(PREFIX + key);
    if (raw === null) return null;
    const stored = JSON.parse(raw) as Stored<unknown>;
    return { data: validateFile(key, stored.data), version: String(stored.v) };
  }

  private save<K extends FileKey>(key: K, data: FileMap[K], prevVersion: string | null): FileState<FileMap[K]> {
    const v = (prevVersion === null ? 0 : Number(prevVersion)) + 1;
    this.storage.setItem(PREFIX + key, JSON.stringify({ v, data } satisfies Stored<FileMap[K]>));
    return { data, version: String(v) };
  }

  private ensureSeed(): void {
    if (FILE_KEYS.every((k) => this.storage.getItem(PREFIX + k) !== null)) return;
    const seed = seedData(this.todayStr);
    for (const k of FILE_KEYS) {
      if (this.storage.getItem(PREFIX + k) === null) this.save(k, fileFromBoard(k, seed), null);
    }
  }

  private current(): Snapshot {
    this.ensureSeed();
    return { master: this.read('master')!, schedules: this.read('schedules')!, notes: this.read('notes')! };
  }

  async load(): Promise<Snapshot> {
    return this.current();
  }

  async poll(prev: Snapshot): Promise<Snapshot | null> {
    const cur = this.current();
    const changed = FILE_KEYS.some((k) => cur[k].version !== prev[k].version);
    return changed ? cur : null;
  }

  async write(key: FileKey, _prev: Snapshot, mutate: (data: BoardData) => BoardData, _message: string): Promise<Snapshot> {
    // 同じ端末内なので、常に最新を読み直してから当て直す（競合は起きない）
    const cur = this.current();
    const next = mutate(toBoard(cur));
    const saved = this.save(key, fileFromBoard(key, next), cur[key].version);
    return { ...cur, [key]: saved } as Snapshot;
  }

  async loadArchive(year: string): Promise<Schedule[]> {
    const raw = this.storage.getItem(`${PREFIX}archive.${year}`);
    return raw === null ? [] : (JSON.parse(raw) as Schedule[]);
  }

  async appendArchive(year: string, records: Schedule[], _message: string): Promise<void> {
    const merged = mergeById(await this.loadArchive(year), records);
    this.storage.setItem(`${PREFIX}archive.${year}`, JSON.stringify(merged));
  }

  rate(): RateInfo {
    return { remaining: null, resetAt: null };
  }

  /** お試しデータを消して初期状態に戻す */
  static reset(storage: Storage = localStorage): void {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
  }
}
