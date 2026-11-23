import { useCallback, useState } from 'react';
import { GitHubRepository } from '../data/githubRepository';
import {
  decodeRegistration,
  deviceName,
  encodeRegistration,
  isValidRegistration,
  saveRegistration,
  setDeviceName,
  type Registration,
} from '../data/registration';
import { RepoError } from '../data/repository';
import { QrScanner } from './common/QrScanner';

export const DEMO_KEY = 'yb.demo';

interface Props {
  /** 鍵が無効になって戻ってきたとき */
  invalidKey?: boolean;
  /** 登録済みの端末から開いたとき（戻れる） */
  onBack?: () => void;
  /** 画面を読み込み直さずに接続し直すとき（保存待ちの操作を残すため） */
  onRegistered?: (reg: Registration) => Promise<void> | void;
  /** 保存待ちの操作の数（鍵が無効になって戻ってきたとき） */
  pendingCount?: number;
}

/** 端末登録画面：登録コードと端末名を入れると、この端末でボードが見られるようになる */
export function RegisterPage({ invalidKey, onBack, onRegistered, pendingCount = 0 }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(deviceName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const register = async (raw: string) => {
    setError(null);
    let reg: Registration;
    try {
      reg = decodeRegistration(raw);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!name.trim()) {
      setError('端末名を入力してください（例：事務所パネル、自分のスマホ）');
      return;
    }
    setBusy(true);
    try {
      const repo = new GitHubRepository(reg);
      await repo.verify();
      await repo.load();
      saveRegistration(reg);
      setDeviceName(name);
      localStorage.removeItem(DEMO_KEY);
      if (onRegistered) {
        await onRegistered(reg);
        setBusy(false);
      } else {
        window.location.reload();
      }
    } catch (e) {
      const err = e instanceof RepoError ? e : null;
      if (err?.code === 'unauthorized') setError('この登録コードの鍵は使えません（期限切れ、または作り直されています）');
      else if (err?.code === 'not-found') setError(err.message);
      else if (err?.code === 'corrupt') setError('データファイルを読み込めません。管理者に連絡してください');
      else if (err?.code === 'rate-limited') setError('通信回数の制限中です。しばらくしてからやり直してください');
      else setError('GitHub に接続できません。通信環境を確認してください');
      setBusy(false);
    }
  };

  const onScan = useCallback((text: string) => {
    setScanning(false);
    setCode(text);
  }, []);

  const startDemo = () => {
    localStorage.setItem(DEMO_KEY, '1');
    if (!deviceName()) setDeviceName(name.trim() || 'お試し端末');
    window.location.reload();
  };

  return (
    <div className="page register">
      <div className="card">
        <h1>行動予定ボード</h1>
        <h2>この端末を登録</h2>
        {invalidKey && <p className="form-error">鍵が無効です。新しい登録コードを入力してください。</p>}
        {invalidKey && pendingCount > 0 && (
          <p className="hint">保存待ちの変更が {pendingCount}件あります。この画面を閉じずに登録し直すと、そのまま保存されます。</p>
        )}
        <p className="hint">管理者から受け取った登録コードを入力してください。登録は端末ごとに1回だけです。</p>

        <label className="field">
          <span>端末名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：事務所パネル、自分のスマホ" maxLength={30} />
        </label>

        <label className="field">
          <span>登録コード</span>
          <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={4} placeholder="YB1. で始まる文字列を貼り付け" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>

        {scanning ? (
          <QrScanner onResult={onScan} onCancel={() => setScanning(false)} />
        ) : (
          <button type="button" className="btn" onClick={() => setScanning(true)}>
            カメラで QR コードを読み取る
          </button>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="row-end">
          {onBack && (
            <button type="button" className="btn" onClick={onBack}>
              戻る
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !code.trim()} onClick={() => void register(code)}>
            {busy ? '確認中…' : '登録する'}
          </button>
        </div>

        <hr />
        <p className="hint">登録コードが無くても、架空のデータで画面と操作を試せます（この端末の中だけに保存されます）。</p>
        <button type="button" className="btn" onClick={startDemo}>
          お試しモードで開く
        </button>

        <CodeMaker />
      </div>
    </div>
  );
}

/** 管理者用：リポジトリ名と鍵から登録コードを作る（通信はしない） */
function CodeMaker() {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const make = () => {
    const reg = { owner: owner.trim(), repo: repo.trim(), branch: branch.trim(), token: token.trim() };
    if (!isValidRegistration(reg)) {
      setMade(null);
      setError('入力内容を確認してください（空欄や空白文字は使えません）');
      return;
    }
    setError(null);
    setMade(encodeRegistration(reg));
  };

  return (
    <details className="maker">
      <summary>登録コードを作る（管理者用）</summary>
      <p className="hint">データ用リポジトリと鍵（アクセストークン）から登録コードを作ります。入力内容はどこにも送信されません。</p>
      <label className="field">
        <span>アカウント名</span>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} autoCapitalize="off" spellCheck={false} />
      </label>
      <label className="field">
        <span>データ用リポジトリ名</span>
        <input value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="off" spellCheck={false} />
      </label>
      <label className="field">
        <span>ブランチ名</span>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} autoCapitalize="off" spellCheck={false} />
      </label>
      <label className="field">
        <span>鍵（アクセストークン）</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </label>
      <button type="button" className="btn" onClick={make}>
        登録コードを作る
      </button>
      {error && <p className="form-error">{error}</p>}
      {made && (
        <>
          <textarea className="code-out" readOnly rows={4} value={made} onFocus={(e) => e.target.select()} />
          <p className="hint">このコードは鍵そのものです。必要な人にだけ渡してください。上の「登録コード」欄に貼り付ければ、この端末も登録できます。</p>
        </>
      )}
    </details>
  );
}
