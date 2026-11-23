import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileKey, Op } from '../domain/ops';
import type { BoardData, Member, Note, Schedule } from '../domain/types';
import { RepoError, emptySnapshot, fileFromBoard, toBoard, type RateInfo, type Repository, type Snapshot } from './repository';
import { SyncStore, pollInterval } from './store';

const st = { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'test' };
const note = (id: string, text = id): Note => ({ id, category: '連絡事項', text, date: null, endDate: null, done: false, createdAt: st.updatedAt, ...st });
const member = (id: string): Member => ({ id, name: id, groupId: 'g1', base: 'LABO', order: 0, active: true, ...st });
const sched = (id: string, end: string): Schedule => ({ id, memberIds: [], start: end, end, kind: '休み', site: '', vehicleId: null, memo: '', createdAt: st.updatedAt, ...st });
const upNote = (n: Note): Op => ({ type: 'upsert', collection: 'notes', record: n });

/** テスト用の Repository：メモリ上の「サーバー」と、失敗の差し込み口を持つ */
class FakeRepo implements Repository {
  readonly mode = 'github' as const;
  server: Snapshot = emptySnapshot();
  writes: { key: FileKey; message: string }[] = [];
  polls = 0;
  loads = 0;
  writeAttempts = 0;
  failWrite: RepoError[] = [];
  failPoll: RepoError[] = [];
  failLoad: RepoError[] = [];
  rateInfo: RateInfo = { remaining: 4000, resetAt: null };
  archive: Record<string, Schedule[]> = {};
  private v = 0;

  /** 他の端末が変更した、という状況を作る */
  remote(mutate: (d: BoardData) => BoardData, key: FileKey): void {
    const next = mutate(toBoard(this.server));
    this.v += 1;
    this.server = { ...this.server, [key]: { data: fileFromBoard(key, next), version: `r${this.v}` } } as Snapshot;
  }

  async load(): Promise<Snapshot> {
    this.loads += 1;
    const err = this.failLoad.shift();
    if (err) throw err;
    return this.server;
  }

  async poll(prev: Snapshot): Promise<Snapshot | null> {
    this.polls += 1;
    const err = this.failPoll.shift();
    if (err) throw err;
    const changed = (['master', 'schedules', 'notes'] as FileKey[]).some((k) => prev[k].version !== this.server[k].version);
    return changed ? this.server : null;
  }

  async write(key: FileKey, _prev: Snapshot, mutate: (d: BoardData) => BoardData, message: string): Promise<Snapshot> {
    this.writeAttempts += 1;
    const err = this.failWrite.shift();
    if (err) throw err;
    this.writes.push({ key, message });
    this.remote(mutate, key);
    return this.server;
  }

  async loadArchive(year: string): Promise<Schedule[]> {
    return this.archive[year] ?? [];
  }

  async appendArchive(year: string, records: Schedule[]): Promise<void> {
    this.archive[year] = [...(this.archive[year] ?? []), ...records];
  }

  rate(): RateInfo {
    return this.rateInfo;
  }
}

describe('pollInterval', () => {
  it('残りの通信回数が減ると間隔を延ばす', () => {
    expect(pollInterval(null)).toBe(20000);
    expect(pollInterval(5000)).toBe(20000);
    expect(pollInterval(1500)).toBe(20000);
    expect(pollInterval(1499)).toBe(60000);
    expect(pollInterval(500)).toBe(60000);
    expect(pollInterval(499)).toBe(120000);
    expect(pollInterval(0)).toBe(120000);
  });
});

