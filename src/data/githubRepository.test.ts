import { beforeEach, describe, expect, it } from 'vitest';
import { applyOps } from '../domain/ops';
import type { Note, Schedule } from '../domain/types';
import { FakeGitHub } from './fakeGitHub';
import { GitHubRepository } from './githubRepository';
import type { Registration } from './registration';
import { RepoError, toBoard } from './repository';

const reg: Registration = { owner: 'acme', repo: 'board-data', branch: 'main', token: 'good-token' };
const st = { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'test' };
const note = (id: string, text: string): Note => ({ id, category: '連絡事項', text, date: null, endDate: null, done: false, createdAt: st.updatedAt, ...st });
const sched = (id: string): Schedule => ({ id, memberIds: [], start: '2026-01-10', end: '2026-01-11', kind: '休み', site: '', vehicleId: null, memo: '', createdAt: st.updatedAt, ...st });
const addNote = (n: Note) => (d: ReturnType<typeof toBoard>) => applyOps(d, [{ type: 'upsert', collection: 'notes', record: n }]);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return e instanceof RepoError ? e.code : `other: ${String(e)}`;
  }
}

describe('GitHubRepository', () => {
  let gh: FakeGitHub;
  let repo: GitHubRepository;

  beforeEach(() => {
    gh = new FakeGitHub();
    repo = new GitHubRepository(reg, gh.fetch);
  });

  it('ファイルが無いリポジトリは空データとして読める', async () => {
    const snap = await repo.load();
    expect(toBoard(snap)).toEqual({ groups: [], members: [], vehicles: [], schedules: [], notes: [] });
    expect(snap.notes.version).toBeNull();
    expect(gh.count('GET', '/contents/data/')).toBe(3);
    const call = gh.calls[0];
    expect(call.headers.authorization).toBe('Bearer good-token');
    expect(call.headers.accept).toBe('application/vnd.github+json');
  });

  it('日本語を含むデータを保存し、読み戻せる', async () => {
    const s0 = await repo.load();
    const s1 = await repo.write('notes', s0, addNote(note('n1', '月末に棚卸し（全員）')), '[事務所パネル] 掲示 1件');
    expect(s1.notes.version).not.toBeNull();
    expect(JSON.parse(gh.text('data/notes.json')!)).toMatchObject({ version: 1, notes: [{ id: 'n1', text: '月末に棚卸し（全員）' }] });
    const put = gh.calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({ message: '[事務所パネル] 掲示 1件', branch: 'main' });
    expect(put.body?.sha).toBeUndefined();
    const again = toBoard(await new GitHubRepository(reg, gh.fetch).load());
    expect(again.notes.map((n) => n.text)).toEqual(['月末に棚卸し（全員）']);
  });

  it('更新時は直前に読んだ sha を付ける', async () => {
    const sha = gh.put('data/notes.json', JSON.stringify({ version: 1, notes: [note('n0', '既存')] }));
    const s0 = await repo.load();
    await repo.write('notes', s0, addNote(note('n1', '追加')), 'm');
    expect(gh.calls.find((c) => c.method === 'PUT')!.body?.sha).toBe(sha);
    expect(JSON.parse(gh.text('data/notes.json')!).notes.map((n: Note) => n.id)).toEqual(['n0', 'n1']);
  });

  it('poll：変更なしは null、変わったファイルだけ読み直す', async () => {
    gh.put('data/notes.json', JSON.stringify({ version: 1, notes: [] }));
    gh.put('data/schedules.json', JSON.stringify({ version: 1, schedules: [] }));
    gh.put('data/master.json', JSON.stringify({ version: 1, groups: [], members: [], vehicles: [] }));
    const s0 = await repo.load();
    expect(await repo.poll(s0)).toBeNull();
    const polls = gh.calls.slice(-3);
    expect(polls.every((c) => c.headers['if-none-match'])).toBe(true);

    gh.put('data/notes.json', JSON.stringify({ version: 1, notes: [note('n9', '他端末')] }));
    const s1 = await repo.poll(s0);
    expect(s1).not.toBeNull();
    expect(toBoard(s1!).notes.map((n) => n.id)).toEqual(['n9']);
    expect(s1!.master).toBe(s0.master);
    expect(await repo.poll(s1!)).toBeNull();
  });

  it('他の端末が先に保存していたら、最新を読み直して自分の変更を当て直す', async () => {
    gh.put('data/notes.json', JSON.stringify({ version: 1, notes: [] }));
    const s0 = await repo.load();
    gh.put('data/notes.json', JSON.stringify({ version: 1, notes: [note('other', '他端末')] }));
    let mutateCalls = 0;
    const s1 = await repo.write('notes', s0, (d) => { mutateCalls += 1; return addNote(note('mine', '自分'))(d); }, 'm');
    expect(mutateCalls).toBe(2);
    expect(toBoard(s1).notes.map((n) => n.id).sort()).toEqual(['mine', 'other']);
    expect(JSON.parse(gh.text('data/notes.json')!).notes.map((n: Note) => n.id).sort()).toEqual(['mine', 'other']);
    expect(gh.count('PUT')).toBe(2);
  });

  it('5回続けて競合したら conflict で諦める', async () => {
    gh.put('data/notes.json', JSON.stringify({ version: 1, notes: [] }));
    const s0 = await repo.load();
    for (let i = 0; i < 5; i++) gh.overrides.push({ method: 'PUT', status: 409, body: { message: 'conflict' } });
    expect(await codeOf(repo.write('notes', s0, addNote(note('x', 'x')), 'm'))).toBe('conflict');
    expect(gh.count('PUT')).toBe(5);
  });

  it('鍵が無効なら unauthorized', async () => {
    const bad = new GitHubRepository({ ...reg, token: 'revoked' }, gh.fetch);
    expect(await codeOf(bad.load())).toBe('unauthorized');
  });

  it('回数制限は rate-limited と再開時刻を返す', async () => {
    gh.overrides.push({ status: 429, headers: { 'retry-after': '30' }, body: { message: 'secondary rate limit' } });
    const before = Date.now();
    try {
      await repo.load();
      throw new Error('should fail');
    } catch (e) {
      expect(e).toBeInstanceOf(RepoError);
      const err = e as RepoError;
      expect(err.code).toBe('rate-limited');
      expect(err.retryAt).toBeGreaterThanOrEqual(before + 30000);
      expect(err.retryAt).toBeLessThan(before + 40000);
    }
    gh.overrides.push({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' }, body: { message: 'API rate limit exceeded' } });
    try {
      await repo.load();
      throw new Error('should fail');
    } catch (e) {
      expect((e as RepoError).code).toBe('rate-limited');
      expect((e as RepoError).retryAt).toBe(1790000000 * 1000);
    }
  });

  it('通信できないときは network', async () => {
    const offline = new GitHubRepository(reg, async () => { throw new TypeError('Failed to fetch'); });
    expect(await codeOf(offline.load())).toBe('network');
    gh.overrides.push({ status: 502, body: {} });
    expect(await codeOf(repo.load())).toBe('network');
  });

  it('壊れたデータファイルは corrupt とし、上書き保存しない', async () => {
    gh.put('data/master.json', JSON.stringify({ version: 1, groups: [], members: [], vehicles: [] }));
    gh.put('data/schedules.json', JSON.stringify({ version: 1, schedules: [] }));
    gh.put('data/notes.json', JSON.stringify({ version: 1, notes: [] }));
    const s0 = await repo.load();

    gh.put('data/notes.json', '{ これは壊れた JSON');
    expect(await codeOf(new GitHubRepository(reg, gh.fetch).load())).toBe('corrupt');
    expect(await codeOf(repo.poll(s0))).toBe('corrupt');
    // 古い内容をもとに保存しようとしても、壊れたファイルは上書きしない
    expect(await codeOf(repo.write('notes', s0, addNote(note('x', 'x')), 'm'))).toBe('corrupt');
    expect(gh.text('data/notes.json')).toBe('{ これは壊れた JSON');

    gh.put('data/notes.json', JSON.stringify({ version: 2, notes: [] }));
    expect(await codeOf(new GitHubRepository(reg, gh.fetch).load())).toBe('corrupt');
  });

  it('残りの通信回数を応答ヘッダから拾う', async () => {
    expect(repo.rate()).toEqual({ remaining: null, resetAt: null });
    gh.remaining = 1234;
    await repo.load();
    expect(repo.rate()).toEqual({ remaining: 1234, resetAt: 1790000000 * 1000 });
  });

  it('verify：リポジトリに届かなければ not-found', async () => {
    await expect(repo.verify()).resolves.toBeUndefined();
    gh.repoExists = false;
    expect(await codeOf(repo.verify())).toBe('not-found');
  });

  it('アーカイブは年別ファイルに追記し、同じIDは1件にする', async () => {
    expect(await repo.loadArchive('2026')).toEqual([]);
    await repo.appendArchive('2026', [sched('a1'), sched('a2')], 'm');
    await repo.appendArchive('2026', [sched('a2'), sched('a3')], 'm');
    expect((await repo.loadArchive('2026')).map((s) => s.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(gh.files.has('data/archive/schedules-2026.json')).toBe(true);
  });
});

describe('GitHubRepository（最終レビューの指摘）', () => {
  let gh: FakeGitHub;
  let repo: GitHubRepository;
  const seedFiles = () => {
    gh.put('data/master.json', JSON.stringify({ version: 1, groups: [], members: [], vehicles: [] }));
    gh.put('data/schedules.json', JSON.stringify({ version: 1, schedules: [] }));
    gh.put('data/notes.json', JSON.stringify({ version: 1, notes: [] }));
  };

  beforeEach(() => {
    gh = new FakeGitHub();
    repo = new GitHubRepository(reg, gh.fetch);
  });

  it('ヘッダーの無い 403 でも、回数制限の文面なら rate-limited として1分以上待つ', async () => {
    gh.overrides.push({ status: 403, body: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' } });
    const before = Date.now();
    try {
      await repo.load();
      throw new Error('should fail');
    } catch (e) {
      expect((e as RepoError).code).toBe('rate-limited');
      expect((e as RepoError).retryAt).toBeGreaterThanOrEqual(before + 60000);
    }
  });

  it('権限不足の 403 は unauthorized', async () => {
    gh.overrides.push({ status: 403, body: { message: 'Resource not accessible by personal access token' } });
    expect(await codeOf(repo.load())).toBe('unauthorized');
  });

  it('読めていたファイルが見つからなくなったら、空データ扱いにせず corrupt にする', async () => {
    seedFiles();
    const s0 = await repo.load();
    gh.files.delete('data/notes.json');
    expect(await codeOf(repo.poll(s0))).toBe('corrupt');
    expect(await codeOf(repo.write('notes', s0, addNote(note('x', 'x')), 'm'))).toBe('corrupt');
    expect(gh.files.has('data/notes.json')).toBe(false);
  });

  it('verify：ブランチが無ければ not-found', async () => {
    gh.branches = ['master'];
    expect(await codeOf(repo.verify())).toBe('not-found');
  });

  it('項目の欠けた予定・未知の種別があるファイルは corrupt にする', async () => {
    seedFiles();
    gh.put('data/schedules.json', JSON.stringify({ version: 1, schedules: [{ id: 's1', start: '2026-11-24', end: '2026-11-24', kind: '休み' }] }));
    expect(await codeOf(repo.load())).toBe('corrupt');
    gh.put('data/schedules.json', JSON.stringify({ version: 1, schedules: [{ ...sched('s1'), kind: '出張' }] }));
    expect(await codeOf(repo.load())).toBe('corrupt');
    gh.put('data/schedules.json', JSON.stringify({ version: 1, schedules: [sched('s1')] }));
    expect(toBoard(await repo.load()).schedules).toHaveLength(1);
  });
});
