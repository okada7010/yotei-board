import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Op } from '../../domain/ops';
import type { StoreState, SyncStore } from '../../data/store';

interface Ctx {
  store: SyncStore;
  device: string;
}

const BoardContext = createContext<Ctx | null>(null);

export function BoardProvider({ store, device, children }: Ctx & { children: ReactNode }) {
  return <BoardContext.Provider value={{ store, device }}>{children}</BoardContext.Provider>;
}

export interface BoardApi extends StoreState {
  store: SyncStore;
  device: string;
  mode: 'local' | 'github';
  dispatch: (...ops: Op[]) => void;
}

export function useBoard(): BoardApi {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('BoardProvider の外では使えません');
  const state = useSyncExternalStore(ctx.store.subscribe, ctx.store.getState);
  return { ...state, store: ctx.store, device: ctx.device, mode: ctx.store.mode, dispatch: (...ops) => ctx.store.dispatch(...ops) };
}
