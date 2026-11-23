import { useBoard } from '../app/AppContext';

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 最終更新時刻と、保存待ち・混雑中などの状態表示 */
export function StatusBar() {
  const { status, lastSyncAt, pendingCount, retryAt, mode } = useBoard();
  let label: string | null = null;
  let tone = 'info';
  switch (status) {
    case 'loading':
      label = '読み込み中';
      break;
    case 'saving':
      label = '保存中';
      break;
    case 'pending':
      label = `保存待ち ${pendingCount}件`;
      break;
    case 'offline':
      label = pendingCount > 0 ? `再接続中（保存待ち ${pendingCount}件）` : '再接続中';
      tone = 'warn';
      break;
    case 'busy':
      label = '混雑中';
      tone = 'warn';
      break;
    case 'rate-limited':
      label = `一時的に更新できません（${retryAt ? hhmm(retryAt) : '--:--'} に再開）${pendingCount > 0 ? `・保存待ち ${pendingCount}件` : ''}`;
      tone = 'warn';
      break;
    case 'unauthorized':
      label = '鍵が無効です';
      tone = 'bad';
      break;
    case 'corrupt':
      label = 'データファイルを読み込めません（管理者に連絡）';
      tone = 'bad';
      break;
    default:
      label = null;
  }
  return (
    <div className="status">
      {mode === 'local' && <span className="badge badge-demo">お試しモード</span>}
      {label && <span className={`badge badge-${tone}`}>{label}</span>}
      <span className="status-time">最終更新 {lastSyncAt ? hhmm(lastSyncAt) : '--:--'}</span>
    </div>
  );
}
