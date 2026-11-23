import { useCallback, useEffect, useState } from 'react';

export type Route = '/board' | '/input' | '/admin' | '/register';
const ROUTES: Route[] = ['/board', '/input', '/admin', '/register'];

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0];
  return (ROUTES as string[]).includes(path) ? (path as Route) : '/board';
}

/** 画面の URL。ハッシュ以外（置き場所）だけを引き継ぎ、鍵などは一切含めない */
export function appUrl(path: Route, loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${loc.origin}${loc.pathname}#${path}`;
}

export function useRoute(): { path: Route; navigate: (p: Route) => void } {
  const [path, setPath] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setPath(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((p: Route) => {
    window.location.hash = p;
  }, []);
  return { path, navigate };
}
