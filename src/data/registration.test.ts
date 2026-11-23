import { beforeEach, describe, expect, it } from 'vitest';
import {
  decodeRegistration,
  deviceName,
  encodeRegistration,
  loadRegistration,
  saveRegistration,
  setDeviceName,
  type Registration,
} from './registration';

const reg: Registration = { owner: 'acme', repo: 'board-data', branch: 'main', token: 'github_pat_ABC-def_123' };

describe('登録コード', () => {
  beforeEach(() => localStorage.clear());

  it('作ったコードを元に戻せる', () => {
    const code = encodeRegistration(reg);
    expect(code.startsWith('YB1.')).toBe(true);
    expect(code).toMatch(/^YB1\.[A-Za-z0-9_-]+$/);
    expect(decodeRegistration(code)).toEqual(reg);
    expect(decodeRegistration(`  ${code}\n`)).toEqual(reg);
  });

  it('形式が違うコードは受け付けない', () => {
    const msg = '登録コードの形式が正しくありません';
    expect(() => decodeRegistration('')).toThrow(msg);
    expect(() => decodeRegistration('hello')).toThrow(msg);
    expect(() => decodeRegistration('YB1.%%%')).toThrow(msg);
    expect(() => decodeRegistration(`YB1.${btoa(JSON.stringify({ o: 'a' }))}`)).toThrow(msg);
    expect(() => decodeRegistration(`YB1.${btoa(JSON.stringify({ o: 'a/b', r: 'r', b: 'main', t: 't' }))}`)).toThrow(msg);
  });

  it('端末に保存・削除できる', () => {
    expect(loadRegistration()).toBeNull();
    saveRegistration(reg);
    expect(loadRegistration()).toEqual(reg);
    saveRegistration(null);
    expect(loadRegistration()).toBeNull();
  });

  it('端末名を保存できる', () => {
    expect(deviceName()).toBe('');
    setDeviceName(' 事務所パネル ');
    expect(deviceName()).toBe('事務所パネル');
  });
});
