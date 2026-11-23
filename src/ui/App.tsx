import { Component, useEffect, useState, type ReactNode } from 'react';
import { GitHubRepository } from '../data/githubRepository';
import { LocalRepository } from '../data/localRepository';
import { deviceName, loadRegistration } from '../data/registration';
import { SyncStore } from '../data/store';
import { AdminPage } from './admin/AdminPage';
import { BoardProvider, useBoard } from './app/AppContext';
import { shouldAutoReload } from './app/autoReload';
import { BoardPage } from './board/BoardPage';
import { InputPage } from './input/InputPage';
import { MobilePage } from './mobile/MobilePage';
import { DEMO_KEY, RegisterPage } from './RegisterPage';
import { useRoute } from './router';

const NARROW = '(max-width: 819px)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

interface Session {
  store: SyncStore;
  device: string;
}

/** 登録（またはお試しモード）があれば、保存先につないだ SyncStore を作る */
function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const reg = loadRegistration();
    const demo = localStorage.getItem(DEMO_KEY) === '1';
    if (!reg && !demo) return;
    const repo = reg ? new GitHubRepository(reg) : new LocalRepository();
    const device = deviceName() || (reg ? '名前なしの端末' : 'お試し端末');
    const store = new SyncStore(repo, device);
    setSession({ store, device });
    void store.start();
    return () => {
      store.stop();
      setSession(null);
    };
  }, []);
  return session;
}

/** 想定外のエラーで画面が真っ白になるのを防ぐ */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page register">
        <div className="card">
          <h1>行動予定ボード</h1>
          <p className="form-error">画面を表示できませんでした。</p>
          <p className="hint">読み込み直しても直らない場合は、管理担当者に連絡してください。</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            読み込み直す
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  const hasConfig = loadRegistration() !== null || localStorage.getItem(DEMO_KEY) === '1';
  const session = useSession();
  if (!hasConfig) return <RegisterPage />;
  if (!session) return <div className="page loading">読み込み中…</div>;
  return (
    <BoardProvider store={session.store} device={session.device}>
      <Housekeeping />
      <Pages />
    </BoardProvider>
  );
}

function Pages() {
  const { path, navigate } = useRoute();
  const narrow = useNarrow();
  const { status, store, pendingCount } = useBoard();
  if (status === 'unauthorized') {
    // 鍵を登録し直しても、保存待ちの操作は捨てずに新しい接続で保存する
    return <RegisterPage invalidKey pendingCount={pendingCount} onRegistered={(reg) => store.reconnect(new GitHubRepository(reg))} />;
  }
  if (path === '/register') return <RegisterPage onBack={() => navigate('/board')} />;
  let page: ReactNode;
  if (path === '/admin') page = <AdminPage navigate={navigate} />;
  else if (narrow) page = <MobilePage navigate={navigate} />;
  else if (path === '/input') page = <InputPage navigate={navigate} />;
  else page = <BoardPage navigate={navigate} />;
  return (
    <>
      <ReadOnlyBanner />
      {page}
    </>
  );
}

/** データを読み込めていない間は編集できないことを、全画面で知らせる */
function ReadOnlyBanner() {
  const { readOnly, status } = useBoard();
  if (!readOnly || status === 'loading') return null;
  const text =
    status === 'corrupt'
      ? 'データファイルを読み込めないため、編集できません。管理担当者に連絡してください。'
      : 'データを読み込めていません。通信が戻るまで編集できません。';
  return (
    <div className="ro-banner" role="alert">
      {text}
    </div>
  );
}

/** 画面の表示状態の連携、閉じる前の警告、毎朝の自動読み直し */
function Housekeeping() {
  const { store, pendingCount } = useBoard();

  useEffect(() => {
    const onVisible = () => {
      const visible = document.visibilityState === 'visible';
      if (!visible) void store.flush();
      store.setVisible(visible);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [store]);

  useEffect(() => {
    if (pendingCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);

  // 常時表示の端末が新しい版を取り込めるよう、毎朝4時を過ぎたら1回だけ読み直す
  useEffect(() => {
    const loadedAt = Date.now();
    const id = setInterval(() => {
      const s = store.getState();
      if (shouldAutoReload({ now: Date.now(), loadedAt, online: navigator.onLine, status: s.status, pendingCount: s.pendingCount, lastSyncAt: s.lastSyncAt })) {
        window.location.reload();
      }
    }, 60000);
    return () => clearInterval(id);
  }, [store]);

  return null;
}
