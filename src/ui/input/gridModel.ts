import { isValidDateStr } from '../../domain/dates';
import { overlappingSchedules } from '../../domain/derive';
import type { BoardData, DateStr, Schedule } from '../../domain/types';

export interface Cell {
  /** マスの最初の日 */
  date: DateStr;
  schedule: Schedule | null;
  /** 何日分をまとめたマスか */
  span: number;
  /** 予定の開始日がこのマスの最初の日か（表示範囲の前から続く場合は false） */
  isStart: boolean;
  /** 下に重なっている他の予定の数 */
  overlapped: number;
  /** 過去の記録（編集不可） */
  archived: boolean;
}

/** 予定入力画面の1行。連続する同じ予定は1マスにまとめる */
export function memberRow(data: BoardData, memberId: string, days: DateStr[], archive: Schedule[] = []): Cell[] {
  const archivedIds = new Set(archive.map((s) => s.id));
  const liveIds = new Set(data.schedules.map((s) => s.id));
  const all: BoardData =
    archive.length > 0 ? { ...data, schedules: [...data.schedules, ...archive.filter((s) => !liveIds.has(s.id))] } : data;

  const cells: Cell[] = [];
  for (const date of days) {
    const list = overlappingSchedules(all, memberId, date);
    const schedule = list[0] ?? null;
    const overlapped = Math.max(0, list.length - 1);
    const last = cells[cells.length - 1];
    if (schedule && last && last.schedule?.id === schedule.id && last.overlapped === overlapped) {
      last.span += 1;
      continue;
    }
    cells.push({
      date,
      schedule,
      span: 1,
      isStart: schedule ? schedule.start === date : false,
      overlapped,
      archived: schedule ? archivedIds.has(schedule.id) && !liveIds.has(schedule.id) : false,
    });
  }
  return cells;
}

/** 入力内容の誤りをメッセージで返す。正しければ null */
export function validateSchedule(s: Partial<Schedule>): string | null {
  if (!isValidDateStr(s.start) || !isValidDateStr(s.end)) return '日付を入力してください';
  if (s.start > s.end) return '終了日は開始日以降にしてください';
  const members = s.memberIds ?? [];
  if (members.length === 0 && !s.vehicleId) return '人員か車両を選んでください';
  if (members.length === 0 && !(s.site ?? '').trim()) return '内容を入力してください（車検など）';
  if (members.length > 0 && s.kind === '現場' && !(s.site ?? '').trim()) return '現場名を入力してください';
  return null;
}
