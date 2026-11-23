import { describe, expect, it } from 'vitest';
import { wasApproved } from '../src/github/handlers/pullRequest.js';
import { ingestWebhook } from '../src/github/webhook.js';
import { drain, fixture, OPS, setup, TEAM_CHANNEL } from './helpers.js';

let seq = 0;
const deliver = (repo: any, event: string, body: any) => ingestWebhook(repo, `d-${++seq}`, event, body);

describe('#1 PR 생성', () => {
  it('팀 채널에만 알리고, 작성자를 슬랙 멘션으로 바꾼다', async () => {
    const { ctx, repo, notifier } = setup();
    deliver(repo, 'pull_request', fixture('pull_request.opened'));
    await drain(ctx);
    expect(notifier.to(TEAM_CHANNEL)).toHaveLength(1);
    expect(notifier.to(OPS)).toHaveLength(0);
    const text = notifier.to(TEAM_CHANNEL)[0].msg.text;
    expect(text).toContain('<@U0BHHS5NJ3V>');
    expect(text).toContain('#12');
    expect(text).toContain('&lt;초안&gt;'); // mrkdwn 이스케이프
  });

  it('draft PR은 알리지 않고, ready_for_review가 되면 알린다', async () => {
    const { ctx, repo, notifier } = setup();
    const draft = fixture('pull_request.opened');
    draft.pull_request.draft = true;
    deliver(repo, 'pull_request', draft);
    await drain(ctx);
    expect(notifier.posts).toHaveLength(0);

    const ready = fixture('pull_request.opened');
    ready.action = 'ready_for_review';
    deliver(repo, 'pull_request', ready);
    await drain(ctx);
    expect(notifier.to(TEAM_CHANNEL)).toHaveLength(1);
  });

  it('팀장이 끈 기능은 보내지 않는다', async () => {
    const { ctx, repo, notifier, teamId } = setup();
    repo.db.prepare(`UPDATE team_settings SET settings = ? WHERE team_id = ?`).run(JSON.stringify({ features: { '1': false } }), teamId);
    deliver(repo, 'pull_request', fixture('pull_request.opened'));
    await drain(ctx);
    expect(notifier.posts).toHaveLength(0);
  });
});

describe('#3 승인 없는 머지', () => {
  it('승인 없이 main에 머지되면 팀 채널과 운영진 채널 모두에 알린다', async () => {
    const { ctx, repo, notifier, github } = setup();
    github.reviews = [{ state: 'COMMENTED', login: 'tjddnjs0316', submittedAt: '2026-11-23T09:00:00Z' }];
    deliver(repo, 'pull_request', fixture('pull_request.merged'));
    await drain(ctx);
    expect(notifier.to(TEAM_CHANNEL)).toHaveLength(1);
    expect(notifier.to(OPS)).toHaveLength(1);
    expect(notifier.to(TEAM_CHANNEL)[0].msg.text).toContain('승인 없이 머지됨');
    expect(notifier.to(OPS)[0].msg.text).toContain('[뚝딱연구soo]');
  });

  it('승인이 있으면 알리지 않는다', async () => {
    const { ctx, repo, notifier, github } = setup();
    github.reviews = [{ state: 'APPROVED', login: 'tjddnjs0316', submittedAt: '2026-11-23T09:00:00Z' }];
    deliver(repo, 'pull_request', fixture('pull_request.merged'));
    await drain(ctx);
    expect(notifier.posts).toHaveLength(0);
  });

  it('팀장이 #3을 꺼도 운영진 채널에는 간다', async () => {
    const { ctx, repo, notifier, teamId } = setup();
    repo.db.prepare(`UPDATE team_settings SET settings = ? WHERE team_id = ?`).run(JSON.stringify({ features: { '3': false } }), teamId);
    deliver(repo, 'pull_request', fixture('pull_request.merged'));
    await drain(ctx);
    expect(notifier.to(TEAM_CHANNEL)).toHaveLength(0);
    expect(notifier.to(OPS)).toHaveLength(1);
  });

  it('감시 브랜치가 아닌 곳으로의 머지는 무시한다', async () => {
    const { ctx, repo, notifier } = setup();
    const pr = fixture('pull_request.merged');
    pr.pull_request.base.ref = 'feature/x';
    deliver(repo, 'pull_request', pr);
    await drain(ctx);
    expect(notifier.posts).toHaveLength(0);
  });

  it('승인 판단: 리뷰어별 마지막 결정 기준', () => {
    const t = (h: number) => `2026-11-23T0${h}:00:00Z`;
    expect(wasApproved([{ state: 'APPROVED', login: 'a', submittedAt: t(1) }, { state: 'DISMISSED', login: 'a', submittedAt: t(2) }], t(3))).toBe(false);
    expect(wasApproved([{ state: 'CHANGES_REQUESTED', login: 'a', submittedAt: t(1) }, { state: 'APPROVED', login: 'a', submittedAt: t(2) }], t(3))).toBe(true);
    expect(wasApproved([{ state: 'APPROVED', login: 'a', submittedAt: t(1) }, { state: 'COMMENTED', login: 'a', submittedAt: t(2) }], t(3))).toBe(true);
    expect(wasApproved([{ state: 'APPROVED', login: 'a', submittedAt: t(5) }], t(3))).toBe(false); // 머지 후 승인
    expect(wasApproved([], t(3))).toBe(false);
  });
});

