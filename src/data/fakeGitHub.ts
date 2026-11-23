/** テスト用：GitHub Contents API のふるまいを最小限まねる（本番コードからは使わない） */
export interface FakeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: { message?: string; content?: string; sha?: string; branch?: string } | null;
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export class FakeGitHub {
  files = new Map<string, { text: string; sha: string }>();
  calls: FakeCall[] = [];
  /** 次の応答を差し替える（先頭から消費）。path の部分一致で対象を絞れる */
  overrides: { match?: string; method?: string; status: number; headers?: Record<string, string>; body?: unknown }[] = [];
  remaining = 4990;
  repoExists = true;
  branches = ['main'];
  private seq = 0;

  constructor(private prefix = '/repos/acme/board-data') {}

  put(path: string, text: string): string {
    this.seq += 1;
    const sha = `sha${this.seq}`;
    this.files.set(path, { text, sha });
    return sha;
  }

  text(path: string): string | undefined {
    return this.files.get(path)?.text;
  }

  count(method: string, pathPart = ''): number {
    return this.calls.filter((c) => c.method === method && c.path.includes(pathPart)).length;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const body = init?.body ? (JSON.parse(String(init.body)) as FakeCall['body']) : null;
    const path = url.pathname;
    this.calls.push({ method, path, headers, body });

    const base = { 'x-ratelimit-remaining': String(this.remaining), 'x-ratelimit-reset': '1790000000' };
    const respond = (status: number, json?: unknown, extra: Record<string, string> = {}) =>
      new Response(status === 304 || status === 204 ? null : JSON.stringify(json ?? {}), { status, headers: { ...base, ...extra } });

    const oi = this.overrides.findIndex((o) => (!o.match || path.includes(o.match)) && (!o.method || o.method === method));
    if (oi >= 0) {
      const [o] = this.overrides.splice(oi, 1);
      return respond(o.status, o.body, o.headers);
    }
    if (headers.authorization !== 'Bearer good-token') return respond(401, { message: 'Bad credentials' });
    if (!this.repoExists || !path.startsWith(this.prefix)) return respond(404, { message: 'Not Found' });
    if (path === this.prefix) return respond(200, { full_name: 'acme/board-data' });
    if (path.startsWith(`${this.prefix}/branches/`)) {
      const name = decodeURIComponent(path.slice(`${this.prefix}/branches/`.length));
      return this.branches.includes(name) ? respond(200, { name }) : respond(404, { message: 'Branch not found' });
    }

    const filePath = decodeURIComponent(path.slice(`${this.prefix}/contents/`.length));
    const file = this.files.get(filePath);
    if (method === 'GET') {
      if (!file) return respond(404, { message: 'Not Found' });
      const etag = `"${file.sha}"`;
      if (headers['if-none-match'] === etag) return respond(304, undefined, { etag });
      return respond(200, { sha: file.sha, encoding: 'base64', content: b64encode(file.text), size: file.text.length }, { etag });
    }
    if (method === 'PUT') {
      if (file && body?.sha !== file.sha) return respond(409, { message: `${filePath} does not match ${body?.sha}` });
      if (!file && body?.sha) return respond(409, { message: 'sha given for new file' });
      const sha = this.put(filePath, b64decode(body?.content ?? ''));
      return respond(file ? 200 : 201, { content: { sha } });
    }
    return respond(405, { message: 'unsupported' });
  };
}
