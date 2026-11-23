import { diffDays, isOffDay } from './dates';
import type { BoardData, DateStr, Member, Note, NoteCategory, Schedule } from './types';

export type Area = 'LABO' | '本社' | '在宅' | '休み' | '現場';
export type PlacementArea = Exclude<Area, '現場'>;
export const PLACEMENT_AREAS: PlacementArea[] = ['LABO', '本社', '在宅', '休み'];

function isValid(s: Schedule): boolean {
  return s.start <= s.end;
}

function covers(s: Schedule, date: DateStr): boolean {
  return isValid(s) && s.start <= date && date <= s.end;
}

/** その人・その日を含む予定を「有効順」（期間が短い→新しい）で返す */
export function overlappingSchedules(data: BoardData, memberId: string, date: DateStr): Schedule[] {
  return data.schedules
    .filter((s) => s.memberIds.includes(memberId) && covers(s, date))
    .sort((a, b) => {
      const span = diffDays(a.start, a.end) - diffDays(b.start, b.end);
      if (span !== 0) return span;
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    });
}

export function effectiveSchedule(data: BoardData, memberId: string, date: DateStr): Schedule | null {
  return overlappingSchedules(data, memberId, date)[0] ?? null;
}

export function areaOf(data: BoardData, member: Member, date: DateStr): Area {
  const s = effectiveSchedule(data, member.id, date);
  if (s) return s.kind;
  return isOffDay(date) ? '休み' : member.base;
}

/** 有効な人員を、グループの並び順→グループ内の並び順で返す */
export function sortedMembers(data: BoardData): Member[] {
  const groupOrder = new Map(data.groups.map((g) => [g.id, g.order]));
  return data.members
    .filter((m) => m.active)
    .sort((a, b) => {
      const ga = groupOrder.get(a.groupId) ?? Number.MAX_SAFE_INTEGER;
      const gb = groupOrder.get(b.groupId) ?? Number.MAX_SAFE_INTEGER;
      if (ga !== gb) return ga - gb;
      if (a.order !== b.order) return a.order - b.order;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

export function placement(data: BoardData, date: DateStr): Record<PlacementArea, Member[]> {
  const out: Record<PlacementArea, Member[]> = { LABO: [], 本社: [], 在宅: [], 休み: [] };
  for (const m of sortedMembers(data)) {
    const area = areaOf(data, m, date);
    if (area !== '現場') out[area].push(m);
  }
  return out;
}

export interface SiteGroup {
  site: string;
  members: Member[];
}

export const NO_SITE = '（行き先未入力）';

export function sitesOn(data: BoardData, date: DateStr): SiteGroup[] {
  const groups: SiteGroup[] = [];
  for (const m of sortedMembers(data)) {
    const s = effectiveSchedule(data, m.id, date);
    if (!s || s.kind !== '現場') continue;
    const site = s.site.trim() || NO_SITE;
    let g = groups.find((x) => x.site === site);
    if (!g) {
      g = { site, members: [] };
      groups.push(g);
    }
    g.members.push(m);
  }
  return groups;
}

export interface Bar {
  key: string;
  vehicleId: string;
  /** 表示範囲で切り詰めた開始・終了 */
  start: DateStr;
  end: DateStr;
  site: string;
  memberNames: string[];
  scheduleIds: string[];
  /** 重なり時の段（0始まり） */
  row: number;
  conflict: boolean;
  /** 表示範囲より前から続いている */
  openStart: boolean;
  /** 表示範囲より後へ続いている */
  openEnd: boolean;
}

interface RawBar {
  start: DateStr;
  end: DateStr;
  site: string;
  memberIds: string[];
  scheduleIds: string[];
}

export function vehicleBars(data: BoardData, vehicleId: string, from: DateStr, to: DateStr): Bar[] {
  const targets = data.schedules
    .filter((s) => s.vehicleId === vehicleId && isValid(s))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.createdAt < b.createdAt ? -1 : 1));

  // 同じ現場で日付が重なる予定を1本にまとめる
  const merged: RawBar[] = [];
  for (const s of targets) {
    const site = s.site.trim();
    const hit = merged.find((b) => b.site === site && s.start <= b.end && b.start <= s.end);
    if (hit) {
      if (s.start < hit.start) hit.start = s.start;
      if (s.end > hit.end) hit.end = s.end;
      for (const id of s.memberIds) if (!hit.memberIds.includes(id)) hit.memberIds.push(id);
      hit.scheduleIds.push(s.id);
    } else {
      merged.push({ start: s.start, end: s.end, site, memberIds: [...s.memberIds], scheduleIds: [s.id] });
    }
  }

  const visible = merged.filter((b) => b.start <= to && b.end >= from);
  visible.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const memberOrder = new Map(sortedMembers(data).map((m, i) => [m.id, i]));
  const memberName = new Map(data.members.map((m) => [m.id, m.name]));
  const rowEnds: DateStr[] = [];

  return visible.map((b) => {
    const conflict = visible.some((o) => o !== b && o.start <= b.end && b.start <= o.end);
    let row = rowEnds.findIndex((end) => end < b.start);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(b.end);
    } else {
      rowEnds[row] = b.end;
    }
    const memberNames = b.memberIds
      .filter((id) => memberName.has(id))
      .sort((x, y) => (memberOrder.get(x) ?? 9999) - (memberOrder.get(y) ?? 9999))
      .map((id) => memberName.get(id)!);
    return {
      key: b.scheduleIds.join('+'),
      vehicleId,
      start: b.start < from ? from : b.start,
      end: b.end > to ? to : b.end,
      site: b.site,
      memberNames,
      scheduleIds: b.scheduleIds,
      row,
      conflict,
      openStart: b.start < from,
      openEnd: b.end > to,
    };
  });
}

