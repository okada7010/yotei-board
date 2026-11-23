/** 端末に登録する情報。登録コード＝これを1つの文字列にまとめたもの */
export interface Registration {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

const PREFIX = 'YB1.';
const KEY_REG = 'yb.reg';
const KEY_DEVICE = 'yb.device';
const NAME = /^[A-Za-z0-9_.-]+$/;

function fail(): Error {
  return new Error('登録コードの形式が正しくありません');
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '==='.slice((padded.length + 3) % 4));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function isValidRegistration(r: Partial<Registration>): r is Registration {
  return (
    typeof r.owner === 'string' && NAME.test(r.owner) &&
    typeof r.repo === 'string' && NAME.test(r.repo) &&
    typeof r.branch === 'string' && r.branch.length > 0 && !/\s/.test(r.branch) &&
    typeof r.token === 'string' && r.token.length > 0 && !/\s/.test(r.token)
  );
}

export function encodeRegistration(r: Registration): string {
  return PREFIX + toBase64Url(JSON.stringify({ o: r.owner, r: r.repo, b: r.branch, t: r.token }));
}

export function decodeRegistration(code: string): Registration {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) throw fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(trimmed.slice(PREFIX.length)));
  } catch {
    throw fail();
  }
  if (typeof parsed !== 'object' || parsed === null) throw fail();
  const p = parsed as Record<string, unknown>;
  const reg = { owner: p.o, repo: p.r, branch: p.b, token: p.t } as Partial<Registration>;
  if (!isValidRegistration(reg)) throw fail();
  return reg;
}

export function loadRegistration(): Registration | null {
  try {
    const raw = localStorage.getItem(KEY_REG);
    return raw ? decodeRegistration(raw) : null;
  } catch {
    return null;
  }
}

export function saveRegistration(r: Registration | null): void {
  if (r === null) localStorage.removeItem(KEY_REG);
  else localStorage.setItem(KEY_REG, encodeRegistration(r));
}

export function deviceName(): string {
  return localStorage.getItem(KEY_DEVICE) ?? '';
}

export function setDeviceName(name: string): void {
  localStorage.setItem(KEY_DEVICE, name.trim());
}
