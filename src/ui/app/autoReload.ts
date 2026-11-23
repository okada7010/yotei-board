import type { SyncStatus } from '../../data/store';

export interface AutoReloadInput {
  now: number;
  /** この画面を開いた時刻 */
  loadedAt: number;
  online: boolean;
  status: SyncStatus;
  pendingCount: number;
  lastSyncAt: number | null;
}

const FRESH_MS = 5 * 60 * 1000;

/**
 * 常時表示の端末が新しい版を取り込むための、毎朝4時過ぎの読み直しをしてよいか。
 * 通信が不調なときに読み直すとブラウザのエラー画面になってしまうため、
 * 直近に同期できているときだけ読み直す。
 */
export function shouldAutoReload(i: AutoReloadInput): boolean {
  const four = new Date(i.now);
  four.setHours(4, 0, 0, 0);
  const fourMs = four.getTime();
  if (i.now < fourMs || i.loadedAt >= fourMs) return false;
  if (!i.online || i.pendingCount > 0) return false;
  if (i.status !== 'ready' && i.status !== 'busy') return false;
  return i.lastSyncAt !== null && i.now - i.lastSyncAt <= FRESH_MS;
}