describe('#2 보호 브랜치 변동, #9 직접 push', () => {
  it('PR 머지로 생긴 push는 #2만 알리고 #9는 알리지 않는다', async () => {
    const { ctx, repo, notifier, github } = setup();
    github.reviews = [{ state: 'APPROVED', login: 'tjddnjs0316', submittedAt: '2026-11-23T09:00:00Z' }];
    deliver(repo, 'pull_request', fixture('pull_request.merged'));
    deliver(repo, 'push', fixture('push.main'));
    await drain(ctx);
    const team = notifier.to(TEAM_CHANNEL);
    expect(team).toHaveLength(1);
    expect(team[0].msg.text).toContain('main 갱신');
    expect(notifier.to(OPS)).toHaveLength(0);
    expect(github.calls.filter((c) => c.startsWith('commitPulls'))).toHaveLength(0); // 머지 기록으로 판별
  });

  it('PR 없이 올라온 커밋은 #9로 팀·운영진에 알린다', async () => {
    const { ctx, repo, notifier } = setup();
    const push = fixture('push.main');
    push.after = 'deadbeef00000000000000000000000000000000';
    push.commits[0].message = 'hotfix 직접 수정';
    deliver(repo, 'push', push);
    await drain(ctx);
    const team = notifier.to(TEAM_CHANNEL).map((p) => p.msg.text);
    expect(team.some((t) => t.includes('main 갱신'))).toBe(true);
    expect(team.some((t) => t.includes('직접 push'))).toBe(true);
    expect(notifier.to(OPS)).toHaveLength(1);
  });

  it('봇이 받지 못한 머지라도 GitHub API에 PR이 있으면 #9로 보지 않는다', async () => {
    const { ctx, repo, notifier, github } = setup();
    const push = fixture('push.main');
    push.after = 'cafe000000000000000000000000000000000000';
    github.pullsForSha[push.after] = [20];
    deliver(repo, 'push', push);
    await drain(ctx);
    expect(notifier.to(OPS)).toHaveLength(0);
  });

  it('감시하지 않는 브랜치 push는 무시한다', async () => {
    const { ctx, repo, notifier } = setup();
    const push = fixture('push.main');
    push.ref = 'refs/heads/feature/login';
    deliver(repo, 'push', push);
    await drain(ctx);
    expect(notifier.posts).toHaveLength(0);
  });

  it('브랜치 최초 생성과 삭제, 태그 push는 무시한다', async () => {
    const { ctx, repo, notifier } = setup();
    deliver(repo, 'push', { ...fixture('push.main'), created: true });
    deliver(repo, 'push', { ...fixture('push.main'), deleted: true });
    deliver(repo, 'push', { ...fixture('push.main'), ref: 'refs/tags/v1.0.0' });
    await drain(ctx);
    expect(notifier.posts).toHaveLength(0);
  });

  it('봇 계정의 push는 #2만 알리고 직접 push 검사는 하지 않는다', async () => {
    const { ctx, repo, notifier } = setup();
    const push = fixture('push.main');
    push.after = 'b0b0000000000000000000000000000000000000';
    push.sender = { login: 'github-actions[bot]', type: 'Bot' };
    deliver(repo, 'push', push);
    await drain(ctx);
    expect(notifier.to(TEAM_CHANNEL)).toHaveLength(1);
    expect(notifier.to(OPS)).toHaveLength(0);
  });

  it('팀이 감시 브랜치를 바꾸면 그 기준을 따른다', async () => {
    const { ctx, repo, notifier, teamId } = setup();
    repo.db.prepare(`UPDATE team_settings SET settings = ? WHERE team_id = ?`).run(JSON.stringify({ watchedBranches: ['main'] }), teamId);
    deliver(repo, 'push', { ...fixture('push.main'), ref: 'refs/heads/develop' });
    await drain(ctx);
    expect(notifier.posts).toHaveLength(0);
  });
});

describe('#10 force push', () => {
  it('팀·운영진에 알리고 #2·#9는 보내지 않는다', async () => {
    const { ctx, repo, notifier } = setup();
    deliver(repo, 'push', { ...fixture('push.main'), forced: true });
    await drain(ctx);
    expect(notifier.to(TEAM_CHANNEL)).toHaveLength(1);
    expect(notifier.to(TEAM_CHANNEL)[0].msg.text).toContain('force push');
    expect(notifier.to(OPS)).toHaveLength(1);
  });

  it('팀장이 꺼도 잠금 기능이라 팀 채널에도 간다', async () => {
    const { ctx, repo, notifier, teamId } = setup();
    repo.db.prepare(`UPDATE team_settings SET settings = ? WHERE team_id = ?`).run(JSON.stringify({ features: { '10': false } }), teamId);
    deliver(repo, 'push', { ...fixture('push.main'), forced: true });
    await drain(ctx);
    expect(notifier.to(TEAM_CHANNEL)).toHaveLength(1);
  });
});