/** '現場名／A・B'、3人以上は '現場名／A 他n名' */
export function barLabel(bar: Pick<Bar, 'site' | 'memberNames'>): string {
  const site = bar.site || NO_SITE;
  const n = bar.memberNames.length;
  if (n === 0) return site;
  if (n <= 2) return `${site}／${bar.memberNames.join('・')}`;
  return `${site}／${bar.memberNames[0]} 他${n - 1}名`;
}

export interface EventItem {
  key: string;
  text: string;
  date: DateStr | null;
  endDate: DateStr | null;
  source: 'note' | 'vehicle';
  refId: string;
}

/**
 * イベント欄：掲示の「イベント」だけを出す。
 * 車両だけの予定は日々の使用予定にも使うため、車両の帯にだけ出す（イベント欄が埋まるため）。
 */
export function eventsOn(data: BoardData, date: DateStr): EventItem[] {
  const items: EventItem[] = [];
  for (const n of data.notes) {
    if (n.category !== 'イベント' || n.done) continue;
    const last = n.endDate ?? n.date;
    if (last !== null && last < date) continue;
    items.push({ key: `n:${n.id}`, text: n.text, date: n.date, endDate: n.endDate, source: 'note', refId: n.id });
  }
  return items.sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  });
}

/** 掲示欄に出す行（解決済み・日付の過ぎたものを除く） */
export function activeNotes(data: BoardData, category: NoteCategory, date: DateStr): Note[] {
  return data.notes
    .filter((n) => {
      if (n.category !== category || n.done) return false;
      if (category === '来客予定' || category === 'イベント') {
        const last = n.endDate ?? n.date;
        return last === null || last >= date;
      }
      return true;
    })
    .sort((a, b) => {
      if (category === '来客予定' && a.date !== b.date) {
        if (a.date === null) return 1;
        if (b.date === null) return -1;
        return a.date < b.date ? -1 : 1;
      }
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
}

/** 過去に入力した現場名（重複なし・新しい順） */
export function siteSuggestions(data: BoardData): string[] {
  const latest = new Map<string, string>();
  for (const s of data.schedules) {
    if (s.kind !== '現場' || s.memberIds.length === 0) continue;
    const site = s.site.trim();
    if (!site) continue;
    const prev = latest.get(site);
    if (prev === undefined || prev < s.updatedAt) latest.set(site, s.updatedAt);
  }
  return [...latest.entries()].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)).map(([site]) => site);
}
