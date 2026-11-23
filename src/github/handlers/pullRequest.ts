import type { Ctx } from '../../core/context.js';
import type { Review } from '../../core/ports.js';
import { emit, escape, mention, resolveRoute, watchedBranches } from '../../core/router.js';

/** #1 PR 생성, #3 승인 없는 머지 */
export async function handlePullRequest(ctx: Ctx, body: any): Promise<void> {
  const action: string = body.action;
  const pr = body.pull_request;
  const repo = body.repository;
  if (!pr || !repo) return;

  const relevant =
    (action === 'opened' && !pr.draft) || action === 'ready_for_review' || (action === 'closed' && pr.merged);
  if (!relevant) return;

  const route = await resolveRoute(ctx, body.installation?.id, `pull_request.${action}`);
  if (!route) return;

  const link = `<${pr.html_url}|#${pr.number} ${escape(pr.title ?? '')}>`;
  const flow = `\`${escape(pr.head?.ref ?? '?')}\` → \`${escape(pr.base?.ref ?? '?')}\``;

  if (action === 'opened' || action === 'ready_for_review') {
    const text = `:sparkles: *새 PR* ${link}\n${mention(ctx, route, pr.user?.login)} · ${flow} · ${escape(repo.name)}`;
    await emit(ctx, 1, route, section(text));
    return;
  }

  // 머지됨: 직접 push 판별(#9)을 위해 머지 커밋을 먼저 기록한다
  if (pr.merge_commit_sha) {
    ctx.repo.recordMergedPr({
      installationId: body.installation.id,
      repo: repo.full_name,
      prNumber: pr.number,
      sha: pr.merge_commit_sha,
      baseRef: pr.base.ref,
    });
  }

  if (!watchedBranches(route).includes(pr.base?.ref)) return;

  const reviews = await ctx.github.listReviews(body.installation.id, repo.owner.login, repo.name, pr.number);
  if (wasApproved(reviews, pr.merged_at)) return;

  const text =
    `:rotating_light: *승인 없이 머지됨* ${link}\n` +
    `머지: ${mention(ctx, route, pr.merged_by?.login)} · 작성: ${mention(ctx, route, pr.user?.login)} · ${flow}\n` +
    `리뷰 승인 기록이 없어요. 보호 브랜치에는 팀원 승인을 받은 뒤 머지해 주세요.`;
  await emit(ctx, 3, route, section(text));
}

/**
 * 리뷰어별 마지막 결정(APPROVED / CHANGES_REQUESTED / DISMISSED)을 보고,
 * 머지 시점 기준으로 승인이 하나라도 살아 있었는지 판단한다. COMMENTED는 결정으로 보지 않는다.
 */
export function wasApproved(reviews: Review[], mergedAt: string | null | undefined): boolean {
  const cutoff = mergedAt ? Date.parse(mergedAt) : Infinity;
  const latest = new Map<string, string>();
  const sorted = [...reviews].sort((a, b) => Date.parse(a.submittedAt ?? '0') - Date.parse(b.submittedAt ?? '0'));
  for (const r of sorted) {
    if (!r.login) continue;
    if (!['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) continue;
    if (r.submittedAt && Date.parse(r.submittedAt) > cutoff) continue;
    latest.set(r.login.toLowerCase(), r.state);
  }
  return [...latest.values()].includes('APPROVED');
}

export function section(text: string) {
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] };
}
