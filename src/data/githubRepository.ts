import { FILE_KEYS, mergeById, type FileKey } from '../domain/ops';
import type { BoardData, Schedule } from '../domain/types';
import type { Registration } from './registration';
import {
  RepoError,
  emptyFile,
  fileFromBoard,
  toBoard,
  validateArchive,
  validateFile,
  type ArchiveFile,
  type FileMap,
  type FileState,
  type RateInfo,
  type Repository,
  type Snapshot,
} from './repository';

const API = 'https://api.github.com';
const MAX_ATTEMPTS = 5;

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

interface RawFile {
  text: string;
  sha: string;
  etag: string | null;
}

/** 非公開リポジトリの JSON ファイルを GitHub Contents API で読み書きする */
export class GitHubRepository implements Repository {
  readonly mode = 'github' as const;
  private rateInfo: RateInfo = { remaining: null, resetAt: null };
  private fetchImpl: typeof fetch;

  constructor(
    private reg: Registration,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private repoUrl(): string {
    return `${API}/repos/${encodeURIComponent(this.reg.owner)}/${encodeURIComponent(this.reg.repo)}`;
  }

  private contentsUrl(path: string): string {
    return `${this.repoUrl()}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async request(method: 'GET' | 'PUT', url: string, opts: { etag?: string | null; body?: unknown; accept?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.reg.token}`,
      Accept: opts.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (opts.etag) headers['If-None-Match'] = opts.etag;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store',
      });
    } catch {
      throw new RepoError('network', 'GitHub に接続できません');
    }

    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining !== null && reset !== null) {
      this.rateInfo = { remaining: Number(remaining), resetAt: Number(reset) * 1000 };
    }

    if (res.status === 401) throw new RepoError('unauthorized', '鍵が無効です');
    if (res.status === 429 || res.status === 403) {
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter !== null) throw new RepoError('rate-limited', '通信回数の制限中です', Date.now() + Number(retryAfter) * 1000);
      if (remaining === '0') throw new RepoError('rate-limited', '通信回数の制限中です', reset !== null ? Number(reset) * 1000 : Date.now() + 60000);
      if (res.status === 429) throw new RepoError('rate-limited', '通信回数の制限中です', Date.now() + 60000);
      throw new RepoError('unauthorized', '鍵の権限が不足しています');
    }
    if (res.status >= 500) throw new RepoError('network', `GitHub が一時的に応答できません（${res.status}）`);
    return res;
  }

  /** 200→内容、304→'same'、404→null */
  private async getRaw(path: string, etag?: string | null): Promise<RawFile | 'same' | null> {
    const url = `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.reg.branch)}`;
    const res = await this.request('GET', url, { etag });
    if (res.status === 304) return 'same';
    if (res.status === 404) return null;
    if (!res.ok) throw new RepoError('network', `読み込みに失敗しました（${res.status}）`);
    const json = (await res.json()) as { sha: string; encoding?: string; content?: string; size?: number };
    let text: string;
    if (json.encoding === 'base64' && (json.content || json.size === 0)) {
      text = decodeBase64(json.content ?? '');
    } else {
      // 1MB を超えるファイルは内容が省略されるため、raw 形式で取り直す
      const raw = await this.request('GET', url, { accept: 'application/vnd.github.raw+json' });
      if (!raw.ok) throw new RepoError('network', `読み込みに失敗しました（${raw.status}）`);
      text = await raw.text();
    }
    return { text, sha: json.sha, etag: res.headers.get('etag') };
  }

  private parse<K extends FileKey>(key: K, raw: RawFile): FileState<FileMap[K]> {
    let value: unknown;
    try {
      value = JSON.parse(raw.text);
    } catch {
      throw new RepoError('corrupt', `データファイル（${key}）を読み取れません`);
    }
    return { data: validateFile(key, value), version: raw.sha, etag: raw.etag };
  }

  private async getFile<K extends FileKey>(key: K, etag?: string | null): Promise<FileState<FileMap[K]> | 'same'> {
    const raw = await this.getRaw(`data/${key}.json`, etag);
    if (raw === 'same') return 'same';
    if (raw === null) return { data: emptyFile(key), version: null, etag: null };
    return this.parse(key, raw);
  }

  private async putRaw(path: string, text: string, sha: string | null, message: string): Promise<{ sha: string } | 'conflict'> {
    const body: Record<string, string> = { message, content: encodeBase64(text), branch: this.reg.branch };
    if (sha) body.sha = sha;
    const res = await this.request('PUT', this.contentsUrl(path), { body });
    if (res.status === 409 || res.status === 422) return 'conflict';
    if (res.status === 404) throw new RepoError('not-found', 'データ用リポジトリが見つかりません');
    if (!res.ok) throw new RepoError('network', `保存に失敗しました（${res.status}）`);
    const json = (await res.json()) as { content?: { sha?: string } };
    if (!json.content?.sha) throw new RepoError('network', '保存結果を確認できません');
    return { sha: json.content.sha };
  }

  /** 登録時の確認：鍵でリポジトリに届くか */
  async verify(): Promise<void> {
    const res = await this.request('GET', this.repoUrl());
    if (res.status === 404) throw new RepoError('not-found', 'データ用リポジトリが見つかりません（名前か鍵の対象を確認してください）');
    if (!res.ok) throw new RepoError('network', `確認に失敗しました（${res.status}）`);
  }

  async load(): Promise<Snapshot> {
    // 公式の推奨に従い、並列ではなく順番に取得する
    const master = (await this.getFile('master')) as FileState<FileMap['master']>;
    const schedules = (await this.getFile('schedules')) as FileState<FileMap['schedules']>;
    const notes = (await this.getFile('notes')) as FileState<FileMap['notes']>;
    return { master, schedules, notes };
  }

  async poll(prev: Snapshot): Promise<Snapshot | null> {
    let next: Snapshot | null = null;
    for (const key of FILE_KEYS) {
      const got = await this.getFile(key, prev[key].etag ?? null);
      if (got === 'same') continue;
      if (got.version === prev[key].version) {
        // 内容は同じで ETag だけ分かった場合：ETag を覚えるだけで「変更なし」
        prev[key].etag = got.etag;
        continue;
      }
      next = { ...(next ?? prev), [key]: got } as Snapshot;
    }
    return next;
  }

  async write(key: FileKey, prev: Snapshot, mutate: (data: BoardData) => BoardData, message: string): Promise<Snapshot> {
    let cur = prev;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const next = mutate(toBoard(cur));
      const content = fileFromBoard(key, next);
      const result = await this.putRaw(`data/${key}.json`, JSON.stringify(content, null, 1), cur[key].version, message);
      if (result !== 'conflict') {
        return { ...cur, [key]: { data: content, version: result.sha, etag: null } } as Snapshot;
      }
      // 他の端末が先に保存した：最新を読み直してやり直す（壊れていれば corrupt を投げ、上書きしない）
      const latest = await this.getFile(key);
      cur = { ...cur, [key]: latest } as Snapshot;
    }
    throw new RepoError('conflict', '他の端末の変更と重なり、保存できませんでした');
  }

  async loadArchive(year: string): Promise<Schedule[]> {
    const raw = await this.getRaw(`data/archive/schedules-${year}.json`);
    if (raw === null || raw === 'same') return [];
    try {
      return validateArchive(JSON.parse(raw.text));
    } catch (e) {
      if (e instanceof RepoError) throw e;
      throw new RepoError('corrupt', '過去の記録ファイルを読み取れません');
    }
  }

  async appendArchive(year: string, records: Schedule[], message: string): Promise<void> {
    const path = `data/archive/schedules-${year}.json`;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const raw = await this.getRaw(path);
      let existing: Schedule[] = [];
      let sha: string | null = null;
      if (raw !== null && raw !== 'same') {
        try {
          existing = validateArchive(JSON.parse(raw.text));
        } catch (e) {
          if (e instanceof RepoError) throw e;
          throw new RepoError('corrupt', '過去の記録ファイルを読み取れません');
        }
        sha = raw.sha;
      }
      const file: ArchiveFile = { version: 1, schedules: mergeById(existing, records) };
      const result = await this.putRaw(path, JSON.stringify(file, null, 1), sha, message);
      if (result !== 'conflict') return;
    }
    throw new RepoError('conflict', '過去の記録を保存できませんでした');
  }

  rate(): RateInfo {
    return this.rateInfo;
  }
}
