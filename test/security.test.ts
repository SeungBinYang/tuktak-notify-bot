import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { installUrl, signState, verifyState } from '../src/core/state.js';
import { verifyGithubSignature } from '../src/github/verify.js';

const SECRET = 'state-secret-for-tests-0123456789';

describe('설치 링크 state', () => {
  it('서명한 팀 ID를 그대로 돌려준다', () => {
    expect(verifyState(signState(7, SECRET), SECRET)).toEqual({ teamId: 7 });
  });
  it('다른 시크릿으로 서명한 값은 거부한다', () => {
    expect(verifyState(signState(7, 'another-secret-0123456789'), SECRET)).toBeNull();
  });
  it('팀 ID를 바꿔치기하면 거부한다', () => {
    const raw = Buffer.from(signState(7, SECRET), 'base64url').toString();
    const forged = Buffer.from(raw.replace(/^7\./, '8.')).toString('base64url');
    expect(verifyState(forged, SECRET)).toBeNull();
  });
  it('만료된 값은 거부한다', () => {
    const old = signState(7, SECRET, Date.now() - 8 * 86400_000);
    expect(verifyState(old, SECRET)).toBeNull();
  });
  it('엉터리 문자열은 거부한다', () => {
    expect(verifyState('garbage', SECRET)).toBeNull();
  });
  it('설치 URL에 앱 slug와 state가 들어간다', () => {
    expect(installUrl('bootcamp-notify-bot', 'abc')).toBe('https://github.com/apps/bootcamp-notify-bot/installations/new?state=abc');
  });
});

describe('GitHub 웹훅 서명', () => {
  const body = Buffer.from('{"hello":"world"}');
  const secret = 'webhook-secret-0123456789';
  const good = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

  it('올바른 서명은 통과', () => expect(verifyGithubSignature(body, good, secret)).toBe(true));
  it('본문이 바뀌면 실패', () => expect(verifyGithubSignature(Buffer.from('{"hello":"x"}'), good, secret)).toBe(false));
  it('헤더가 없으면 실패', () => expect(verifyGithubSignature(body, undefined, secret)).toBe(false));
  it('sha1 형식은 실패', () => expect(verifyGithubSignature(body, 'sha1=abc', secret)).toBe(false));
});