describe('수신·라우팅', () => {
  it('같은 delivery를 두 번 받으면 한 번만 처리한다', async () => {
    const { ctx, repo, notifier } = setup();
    const body = fixture('pull_request.opened');
    expect(ingestWebhook(repo, 'same-id', 'pull_request', body)).toBe('queued');
    expect(ingestWebhook(repo, 'same-id', 'pull_request', body)).toBe('duplicate');
    await drain(ctx);
    expect(notifier.posts).toHaveLength(1);
  });

  it('ping은 무시한다', () => {
    const { repo } = setup();
    expect(ingestWebhook(repo, 'p-1', 'ping', { zen: 'hi' })).toBe('ignored');
  });

  it('미등록 설치 이벤트는 운영진에 한 번만 보고하고 팀에는 보내지 않는다', async () => {
    const { ctx, repo, notifier } = setup({ link: false });
    deliver(repo, 'pull_request', fixture('pull_request.opened'));
    deliver(repo, 'pull_request', fixture('pull_request.opened'));
    await drain(ctx);
    expect(notifier.to(TEAM_CHANNEL)).toHaveLength(0);
    expect(notifier.to(OPS)).toHaveLength(1);
    expect(notifier.to(OPS)[0].msg.text).toContain('미등록 조직 이벤트');
  });

  it('처리가 계속 실패하면 3회 시도 후 운영진에 보고한다', async () => {
    const { ctx, repo, notifier, github } = setup();
    github.listReviews = async () => {
      throw new Error('GitHub API 장애');
    };
    deliver(repo, 'pull_request', fixture('pull_request.merged'));
    await drain(ctx);
    const failed = repo.db.prepare(`SELECT status, attempts FROM jobs WHERE type = 'github_event'`).get() as any;
    expect(failed).toEqual({ status: 'failed', attempts: 3 });
    expect(notifier.to(OPS).some((p) => p.msg.text.includes('봇 처리 오류'))).toBe(true);
  });

  it('App 설치 해제 시 상태를 바꾸고 운영진에 알린다', async () => {
    const { ctx, repo, notifier } = setup();
    deliver(repo, 'installation', { action: 'deleted', installation: { id: 1001 } });
    await drain(ctx);
    expect(repo.getInstallation(1001)?.status).toBe('removed');
    expect(notifier.to(OPS)[0].msg.text).toContain('설치 해제');
  });
});

describe('#5 리뷰 결과', () => {
  const review = (state: string, body = '') => ({
    action: 'submitted',
    installation: { id: 1001 },
    repository: { name: 'Keepsy', full_name: 'tuktak-lab/Keepsy', owner: { login: 'tuktak-lab' } },
    review: { state, body, user: { login: 'wol20670' }, html_url: 'https://github.com/tuktak-lab/Keepsy/pull/12#pullrequestreview-1' },
    pull_request: { number: 12, title: '로그인 화면', html_url: 'https://github.com/tuktak-lab/Keepsy/pull/12', user: { login: 'yoosoo2217' }, head: { ref: 'feature/login' }, base: { ref: 'develop' } },
  });

  it('승인되면 팀 채널에 리뷰어와 작성자를 멘션해 알린다', async () => {
    const { ctx, repo, notifier } = setup();
    deliver(repo, 'pull_request_review', review('approved', 'LGTM! 깔끔하네요'));
    await drain(ctx);
    const posts = notifier.to(TEAM_CHANNEL);
    expect(posts).toHaveLength(1);
    expect(posts[0].msg.text).toContain('PR 승인');
    expect(posts[0].msg.text).toContain('<@U0BHR6MT9H7>'); // 리뷰어
    expect(posts[0].msg.text).toContain('<@U0BHHS5NJ3V>'); // 작성자
    expect(posts[0].msg.text).toContain('LGTM');
    expect(notifier.to(OPS)).toHaveLength(0);
  });

  it('변경 요청도 알린다', async () => {
    const { ctx, repo, notifier } = setup();
    deliver(repo, 'pull_request_review', review('changes_requested', '변수명 바꿔주세요'));
    await drain(ctx);
    expect(notifier.to(TEAM_CHANNEL)[0].msg.text).toContain('변경 요청');
  });

  it('단순 코멘트 리뷰는 알리지 않는다', async () => {
    const { ctx, repo, notifier } = setup();
    deliver(repo, 'pull_request_review', review('commented', '질문 하나요'));
    await drain(ctx);
    expect(notifier.posts).toHaveLength(0);
  });

  it('팀장이 끄면 보내지 않는다', async () => {
    const { ctx, repo, notifier, teamId } = setup();
    repo.db.prepare(`UPDATE team_settings SET settings = ? WHERE team_id = ?`).run(JSON.stringify({ features: { '5': false } }), teamId);
    deliver(repo, 'pull_request_review', review('approved'));
    await drain(ctx);
    expect(notifier.posts).toHaveLength(0);
  });
});
