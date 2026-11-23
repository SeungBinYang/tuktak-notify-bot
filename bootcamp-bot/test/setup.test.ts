import { describe, expect, it } from 'vitest';
import { seedPilot } from '../src/core/seed.js';
import { signState } from '../src/core/state.js';
import { completeSetup } from '../src/github/setup.js';
import { OPS, pilot, setup, TEAM_CHANNEL } from './helpers.js';

const SECRET = 'state-secret-for-tests-0123456789';

describe('설치 연결(Setup URL)', () => {
  it('올바른 state면 팀과 조직을 연결하고 팀 채널에 알린다', async () => {
    const { ctx, repo, notifier, teamId } = setup({ link: false });
    const r = await completeSetup(ctx, { installationId: 2002, state: signState(teamId, SECRET), stateSecret: SECRET });
    expect(r.ok).toBe(true);
    expect(repo.findActiveRoute(2002)?.channelId).toBe(TEAM_CHANNEL);
    expect(notifier.to(TEAM_CHANNEL)[0].msg.text).toContain('연결 완료');
    expect(notifier.to(OPS)).toHaveLength(1);
  });

  it('다시 설치하면 이전 설치는 해제 처리된다', async () => {
    const { ctx, repo, teamId } = setup(); // 1001 연결된 상태
    await completeSetup(ctx, { installationId: 3003, state: signState(teamId, SECRET), stateSecret: SECRET });
    expect(repo.getInstallation(1001)?.status).toBe('removed');
    expect(repo.findActiveRoute(3003)).not.toBeNull();
  });

  it('위조된 state는 연결하지 않는다', async () => {
    const { ctx, repo } = setup({ link: false });
    const r = await completeSetup(ctx, { installationId: 2002, state: signState(1, 'wrong-secret-0123456789'), stateSecret: SECRET });
    expect(r.ok).toBe(false);
    expect(repo.findActiveRoute(2002)).toBeNull();
  });

  it('state 없이 들어온 새 설치는 연결하지 않고 운영진에 알린다', async () => {
    const { ctx, repo, notifier } = setup({ link: false });
    const r = await completeSetup(ctx, { installationId: 2002, state: null, stateSecret: SECRET });
    expect(r.ok).toBe(false);
    expect(repo.findActiveRoute(2002)).toBeNull();
    expect(notifier.to(OPS)).toHaveLength(1);
  });
});

describe('파일럿 시드', () => {
  it('여러 번 실행해도 중복 없이 갱신된다', () => {
    const { repo, teamId } = setup();
    const again = seedPilot(repo, { ...pilot, members: pilot.members.slice(0, 2) });
    expect(again.teamId).toBe(teamId);
    const n = (repo.db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(teamId) as any).n;
    expect(n).toBe(2);
    expect((repo.db.prepare('SELECT COUNT(*) AS n FROM teams').get() as any).n).toBe(1);
  });

  it('팀장이 두 명이면 거부한다', () => {
    const { repo } = setup();
    const bad = { ...pilot, members: pilot.members.map((m) => ({ ...m, is_lead: true })) };
    expect(() => seedPilot(repo, bad)).toThrow('한 명만');
  });
});
