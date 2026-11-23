import { today } from '../domain/dates';
import { FILE_KEYS, applyOps, filesOf, splitArchive, summarize, type FileKey, type Op } from '../domain/ops';
import { emptyBoard, type BoardData, type Schedule } from '../domain/types';
import { RepoError, toBoard, type Repository, type Snapshot } from './repository';

export type SyncStatus =
  | 'loading'
  | 'ready'
  | 'saving'
  | 'pending'
  | 'offline'
  | 'busy'
  | 'rate-limited'
  | 'unauthorized'
  | 'corrupt';

export interface StoreState {
  data: BoardData;
  status: SyncStatus;
  /** 最後にサーバーと一致を確認した時刻（ms） */
  lastSyncAt: number | null;
  /** まだ保存できていない操作の数 */
  pendingCount: number;
  /** 回数制限からの再開時刻（ms） */
  retryAt: number | null;
  error: string | null;
  /** データを読み込めていない／壊れている間は true（編集を受け付けない） */
  readOnly: boolean;
}

export const SAVE_IDLE_MS = 5000;
export const SAVE_MAX_MS = 20000;
const BACKOFF_START_MS = 5000;
const BACKOFF_MAX_MS = 60000;
/** 回数制限に当たったときの最低待ち時間。続けて当たるたびに倍にする */
const RATE_WAIT_START_MS = 60000;
const RATE_WAIT_MAX_MS = 600000;

/** 残りの通信回数に応じた問い合わせ間隔 */
export function pollInterval(remaining: number | null): number {
  if (remaining === null || remaining >= 1500) return 20000;
  if (remaining >= 500) return 60000;
  return 120000;
}

interface Pending {
  op: Op;
  /** まだ保存していないファイル */
  files: Set<FileKey>;
}

/**
 * 画面に見せるデータ＝サーバーの内容＋未保存の操作。
 * 操作はまとめて保存し、他の端末の変更は定期的に取り込む。
 */
export class SyncStore {
  readonly mode: 'local' | 'github';
  private snapshot: Snapshot | null = null;
  private queue: Pending[] = [];
  private listeners = new Set<() => void>();
  private state: StoreState = { data: emptyBoard(), status: 'loading', lastSyncAt: null, pendingCount: 0, retryAt: null, error: null, readOnly: true };
  private chain: Promise<unknown> = Promise.resolve();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt: number | null = null;
  private saving = false;
  private visible = true;
  private stopped = false;
  /** 'offline' | 'rate-limited' | 'unauthorized' | 'corrupt' のいずれか（正常時は null） */
  private blocked: Extract<SyncStatus, 'offline' | 'rate-limited' | 'unauthorized' | 'corrupt'> | null = null;
  private retryAt: number | null = null;
  private backoff = BACKOFF_START_MS;
  private rateWait = RATE_WAIT_START_MS;
  private error: string | null = null;
  private lastSyncAt: number | null = null;

  constructor(
    private repo: Repository,
    private device: string,
  ) {
    this.mode = repo.mode;
  }

  getState = (): StoreState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  async start(): Promise<void> {
    if (this.stopped) return;
    try {
      this.snapshot = await this.exclusive(() => this.repo.load());
      this.lastSyncAt = Date.now();
      this.clearBlock();
      this.emit();
      await this.archiveOld();
      this.schedulePoll();
      if (this.queue.length > 0) this.scheduleSave();
    } catch (e) {
      this.handleError(e);
      if (this.blocked === 'offline' || this.blocked === 'rate-limited') {
        this.startTimer = setTimeout(() => void this.start(), this.waitMs());
      }
    }
  }

  /**
   * 保存先をつなぎ直す（鍵を登録し直したとき）。
   * 保存待ちの操作は捨てず、新しい接続で読み直したあとに保存する。
   */
  async reconnect(repo: Repository): Promise<void> {
    for (const t of [this.saveTimer, this.pollTimer, this.startTimer]) if (t !== null) clearTimeout(t);
    this.saveTimer = this.pollTimer = this.startTimer = null;
    this.repo = repo;
    this.clearBlock();
    this.emit();
    await this.start();
  }

