import fs from 'node:fs';
import path from 'node:path';
import type { Ctx, Logger } from '../src/core/context.js';
import type { GitHubApi, Review, SlackMessage } from '../src/core/ports.js';
import { seedPilot, type PilotData } from '../src/core/seed.js';
import { openDb, Repo } from '../src/db/repo.js';

export const OPS = 'COPS000001';
export const TEAM_CHANNEL = 'C0CL42NA29Y';
export const INSTALLATION = 1001;

export const pilot: PilotData = {
  team: { name: '뚝딱연구soo', slack_channel_id: TEAM_CHANNEL, github_org: 'tuktak-lab' },
  members: [
    { name: '박유수', github_login: 'yoosoo2217', slack_user_id: 'U0BHHS5NJ3V', is_lead: true },
    { name: '원병찬', github_login: 'wol20670', slack_user_id: 'U0BHR6MT9H7', is_lead: false },
    { name: '서수영', github_login: 'tjtndud2', slack_user_id: 'U0BLBRVNFJL', is_lead: false },
  ],
};

export function fixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
}

export class FakeGitHub implements GitHubApi {
  reviews: Review[] = [];
  pullsForSha: Record<string, number[]> = {};
  calls: string[] = [];
  async listReviews() {
    this.calls.push('listReviews');
    return this.reviews;
  }
  async commitPulls(_i: number, _o: string, _r: string, sha: string) {
    this.calls.push(`commitPulls:${sha}`);
    return this.pullsForSha[sha] ?? [];
  }
  async getInstallationAccount() {
    return { login: 'tuktak-lab' };
  }
}

export class FakeNotifier {
  posts: { channel: string; msg: SlackMessage }[] = [];
  async post(channel: string, msg: SlackMessage) {
    this.posts.push({ channel, msg });
  }
  to(channel: string) {
    return this.posts.filter((p) => p.channel === channel);
  }
}

const silent: Logger = { info: () => {}, error: () => {} };

/** 파일럿 팀이 등록되고 설치 1001이 연결된 상태의 테스트 컨텍스트 */
export function setup(opts: { link?: boolean } = {}) {
  const repo = new Repo(openDb(':memory:'));
  const { teamId } = seedPilot(repo, pilot, new Date('2026-11-23T00:00:00Z'));
  if (opts.link !== false) repo.linkInstallation(INSTALLATION, teamId, 'tuktak-lab');
  const github = new FakeGitHub();
  const notifier = new FakeNotifier();
  const ctx: Ctx = { repo, github, notifier, opsChannelId: OPS, log: silent };
  return { ctx, repo, github, notifier, teamId };
}

/** 대기 시간과 무관하게 모든 작업을 처리한다(지연 작업 포함) */
export async function drain(ctx: Ctx) {
  const { processJobs } = await import('../src/core/queue.js');
  ctx.repo.db.prepare(`UPDATE jobs SET run_after = 0 WHERE status = 'pending'`).run();
  while ((await processJobs(ctx)) > 0) {
    ctx.repo.db.prepare(`UPDATE jobs SET run_after = 0 WHERE status = 'pending'`).run();
  }
}
