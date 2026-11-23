import type { Ctx } from '../core/context.js';
import { watchedBranches } from '../core/router.js';
import { ingestWebhook } from '../github/webhook.js';
import type { PollApi, PolledPull } from './api.js';

/** 리뷰를 다시 확인할 PR 범위: 최근 3일 안에 갱신된 PR */
const REVIEW_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 5분마다 한 번 실행. GitHub의 현재 상태를 읽어 웹훅과 같은 모양의 이벤트로 바꿔 넣는다.
 * 감지·알림 로직은 웹훅 모드와 똑같은 핸들러를 그대로 쓴다.
 * 같은 일은 deliveryId가 같아서 두 번 알리지 않는다. 리포를 처음 볼 때는 기존 내역을 조용히 기록만 한다(기준선).
 */
export async function pollOnce(ctx: Ctx, api: PollApi, installationId: number, now = Date.now()): Promise<{ repos: number; queued: number }> {
  const route = ctx.repo.findActiveRoute(installationId);
  if (!route) return { repos: 0, queued: 0 };
  const installation = { id: installationId };
  let queued = 0;
  const ingest = (deliveryId: string, event: string, body: any, silent: boolean) => {
    if (ingestWebhook(ctx.repo, deliveryId, event, body, { silent }) === 'queued' && !silent) queued++;
  };

  const repos = await api.listRepos(installationId);
  for (const r of repos) {
    const silent = !ctx.repo.hasBaseline(installationId, r.full_name);
    const repository = { name: r.name, full_name: r.full_name, owner: { login: r.owner, name: r.owner }, html_url: `https://github.com/${r.full_name}` };
    const base = { installation, repository };

    // 1) PR: 생성, 머지, 리뷰 (머지를 먼저 기록해야 직접 push 판별이 정확하다)
    const pulls = await api.listRecentPulls(installationId, r.owner, r.name);
    for (const pr of pulls) {
      const n = pr.number;
      if (!pr.draft) {
        ingest(`poll:pr-open:${r.full_name}#${n}`, 'pull_request', { ...base, action: 'opened', sender: pr.user, pull_request: { ...pr, draft: false } }, silent);
      }
      if (pr.merged_at) {
        const id = `poll:pr-merged:${r.full_name}#${n}`;
        if (!ctx.repo.hasEvent(id)) {
          const full: PolledPull = silent ? pr : await api.getPull(installationId, r.owner, r.name, n);
          ingest(id, 'pull_request', { ...base, action: 'closed', sender: full.merged_by, pull_request: { ...full, merged: true } }, silent);
        }
      }
      if (!silent && now - Date.parse(pr.updated_at) <= REVIEW_LOOKBACK_MS) {
        const reviews = await api.listReviews(installationId, r.owner, r.name, n);
        for (const rv of reviews) {
          const state = String(rv.state).toLowerCase();
          if (state !== 'approved' && state !== 'changes_requested') continue;
          ingest(`poll:review:${rv.id}`, 'pull_request_review', { ...base, action: 'submitted', sender: rv.user, review: { ...rv, state }, pull_request: pr }, false);
        }
      } else if (silent) {
        // 기준선: 이미 지난 리뷰는 기록만
        const reviews = now - Date.parse(pr.updated_at) <= REVIEW_LOOKBACK_MS ? await api.listReviews(installationId, r.owner, r.name, n) : [];
        for (const rv of reviews) ingest(`poll:review:${rv.id}`, 'pull_request_review', {}, true);
      }
    }

    // 2) 감시 브랜치: 마지막으로 본 커밋과 비교해 push·force push 판별
    for (const branch of watchedBranches(route)) {
      const sha = await api.branchSha(installationId, r.owner, r.name, branch);
      if (!sha) continue;
      const prev = ctx.repo.getBranchHead(installationId, r.full_name, branch);
      if (prev === sha) continue;
      if (prev) {
        const cmp = await api.compare(installationId, r.owner, r.name, prev, sha);
        const forced = cmp.status === 'diverged' || cmp.status === 'behind';
        const last = cmp.commits[cmp.commits.length - 1];
        const login = last?.authorLogin ?? null;
        ingest(
          `poll:push:${r.full_name}:${branch}:${sha}`,
          'push',
          {
            ...base,
            ref: `refs/heads/${branch}`,
            before: prev,
            after: sha,
            created: false,
            deleted: false,
            forced,
            compare: cmp.html_url,
            sender: { login, type: login?.endsWith('[bot]') ? 'Bot' : 'User' },
            pusher: { name: login },
            commits: cmp.commits.map((c) => ({ id: c.sha, message: c.message, url: c.html_url, author: { username: c.authorLogin, name: c.authorName } })),
          },
          silent,
        );
      }
      ctx.repo.setBranchHead(installationId, r.full_name, branch, sha);
    }

    if (silent) ctx.repo.markBaseline(installationId, r.full_name);
  }
  return { repos: repos.length, queued };
}
