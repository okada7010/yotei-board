import { areaOf, effectiveSchedule, type Area } from '../../domain/derive';
import { applyOps, newId, stamp, type Op } from '../../domain/ops';
import type { BoardData, DateStr, Kind, Schedule } from '../../domain/types';

export type DropResult = { ops: Op[] } | { openDialog: Partial<Schedule> } | { noop: true };

export function newSchedule(p: Partial<Schedule> & { start: DateStr; end: DateStr; kind: Kind }, device: string, now: Date = new Date()): Schedule {
  return stamp(
    { id: newId(), memberIds: [], site: '', vehicleId: null, memo: '', createdAt: now.toISOString(), updatedAt: '', updatedBy: '', ...p },
    device,
    now,
  );
}

/**
 * 名札を欄へ落としたときの操作。
 * - その人・その日だけの予定は、消すか置き換える。
 * - 複数日・複数人の予定は変えず、その人のその日だけの予定を重ねる。
 */
export function dropMember(data: BoardData, memberId: string, target: Area, date: DateStr, device: string): DropResult {
  const member = data.members.find((m) => m.id === memberId);
  if (!member) return { noop: true };
  if (areaOf(data, member, date) === target) return { noop: true };
  if (target === '現場') return { openDialog: { kind: '現場', memberIds: [memberId], start: date, end: date } };

  const ops: Op[] = [];
  const eff = effectiveSchedule(data, memberId, date);
  const soloDay = eff !== null && eff.memberIds.length === 1 && eff.start === date && eff.end === date;
  if (eff && soloDay) ops.push({ type: 'delete', collection: 'schedules', id: eff.id });

  const after = applyOps(data, ops);
  if (areaOf(after, member, date) !== target) {
    ops.push({ type: 'upsert', collection: 'schedules', record: newSchedule({ memberIds: [memberId], start: date, end: date, kind: target }, device) });
  }
  return { ops };
}
