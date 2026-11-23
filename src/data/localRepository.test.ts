import { beforeEach, describe, expect, it } from 'vitest';
import { applyOps } from '../domain/ops';
import type { Schedule } from '../domain/types';
import { LocalRepository } from './localRepository';
import { toBoard } from './repository';

const TODAY = '2026-11-24';
const st = { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'test' };
const sched = (id: string): Schedule => ({
  id, memberIds: [], start: '2026-01-10', end: '2026-01-11', kind: '休み', site: '', vehicleId: null, memo: '', createdAt: st.updatedAt, ...st,
});

describe('LocalRepository（お試しモード）', () => {
  beforeEach(() => localStorage.clear());

  it('初回の読み込みで架空の初期データが入る', async () => {
    const repo = new LocalRepository(localStorage, TODAY);
    const board = toBoard(await repo.load());
    expect(board.groups.length).toBeGreaterThanOrEqual(3);
    expect(board.members.length).toBeGreaterThanOrEqual(12);
    expect(board.vehicles).toHaveLength(6);
    expect(board.schedules.length).toBeGreaterThan(0);
    expect(board.notes.length).toBeGreaterThan(0);
    expect(repo.mode).toBe('local');
  });

  it('書き込みは次の読み込みに反映される（初期データで上書きしない）', async () => {
    const repo = new LocalRepository(localStorage, TODAY);
    const s0 = await repo.load();
    const s1 = await repo.write('notes', s0, (d) => applyOps(d, [{ type: 'upsert', collection: 'notes', record: { id: 'n-x', category: '連絡事項', text: 'テスト', date: null, endDate: null, done: false, createdAt: st.updatedAt, ...st } }]), 'msg');
    expect(toBoard(s1).notes.some((n) => n.id === 'n-x')).toBe(true);
    const again = toBoard(await new LocalRepository(localStorage, TODAY).load());
    expect(again.notes.some((n) => n.id === 'n-x')).toBe(true);
    expect(again.members.length).toBe(toBoard(s0).members.length);
  });

  it('別の画面が書き込むと poll が新しい内容を返し、変更が無ければ null', async () => {
    const a = new LocalRepository(localStorage, TODAY);
    const b = new LocalRepository(localStorage, TODAY);
    const sa = await a.load();
    const sb = await b.load();
    expect(await a.poll(sa)).toBeNull();
    await b.write('schedules', sb, (d) => applyOps(d, [{ type: 'upsert', collection: 'schedules', record: sched('s-new') }]), 'msg');
    const polled = await a.poll(sa);
    expect(polled).not.toBeNull();
    expect(toBoard(polled!).schedules.some((s) => s.id === 's-new')).toBe(true);
    expect(await a.poll(polled!)).toBeNull();
  });

  it('古い内容をもとに書き込んでも、他の画面の変更を消さない', async () => {
    const a = new LocalRepository(localStorage, TODAY);
    const b = new LocalRepository(localStorage, TODAY);
    const sa = await a.load();
    const sb = await b.load();
    await b.write('schedules', sb, (d) => applyOps(d, [{ type: 'upsert', collection: 'schedules', record: sched('from-b') }]), 'msg');
    const after = await a.write('schedules', sa, (d) => applyOps(d, [{ type: 'upsert', collection: 'schedules', record: sched('from-a') }]), 'msg');
    const ids = toBoard(after).schedules.map((s) => s.id);
    expect(ids).toContain('from-a');
    expect(ids).toContain('from-b');
  });

  it('アーカイブは追記され、同じIDは1件として読める', async () => {
    const repo = new LocalRepository(localStorage, TODAY);
    await repo.load();
    expect(await repo.loadArchive('2026')).toEqual([]);
    await repo.appendArchive('2026', [sched('a1'), sched('a2')], 'msg');
    await repo.appendArchive('2026', [sched('a2'), sched('a3')], 'msg');
    expect((await repo.loadArchive('2026')).map((s) => s.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(await repo.loadArchive('2025')).toEqual([]);
  });
});
