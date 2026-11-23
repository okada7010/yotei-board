import { DEMO_KEY } from '../RegisterPage';

/**
 * お試しモードを終了して端末登録画面へ戻る。
 * お試しデータ（ブラウザ内）は消さないので、もう一度お試しモードを開けば続きから使える。
 */
export async function leaveToRegister(
  store: { flush: () => Promise<void> },
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  try {
    await store.flush();
  } catch {
    // お試しデータの保存に失敗しても、戻る操作は妨げない
  }
  localStorage.removeItem(DEMO_KEY);
  window.location.hash = '';
  reload();
}
