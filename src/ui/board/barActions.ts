import { addDays } from '../../domain/dates';
import type { Bar } from '../../domain/derive';
import { stamp, type Op } from '../../domain/ops';
import type { BoardData, Schedule } from '../../domain/types';

function schedulesOf(data: BoardData, bar: Bar): Schedule[] {
  return bar.scheduleIds.map((id) => data.schedules.find((s) => s.id === id)).filter((s): s is Schedule => s !== undefined);
}

/** 帯を日付方向・車両方向へ動かす。帯に入っている予定すべてが対象 */
export function moveBar(data: BoardData, bar: Bar, deltaDays: number, newVehicleId: string, device: string): Op[] {
  if (deltaDays === 0 && newVehicleId === bar.vehicleId) return [];
  return schedulesOf(data, bar).map((s) => ({
    type: 'upsert' as const,
    collection: 'schedules' as const,
    record: stamp({ ...s, start: addDays(s.start, deltaDays), end: addDays(s.end, deltaDays), vehicleId: newVehicleId }, device),
  }));
}

/** 帯の端を伸縮する。開始が終了を追い越さないよう切り詰める */
export function resizeBar(data: BoardData, bar: Bar, edge: 'start' | 'end', deltaDays: number, device: string): Op[] {
  if (deltaDays === 0) return [];
  const list = schedulesOf(data, bar);
  if (list.length === 0) return [];
  const minStart = list.reduce((m, s) => (s.start < m ? s.start : m), list[0].start);
  const maxEnd = list.reduce((m, s) => (s.end > m ? s.end : m), list[0].end);
  const ops: Op[] = [];
  for (const s of list) {
    if (edge === 'start' && s.start === minStart) {
      const next = addDays(s.start, deltaDays);
      const start = next > s.end ? s.end : next;
      if (start !== s.start) ops.push({ type: 'upsert', collection: 'schedules', record: stamp({ ...s, start }, device) });
    }
    if (edge === 'end' && s.end === maxEnd) {
      const next = addDays(s.end, deltaDays);
      const end = next < s.start ? s.start : next;
      if (end !== s.end) ops.push({ type: 'upsert', collection: 'schedules', record: stamp({ ...s, end }, device) });
    }
  }
  return ops;
}