  /** 過去の記録（年別ファイル）へ追記する（バックアップから戻すとき） */
  appendArchive(year: string, records: Schedule[]): Promise<void> {
    return this.exclusive(() => this.repo.appendArchive(year, records, `[${this.device}] 過去の記録を復元 ${records.length}件`));
  }

  stop(): void {
    this.stopped = true;
    for (const t of [this.saveTimer, this.pollTimer, this.startTimer]) if (t !== null) clearTimeout(t);
    this.saveTimer = this.pollTimer = this.startTimer = null;
  }

  /** 操作を即座に画面へ反映し、保存待ちに入れる */
  dispatch(...ops: Op[]): void {
    if (ops.length === 0 || this.readOnly()) return;
    for (const op of ops) this.queue.push({ op, files: new Set(filesOf(op)) });
    if (this.firstPendingAt === null) this.firstPendingAt = Date.now();
    this.emit();
    this.scheduleSave();
  }

  /** 直ちに保存する */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  /** 画面が隠れている間は問い合わせを止める */
  setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (v && this.snapshot && !this.stopped) void this.poll();
  }

  /** 過去の記録（年別ファイル）を読む */
  loadArchive(year: string): Promise<Schedule[]> {
    return this.exclusive(() => this.repo.loadArchive(year));
  }

  // ---- 内部 ----

  /** repo への呼び出しを1つずつ順番に行う（保存と問い合わせを重ねない） */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private halted(): boolean {
    return this.blocked === 'unauthorized' || this.blocked === 'corrupt';
  }

  /** データを読み込めていない／壊れている間は編集させない（空のデータで上書きしないため） */
  private readOnly(): boolean {
    return this.snapshot === null || this.blocked === 'corrupt';
  }

  /** 回数制限の待ち時間中か */
  private rateBlocked(): boolean {
    return this.blocked === 'rate-limited' && this.retryAt !== null && Date.now() < this.retryAt;
  }

  private waitMs(): number {
    if (this.blocked === 'rate-limited' && this.retryAt !== null) return Math.max(0, this.retryAt - Date.now()) + 50;
    return this.backoff;
  }

  private clearBlock(): void {
    this.blocked = null;
    this.retryAt = null;
    this.error = null;
    this.backoff = BACKOFF_START_MS;
    this.rateWait = RATE_WAIT_START_MS;
  }

  private handleError(e: unknown): void {
    const err = e instanceof RepoError ? e : new RepoError('network', e instanceof Error ? e.message : String(e));
    this.error = err.message;
    // リポジトリに届かない（not-found）のは、鍵の対象が変わった場合なので鍵の問題として扱う
    if (err.code === 'unauthorized' || err.code === 'not-found') this.blocked = 'unauthorized';
    else if (err.code === 'corrupt') this.blocked = 'corrupt';
    else if (err.code === 'rate-limited') {
      // 端末の時計がずれていても連打しないよう、最低待ち時間を設け、続けて当たるたびに倍にする
      this.blocked = 'rate-limited';
      this.retryAt = Math.max(err.retryAt ?? 0, Date.now() + this.rateWait);
      this.rateWait = Math.min(this.rateWait * 2, RATE_WAIT_MAX_MS);
    } else {
      if (this.blocked === 'offline') this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
      this.blocked = 'offline';
    }
    this.emit();
  }

  private computeStatus(): SyncStatus {
    if (this.blocked) return this.blocked;
    if (!this.snapshot) return 'loading';
    if (this.saving) return 'saving';
    if (this.queue.length > 0) return 'pending';
    if (pollInterval(this.repo.rate().remaining) > 20000) return 'busy';
    return 'ready';
  }

  private emit(): void {
    const base = this.snapshot ? toBoard(this.snapshot) : emptyBoard();
    this.state = {
      data: this.queue.length > 0 ? applyOps(base, this.queue.map((p) => p.op)) : base,
      status: this.computeStatus(),
      lastSyncAt: this.lastSyncAt,
      pendingCount: this.queue.length,
      retryAt: this.blocked === 'rate-limited' ? this.retryAt : null,
      error: this.error,
      readOnly: this.readOnly(),
    };
    this.listeners.forEach((fn) => fn());
  }

  private scheduleSave(): void {
    if (this.stopped || this.halted() || !this.snapshot || this.queue.length === 0) return;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    const now = Date.now();
    let delay = SAVE_IDLE_MS;
    if (this.firstPendingAt !== null) delay = Math.min(delay, Math.max(0, this.firstPendingAt + SAVE_MAX_MS - now));
    if (this.blocked === 'rate-limited' || this.blocked === 'offline') delay = Math.max(delay, this.waitMs());
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, delay);
  }

  private async save(): Promise<void> {
    if (this.stopped || this.halted() || this.saving || !this.snapshot || this.queue.length === 0) return;
    if (this.rateBlocked()) {
      this.scheduleSave();
      return;
    }
    this.saving = true;
    this.emit();
    const batch = [...this.queue];
    try {
      await this.exclusive(async () => {
        for (const key of FILE_KEYS) {
          const targets = batch.filter((p) => p.files.has(key));
          if (targets.length === 0) continue;
          const ops = targets.map((p) => p.op);
          this.snapshot = await this.repo.write(key, this.snapshot!, (d) => applyOps(d, ops), `[${this.device}] ${summarize(ops)}`);
          for (const p of targets) p.files.delete(key);
          this.queue = this.queue.filter((p) => p.files.size > 0);
        }
      });
      this.lastSyncAt = Date.now();
      this.clearBlock();
    } catch (e) {
      this.handleError(e);
    } finally {
      this.saving = false;
      this.firstPendingAt = this.queue.length > 0 ? (this.blocked ? this.firstPendingAt : Date.now()) : null;
      this.emit();
      if (this.queue.length > 0) this.scheduleSave();
    }
  }

  private schedulePoll(delay?: number): void {
    if (this.stopped || this.halted() || !this.visible) return;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    let ms = delay ?? pollInterval(this.repo.rate().remaining);
    if (delay === undefined && (this.blocked === 'rate-limited' || this.blocked === 'offline')) ms = Math.max(ms, this.waitMs());
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.poll();
    }, ms);
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.halted() || !this.snapshot || !this.visible) return;
    if (this.rateBlocked()) {
      this.schedulePoll();
      return;
    }
    try {
      await this.exclusive(async () => {
        const next = await this.repo.poll(this.snapshot!);
        if (next) this.snapshot = next;
      });
      this.lastSyncAt = Date.now();
      // 保存側の障害（回数制限・通信断）は保存が成功するまで解除しない
      if (this.queue.length === 0 || this.blocked === null) this.clearBlock();
      this.emit();
    } catch (e) {
      this.handleError(e);
    }
    this.schedulePoll();
  }

  /** 終了から60日を過ぎた予定を年別の記録へ移す（失敗しても次回に回す） */
  private async archiveOld(): Promise<void> {
    if (!this.snapshot) return;
    const { archive } = splitArchive(this.snapshot.schedules.data.schedules, today(new Date(Date.now())));
    const years = Object.keys(archive);
    if (years.length === 0) return;
    try {
      const ops: Op[] = [];
      for (const year of years) {
        await this.exclusive(() => this.repo.appendArchive(year, archive[year], `[${this.device}] 過去の記録へ移動 ${archive[year].length}件`));
        for (const s of archive[year]) ops.push({ type: 'delete', collection: 'schedules', id: s.id });
      }
      this.dispatch(...ops);
    } catch {
      // 次回の起動時にやり直す（途中まで移した分は同じIDとして1件にまとまる）
    }
  }
}
