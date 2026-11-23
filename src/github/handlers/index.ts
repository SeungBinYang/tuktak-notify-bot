import type { Ctx } from '../../core/context.js';
import { handleInstallation } from './installation.js';
import { handlePullRequest } from './pullRequest.js';
import { checkDirectPush, handlePush } from './push.js';
import { handlePullRequestReview } from './review.js';

export async function handleGithubEvent(ctx: Ctx, event: string, body: any): Promise<void> {
  switch (event) {
    case 'pull_request':
      return handlePullRequest(ctx, body);
    case 'pull_request_review':
      return handlePullRequestReview(ctx, body);
    case 'push':
      return handlePush(ctx, body);
    case 'installation':
      return handleInstallation(ctx, body);
    default:
      return; // 1단계에서 다루지 않는 이벤트
  }
}

export const JOB_HANDLERS: Record<string, (ctx: Ctx, payload: any) => Promise<void>> = {
  github_event: (ctx, p) => handleGithubEvent(ctx, p.event, p.body),
  check_direct_push: checkDirectPush,
};
