import { newId, stamp, type AnyRecord, type Collection, type Op } from '../../domain/ops';
import type { Base, BoardData, Group, Member, Vehicle } from '../../domain/types';

function nextOrder(list: { order: number }[]): number {
  return list.reduce((m, r) => Math.max(m, r.order + 1), 0);
}

export function addMember(data: BoardData, name: string, groupId: string, base: Base, device: string): Op[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const record: Member = stamp({ id: newId(), name: trimmed, groupId, base, order: nextOrder(data.members), active: true, updatedAt: '', updatedBy: '' }, device);
  return [{ type: 'upsert', collection: 'members', record }];
}

export function addGroup(data: BoardData, name: string, device: string): Op[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const record: Group = stamp({ id: newId(), name: trimmed, order: nextOrder(data.groups), updatedAt: '', updatedBy: '' }, device);
  return [{ type: 'upsert', collection: 'groups', record }];
}

export function addVehicle(data: BoardData, name: string, device: string): Op[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const record: Vehicle = stamp({ id: newId(), name: trimmed, order: nextOrder(data.vehicles), active: true, updatedAt: '', updatedBy: '' }, device);
  return [{ type: 'upsert', collection: 'vehicles', record }];
}

/**
 * 並び替え。list は「表示されている順」で渡す。隣と入れ替え、並び順の値を振り直す。
 * 端にいて動けないときは何もしない。
 */
export function moveOrder<T extends AnyRecord & { order: number }>(collection: Collection, list: T[], id: string, dir: -1 | 1, device: string): Op[] {
  const from = list.findIndex((r) => r.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= list.length) return [];
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  const base = Math.min(...list.map((r) => r.order));
  const ops: Op[] = [];
  next.forEach((r, i) => {
    const order = base + i;
    if (r.order !== order) ops.push({ type: 'upsert', collection, record: stamp({ ...r, order }, device) });
  });
  return ops;
}

/** 所属人員（非表示を含む）がいないグループだけ削除できる */
export function canDeleteGroup(data: BoardData, groupId: string): boolean {
  return !data.members.some((m) => m.groupId === groupId);
}
