/** 'YYYY-MM-DD'（端末ローカル日付） */
export type DateStr = string;

export type Base = 'LABO' | '本社';
export type Kind = '現場' | '在宅' | '休み' | 'LABO' | '本社';
export type NoteCategory = 'トラブル' | '連絡事項' | '来客予定' | 'イベント';

export const KINDS: Kind[] = ['現場', '在宅', '休み', 'LABO', '本社'];
export const BASES: Base[] = ['LABO', '本社'];
export const NOTE_CATEGORIES: NoteCategory[] = ['トラブル', '連絡事項', '来客予定', 'イベント'];

export interface Stamp {
  id: string;
  /** ISO 日時 */
  updatedAt: string;
  /** 最後に更新した端末名 */
  updatedBy: string;
}

export interface Group extends Stamp {
  name: string;
  order: number;
}

export interface Member extends Stamp {
  name: string;
  groupId: string;
  base: Base;
  order: number;
  active: boolean;
}

export interface Vehicle extends Stamp {
  name: string;
  order: number;
  active: boolean;
}

export interface Schedule extends Stamp {
  /** 0人なら車両だけの予定（車検など） */
  memberIds: string[];
  start: DateStr;
  end: DateStr;
  kind: Kind;
  /** 現場名（車両だけの予定では内容） */
  site: string;
  vehicleId: string | null;
  memo: string;
  createdAt: string;
}

export interface Note extends Stamp {
  category: NoteCategory;
  text: string;
  date: DateStr | null;
  endDate: DateStr | null;
  /** 開始・終了の時刻 'HH:MM'。古いレコードには項目が無い */
  timeStart?: string | null;
  timeEnd?: string | null;
  /** 名前（担当・対応者・来客者など。自由入力）。古いレコードには項目が無い */
  person?: string | null;
  done: boolean;
  createdAt: string;
}

export interface BoardData {
  groups: Group[];
  members: Member[];
  vehicles: Vehicle[];
  schedules: Schedule[];
  notes: Note[];
}

export function emptyBoard(): BoardData {
  return { groups: [], members: [], vehicles: [], schedules: [], notes: [] };
}
