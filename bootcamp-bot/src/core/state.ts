import crypto from 'node:crypto';

// 설치 링크의 state: "<teamId>.<만료epoch초>.<HMAC>" (base64url)
// 위조·재사용 방지를 위해 서명과 만료를 함께 넣는다.

const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;

export function signState(teamId: number, secret: string, nowMs = Date.now(), ttlSec = DEFAULT_TTL_SEC): string {
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const body = `${teamId}.${exp}`;
  return Buffer.from(`${body}.${hmac(body, secret)}`).toString('base64url');
}

export function verifyState(state: string, secret: string, nowMs = Date.now()): { teamId: number } | null {
  const raw = Buffer.from(state, 'base64url').toString('utf8');
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [teamStr, expStr, sig] = parts;
  const expected = hmac(`${teamStr}.${expStr}`, secret);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const teamId = Number(teamStr);
  const exp = Number(expStr);
  if (!Number.isInteger(teamId) || !Number.isFinite(exp)) return null;
  if (exp * 1000 < nowMs) return null;
  return { teamId };
}

function hmac(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

export function installUrl(appSlug: string, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(state)}`;
}
