import type { Collection } from './ops';
import { BASES, KINDS, NOTE_CATEGORIES } from './types';

/**
 * 読み込んだレコードが、画面の計算に必要な形をしているかを確かめる。
 * 形の違うレコードが1件でもあると全端末の表示が崩れるため、読み込み時にここで止める。
 */
type Rec = Record<string, unknown>;

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStrOrNull = (v: unknown): boolean => v === null || isStr(v);
/** 時刻 'HH:MM'。項目が無い（古いレコード）・null も可 */
const isOptTime = (v: unknown): boolean => v === undefined || v === null || (isStr(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v));

const CHECKS: Record<Collection, (r: Rec) => boolean> = {
  groups: (r) => isStr(r.name) && isNum(r.order),
  members: (r) => isStr(r.name) && isStr(r.groupId) && (BASES as unknown[]).includes(r.base) && isNum(r.order) && isBool(r.active),
  vehicles: (r) => isStr(r.name) && isNum(r.order) && isBool(r.active),
  schedules: (r) =>
    Array.isArray(r.memberIds) && r.memberIds.every(isStr) &&
    isStr(r.start) && isStr(r.end) &&
    (KINDS as unknown[]).includes(r.kind) &&
    isStr(r.site) && isStrOrNull(r.vehicleId) && isStr(r.memo) && isStr(r.createdAt),
  notes: (r) =>
    (NOTE_CATEGORIES as unknown[]).includes(r.category) &&
    isStr(r.text) && isStrOrNull(r.date) && isStrOrNull(r.endDate) && isBool(r.done) && isStr(r.createdAt) &&
    isOptTime(r.timeStart) && isOptTime(r.timeEnd),
};

export function isRecord(collection: Collection, value: unknown): boolean {
  return isObj(value) && isStr(value.id) && CHECKS[collection](value);
}

export function isRecordList(collection: Collection, value: unknown): boolean {
  return Array.isArray(value) && value.every((r) => isRecord(collection, r));
}
