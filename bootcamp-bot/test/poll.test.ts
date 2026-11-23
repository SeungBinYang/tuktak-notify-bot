import { describe, expect, it } from 'vitest';
import type { CompareResult, PollApi, PolledPull, PolledReview } from '../src/poll/api.js';
import { pollOnce } from '../src/poll/poller.js';
import { drain, INSTALLATION, OPS, setup, TEAM_CHANNEL } from './helpers.js';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const pr = (n: number, extra: Partial<PolledPull> = {}): PolledPull => ({
  number: n,
  title: `PR ${n}`,
  html_url: `https://github.com/tuktak-lab/Keepsy/pull/${n}`,
  draft: false,
  user: { login: 'yoosoo2217' },
  head: { ref: `feature/${n}` },
  base: { ref: 'main' },
  created_at: '2026-11-23T11:00:00Z',
  updated_at: '2026-11-23T11:58:00Z',
  merged_at: null,
  merge_commit_sha: null,
  ...extra,
});

class FakePoll implements PollApi {
  pulls: PolledPull[] = [];
  reviews: Record<number, PolledReview[]> = {};
  heads: Record<string, string> = { main: 'm1' };
  cmp: CompareResult = { status: 'ahead', html_url: 'https://github.com/x/compare', commits: [] };
  async findInstallation() {
    return INSTALLATION;
  }
  async listRepos() {
    return [{ name: 'Keepsy', full_name: 'tuktak-lab/Keepsy', owner: 'tuktak-lab' }];
  }
  async listRecentPulls() {
    return this.pulls;
  }
  async getPull(_i: number, _o: string, _r: string, n: number) {
    return { ...this.pulls.find((p) => p.number === n)!, merged_by: { login: 'wol20670' } };
  }
  async listReviews(_i: number, _o: string, _r: string, n: number) {
    return this.reviews[n] ?? [];
  }
  async branchSha(_i: number, _o: string, _r: string, b: string) {
    return this.heads[b] ?? null;
  }
  async compare() {
    return this.cmp;
  }
}

async function run(ctx: any, api: FakePoll) {
  await pollOnce(ctx, api, INSTALLATION, NOW);
  await drain(ctx);
}

describe('폴링 모드', () => {
  it('첫 실행은 기존 PR·리뷰·브랜치를 조용히 기록만 한다', async () => {
    const { ctx, notifier } = setup();
    const api = new FakePoll();
    api.pulls = [pr(1), pr(2, { merged_at: '2026-11-20T00:00:00Z', merge_commit_sha: 'x' })];
    api.reviews[1] = [{ id: 10, state: 'APPROVED', body: '', html_url: 'u', submitted_at: '2026-11-23T11:00:00Z', user: { login: 'wol20670' } }];
    await run(ctx, api);
    expect(notifier.posts).toHaveLength(0);
    await run(ctx, api); // 변화 없으면 계속 조용
    expect(notifier.posts).toHaveLength(0);
  });

  it('새 PR, 리뷰 승인을 한 번씩만 알린다', async () => {
    const { ctx, notifier } = setup();
    const api = new FakePoll();
    await run(ctx, api); // 기준선
    api.pulls = [pr(3)];
    api.reviews[3] = [{ id: 30, state: 'APPROVED', body: 'LGTM', html_url: 'u', submitted_at: '2026-11-23T11:59:00Z', user: { login: 'wol20670' } }];
    await run(ctx, api);
    await run(ctx, api); // 같은 내용 다시 확인해도 중복 없음
    const texts = notifier.to(TEAM_CHANNEL).map((p) => p.msg.text);
    expect(texts.filter((t) => t.includes('새 PR'))).toHaveLength(1);
    expect(texts.filter((t) => t.includes('PR 승인'))).toHaveLength(1);
  });

  it('승인 없이 머지 + main 갱신이면 #3, #2를 알리고 직접 push로 보지 않는다', async () => {
    const { ctx, notifier } = setup();
    const api = new FakePoll();
    await run(ctx, api);
    api.pulls = [pr(4, { merged_at: '2026-11-23T11:59:00Z', merge_commit_sha: 'm2' })];
    api.heads.main = 'm2';
    api.cmp = { status: 'ahead', html_url: 'c', commits: [{ sha: 'm2', html_url: 'h', message: 'Merge pull request #4', authorLogin: 'wol20670', authorName: null }] };
    await run(ctx, api);
    const texts = notifier.to(TEAM_CHANNEL).map((p) => p.msg.text);
    expect(texts.some((t) => t.includes('승인 없이 머지됨'))).toBe(true);
    expect(texts.some((t) => t.includes('main 갱신'))).toBe(true);
    expect(texts.some((t) => t.includes('직접 push'))).toBe(false);
    expect(notifier.to(OPS).some((p) => p.msg.text.includes('승인 없이 머지됨'))).toBe(true);
  });

  it('PR 없이 main이 바뀌면 직접 push(#9)', async () => {
    const { ctx, notifier, github } = setup();
    const api = new FakePoll();
    await run(ctx, api);
    api.heads.main = 'd1';
    api.cmp = { status: 'ahead', html_url: 'c', commits: [{ sha: 'd1', html_url: 'h', message: '바로 수정', authorLogin: 'tjtndud2', authorName: null }] };
    await run(ctx, api);
    expect(github.calls).toContain('commitPulls:d1');
    expect(notifier.to(TEAM_CHANNEL).some((p) => p.msg.text.includes('직접 push'))).toBe(true);
  });

  it('기록이 갈라지면 force push(#10)', async () => {
    const { ctx, notifier } = setup();
    const api = new FakePoll();
    await run(ctx, api);
    api.heads.main = 'f1';
    api.cmp = { status: 'diverged', html_url: 'c', commits: [] };
    await run(ctx, api);
    expect(notifier.to(TEAM_CHANNEL).some((p) => p.msg.text.includes('force push'))).toBe(true);
    expect(notifier.to(OPS).some((p) => p.msg.text.includes('force push'))).toBe(true);
  });

  it('나중에 생긴 develop 브랜치는 기준만 잡고 다음 변화부터 알린다', async () => {
    const { ctx, notifier } = setup();
    const api = new FakePoll();
    await run(ctx, api);
    api.heads.develop = 'v1';
    await run(ctx, api);
    expect(notifier.posts).toHaveLength(0);
    api.heads.develop = 'v2';
    api.cmp = { status: 'ahead', html_url: 'c', commits: [{ sha: 'v2', html_url: 'h', message: 'feat', authorLogin: 'tjtndud2', authorName: null }] };
    await run(ctx, api);
    expect(notifier.to(TEAM_CHANNEL).some((p) => p.msg.text.includes('develop 갱신'))).toBe(true);
  });
});
