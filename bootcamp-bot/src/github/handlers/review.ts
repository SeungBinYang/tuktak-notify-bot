import type { Ctx } from '../../core/context.js';
import { emit, escape, mention, resolveRoute } from '../../core/router.js';
import { section } from './pullRequest.js';

/** #5 리뷰 결과: 승인·변경 요청을 팀 채널에 알리고 작성자를 멘션한다. 단순 코멘트는 알리지 않는다. */
export async function handlePullRequestReview(ctx: Ctx, body: any): Promise<void> {
  if (body.action !== 'submitted') return;
  const review = body.review;
  const pr = body.pull_request;
  const repo = body.repository;
  if (!review || !pr || !repo) return;

  const state = String(review.state ?? '').toLowerCase();
  if (state !== 'approved' && state !== 'changes_requested') return;

  const route = await resolveRoute(ctx, body.installation?.id, `pull_request_review.${state}`);
  if (!route) return;

  const link = `<${pr.html_url}|#${pr.number} ${escape(pr.title ?? '')}>`;
  const reviewer = mention(ctx, route, review.user?.login);
  const author = mention(ctx, route, pr.user?.login);
  const flow = `\`${escape(pr.head?.ref ?? '?')}\` → \`${escape(pr.base?.ref ?? '?')}\``;
  const comment = String(review.body ?? '').trim();
  const quote = comment ? `\n> ${escape(comment.split('\n')[0].slice(0, 200))}${comment.length > 200 || comment.includes('\n') ? '…' : ''}` : '';
  const more = review.html_url ? ` · <${review.html_url}|리뷰 보기>` : '';

  const text =
    state === 'approved'
      ? `:white_check_mark: *PR 승인* ${link}\n${reviewer}님이 승인했어요 → 작성자 ${author} · ${flow}${more}${quote}`
      : `:memo: *변경 요청* ${link}\n${reviewer}님이 수정을 요청했어요 → 작성자 ${author} · ${flow}${more}${quote}`;
  await emit(ctx, 5, route, section(text));
}
