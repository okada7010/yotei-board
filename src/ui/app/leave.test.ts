// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_KEY } from '../RegisterPage';
import { leaveToRegister } from './leave';

describe('leaveToRegister（登録画面へ戻る）', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '#/input';
  });

  it('お試しモードの印だけを消し、お試しデータは残して読み直す', async () => {
    localStorage.setItem(DEMO_KEY, '1');
    localStorage.setItem('yb.demo.master', '{"keep":true}');
    const reload = vi.fn();
    const flush = vi.fn(async () => {
      // 保存が終わるまでは、お試しモードのままであること
      expect(localStorage.getItem(DEMO_KEY)).toBe('1');
    });

    await leaveToRegister({ flush }, reload);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(DEMO_KEY)).toBeNull();
    expect(localStorage.getItem('yb.demo.master')).toBe('{"keep":true}');
    expect(window.location.hash).toBe('');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('保存に失敗しても登録画面へ戻る', async () => {
    localStorage.setItem(DEMO_KEY, '1');
    const reload = vi.fn();
    await leaveToRegister({ flush: () => Promise.reject(new Error('x')) }, reload);
    expect(localStorage.getItem(DEMO_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