describe('SyncStore', () => {
  let repo: FakeRepo;
  let store: SyncStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 24, 9, 0, 0));
    repo = new FakeRepo();
    store = new SyncStore(repo, '事務所パネル');
  });

  afterEach(() => {
    store.stop();
    vi.useRealTimers();
  });

  it('起動するとデータを読み込み ready になる', async () => {
    repo.remote((d) => ({ ...d, notes: [note('n0')] }), 'notes');
    expect(store.getState().status).toBe('loading');
    await store.start();
    const s = store.getState();
    expect(s.status).toBe('ready');
    expect(s.data.notes.map((n) => n.id)).toEqual(['n0']);
    expect(s.lastSyncAt).toBe(Date.now());
    expect(s.pendingCount).toBe(0);
  });

  it('操作は即座に画面のデータへ反映され、5秒止まったら保存される', async () => {
    await store.start();
    let notified = 0;
    store.subscribe(() => (notified += 1));
    store.dispatch(upNote(note('n1')));
    expect(store.getState().data.notes.map((n) => n.id)).toEqual(['n1']);
    expect(store.getState().pendingCount).toBe(1);
    expect(store.getState().status).toBe('pending');
    expect(notified).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(4900);
    expect(repo.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(repo.writes).toEqual([{ key: 'notes', message: '[事務所パネル] 掲示 1件' }]);
    expect(store.getState().pendingCount).toBe(0);
    expect(store.getState().status).toBe('ready');
    expect(toBoard(repo.server).notes.map((n) => n.id)).toEqual(['n1']);
  });

  it('操作が続いていても、最初の操作から20秒で保存される', async () => {
    await store.start();
    for (let i = 0; i < 6; i++) {
      store.dispatch(upNote(note(`n${i}`)));
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(repo.writes).toHaveLength(0); // 18秒経過
    await vi.advanceTimersByTimeAsync(2100);
    expect(repo.writes).toHaveLength(1);
    expect(repo.writes[0].message).toBe('[事務所パネル] 掲示 6件');
  });

  it('複数ファイルにまたがる操作は、ファイルごとに順番に保存する', async () => {
    await store.start();
    store.dispatch(upNote(note('n1')), { type: 'upsert', collection: 'members', record: member('m1') });
    await store.flush();
    expect(repo.writes.map((w) => w.key)).toEqual(['master', 'notes']);
    expect(toBoard(repo.server).members.map((m) => m.id)).toEqual(['m1']);
    expect(toBoard(repo.server).notes.map((n) => n.id)).toEqual(['n1']);
    expect(store.getState().pendingCount).toBe(0);
  });

  it('通信に失敗しても操作を失わず、再試行して保存する', async () => {
    await store.start();
    repo.failWrite.push(new RepoError('network', 'offline'));
    store.dispatch(upNote(note('n1')));
    await vi.advanceTimersByTimeAsync(5100);
    expect(store.getState().status).toBe('offline');
    expect(store.getState().pendingCount).toBe(1);
    expect(store.getState().data.notes.map((n) => n.id)).toEqual(['n1']);
    await vi.advanceTimersByTimeAsync(5100);
    expect(repo.writes).toHaveLength(1);
    expect(store.getState().pendingCount).toBe(0);
    expect(store.getState().status).toBe('ready');
  });

  it('回数制限中の操作は保存待ちになり、再開時刻の後に保存される', async () => {
    await store.start();
    const retryAt = Date.now() + 5000 + 60000;
    repo.failWrite.push(new RepoError('rate-limited', 'limited', retryAt));
    store.dispatch(upNote(note('n1')));
    await vi.advanceTimersByTimeAsync(5100);
    expect(store.getState().status).toBe('rate-limited');
    expect(store.getState().retryAt).toBe(retryAt);

    store.dispatch(upNote(note('n2')));
    await vi.advanceTimersByTimeAsync(30000);
    expect(repo.writes).toHaveLength(0);
    expect(store.getState().pendingCount).toBe(2);
    expect(store.getState().data.notes.map((n) => n.id)).toEqual(['n1', 'n2']);

    await vi.advanceTimersByTimeAsync(31000);
    expect(repo.writes).toHaveLength(1);
    expect(store.getState().pendingCount).toBe(0);
    expect(toBoard(repo.server).notes.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('鍵が無効になったら操作を保持したまま止まり、以後は問い合わせない', async () => {
    await store.start();
    repo.failWrite.push(new RepoError('unauthorized', 'bad key'));
    store.dispatch(upNote(note('n1')));
    await vi.advanceTimersByTimeAsync(5100);
    expect(store.getState().status).toBe('unauthorized');
    expect(store.getState().pendingCount).toBe(1);
    const polls = repo.polls;
    await vi.advanceTimersByTimeAsync(120000);
    expect(repo.polls).toBe(polls);
    expect(repo.writes).toHaveLength(0);
  });

  it('20秒ごとに他の端末の変更を取り込み、未保存の操作はその上に重ねて見せる', async () => {
    await store.start();
    repo.remote((d) => ({ ...d, notes: [note('remote')] }), 'notes');
    await vi.advanceTimersByTimeAsync(19000);
    expect(store.getState().data.notes).toEqual([]);
    store.dispatch({ type: 'upsert', collection: 'members', record: member('mine') });
    await vi.advanceTimersByTimeAsync(1100);
    expect(store.getState().data.notes.map((n) => n.id)).toEqual(['remote']);
    expect(store.getState().data.members.map((m) => m.id)).toEqual(['mine']);
  });

  it('画面が隠れている間は問い合わせを止め、戻ったらすぐ取り込む', async () => {
    await store.start();
    store.setVisible(false);
    const polls = repo.polls;
    await vi.advanceTimersByTimeAsync(90000);
    expect(repo.polls).toBe(polls);
    repo.remote((d) => ({ ...d, notes: [note('remote')] }), 'notes');
    store.setVisible(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(store.getState().data.notes.map((n) => n.id)).toEqual(['remote']);
  });

  it('残り回数が少ないと混雑中になり、間隔が延びる', async () => {
    await store.start();
    repo.rateInfo = { remaining: 1000, resetAt: null };
    await vi.advanceTimersByTimeAsync(20100);
    expect(store.getState().status).toBe('busy');
    const polls = repo.polls;
    await vi.advanceTimersByTimeAsync(40000);
    expect(repo.polls).toBe(polls);
    await vi.advanceTimersByTimeAsync(20100);
    expect(repo.polls).toBe(polls + 1);
  });

  it('問い合わせが回数制限に当たったら、再開時刻まで待つ', async () => {
    await store.start();
    const retryAt = Date.now() + 20000 + 300000;
    repo.failPoll.push(new RepoError('rate-limited', 'limited', retryAt));
    await vi.advanceTimersByTimeAsync(20100);
    expect(store.getState().status).toBe('rate-limited');
    expect(store.getState().retryAt).toBe(retryAt);
    const polls = repo.polls;
    await vi.advanceTimersByTimeAsync(290000);
    expect(repo.polls).toBe(polls);
    await vi.advanceTimersByTimeAsync(11000);
    expect(repo.polls).toBe(polls + 1);
    expect(store.getState().status).toBe('ready');
  });

  it('データファイルが壊れていたら corrupt になり、何も保存しない', async () => {
    repo.failLoad.push(new RepoError('corrupt', 'bad file'));
    await store.start();
    expect(store.getState().status).toBe('corrupt');
    store.dispatch(upNote(note('n1')));
    await vi.advanceTimersByTimeAsync(60000);
    expect(repo.writes).toHaveLength(0);
    expect(repo.loads).toBe(1);
  });

  it('起動時に通信できなければ、再試行して読み込む', async () => {
    repo.failLoad.push(new RepoError('network', 'offline'));
    await store.start();
    expect(store.getState().status).toBe('offline');
    await vi.advanceTimersByTimeAsync(5100);
    expect(store.getState().status).toBe('ready');
    expect(repo.loads).toBe(2);
  });

  it('起動時に、終了から60日を過ぎた予定を年別の記録へ移す', async () => {
    repo.remote((d) => ({ ...d, schedules: [sched('old', '2026-09-01'), sched('new', '2026-11-20')] }), 'schedules');
    await store.start();
    expect(repo.archive['2026'].map((s) => s.id)).toEqual(['old']);
    expect(store.getState().data.schedules.map((s) => s.id)).toEqual(['new']);
    await store.flush();
    expect(toBoard(repo.server).schedules.map((s) => s.id)).toEqual(['new']);
  });

  it('stop すると以後は問い合わせも保存もしない', async () => {
    await store.start();
    store.dispatch(upNote(note('n1')));
    store.stop();
    await vi.advanceTimersByTimeAsync(120000);
    expect(repo.writes).toHaveLength(0);
    expect(repo.polls).toBe(0);
  });

  it('鍵を登録し直すと、保存待ちだった操作が新しい接続で保存される', async () => {
    await store.start();
    repo.failWrite.push(new RepoError('unauthorized', 'bad key'));
    store.dispatch(upNote(note('n1')));
    await vi.advanceTimersByTimeAsync(5100);
    expect(store.getState().status).toBe('unauthorized');

    const fresh = new FakeRepo();
    await store.reconnect(fresh);
    await vi.advanceTimersByTimeAsync(5100);
    expect(fresh.writes).toHaveLength(1);
    expect(toBoard(fresh.server).notes.map((n) => n.id)).toEqual(['n1']);
    expect(store.getState().status).toBe('ready');
    expect(store.getState().pendingCount).toBe(0);
  });

  it('データを読み込めていない間は読み取り専用で、操作を受け付けない', async () => {
    expect(store.getState().readOnly).toBe(true);
    repo.failLoad.push(new RepoError('corrupt', 'bad file'));
    await store.start();
    expect(store.getState().readOnly).toBe(true);
    store.dispatch(upNote(note('n1')));
    expect(store.getState().pendingCount).toBe(0);
    expect(store.getState().data.notes).toEqual([]);
  });

  it('正常に読み込めたら編集でき、途中でファイルが壊れたら読み取り専用になる', async () => {
    await store.start();
    expect(store.getState().readOnly).toBe(false);
    repo.failPoll.push(new RepoError('corrupt', 'bad file'));
    await vi.advanceTimersByTimeAsync(20100);
    expect(store.getState().status).toBe('corrupt');
    expect(store.getState().readOnly).toBe(true);
    store.dispatch(upNote(note('n1')));
    expect(store.getState().pendingCount).toBe(0);
  });

  it('再開時刻が過去でも、回数制限中は最低1分は再試行しない（flush でも送らない）', async () => {
    await store.start();
    repo.failWrite.push(new RepoError('rate-limited', 'limited', Date.now() - 3600000));
    repo.failWrite.push(new RepoError('rate-limited', 'limited', Date.now() - 3600000));
    store.dispatch(upNote(note('n1')));
    await vi.advanceTimersByTimeAsync(5100);
    expect(repo.writeAttempts).toBe(1);
    await store.flush();
    await vi.advanceTimersByTimeAsync(50000);
    expect(repo.writeAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(11000); // 最初の失敗から約61秒
    expect(repo.writeAttempts).toBe(2);
    // 2回続けて制限されたら、待ち時間を倍（2分）に延ばす
    await vi.advanceTimersByTimeAsync(100000);
    expect(repo.writeAttempts).toBe(2);
    await vi.advanceTimersByTimeAsync(25000);
    expect(repo.writeAttempts).toBe(3);
    expect(store.getState().pendingCount).toBe(0);
  });

  it('保存先のリポジトリに届かなくなったら、鍵の問題として止める', async () => {
    await store.start();
    repo.failWrite.push(new RepoError('not-found', 'gone'));
    store.dispatch(upNote(note('n1')));
    await vi.advanceTimersByTimeAsync(5100);
    expect(store.getState().status).toBe('unauthorized');
    expect(store.getState().pendingCount).toBe(1);
  });
});
