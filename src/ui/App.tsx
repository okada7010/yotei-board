import { useEffect, useState } from 'react';
import { GitHubRepository } from '../data/githubRepository';
import { LocalRepository } from '../data/localRepository';
import { deviceName, loadRegistration } from '../data/registration';
import { SyncStore } from '../data/store';
import { AdminPage } from './admin/AdminPage';
import { BoardProvider, useBoard } from './app/AppContext';
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
  const { status } = useBoard();
  if (status === 'unauthorized') return <RegisterPage invalidKey />;
  if (path === '/register') return <RegisterPage onBack={() => navigate('/board')} />;
  if (path === '/admin') return <AdminPage navigate={navigate} />;
  if (narrow) return <MobilePage navigate={navigate} />;
  if (path === '/input') return <InputPage navigate={navigate} />;
  return <BoardPage navigate={navigate} />;
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
      const four = new Date();
      four.setHours(4, 0, 0, 0);
      if (Date.now() >= four.getTime() && loadedAt < four.getTime() && store.getState().pendingCount === 0) {
        window.location.reload();
      }
    }, 60000);
    return () => clearInterval(id);
  }, [store]);

  return null;
}
