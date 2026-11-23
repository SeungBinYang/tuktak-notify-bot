import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import type { GitHubApi, Review } from '../core/ports.js';

/** GitHub App installation token으로만 호출한다(개인 토큰 사용 안 함). 토큰 발급·갱신은 라이브러리가 캐시와 함께 처리한다. */
export function createGitHubApi(appId: string, privateKey: string, baseUrl?: string): GitHubApi {
  const app = new App({ appId, privateKey, ...(baseUrl ? { Octokit: Octokit.defaults({ baseUrl }) } : {}) });

  return {
    async listReviews(installationId, owner, repo, prNumber): Promise<Review[]> {
      const octokit = await app.getInstallationOctokit(installationId);
      const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });
      return (res.data as any[]).map((r) => ({
        state: r.state,
        login: r.user?.login ?? null,
        submittedAt: r.submitted_at ?? null,
      }));
    },

    async commitPulls(installationId, owner, repo, sha) {
      const octokit = await app.getInstallationOctokit(installationId);
      const res = await octokit.request('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
        owner,
        repo,
        commit_sha: sha,
        per_page: 10,
      });
      return (res.data as any[]).map((p) => p.number as number);
    },

    async getInstallationAccount(installationId) {
      const res = await app.octokit.request('GET /app/installations/{installation_id}', { installation_id: installationId });
      const account: any = res.data.account;
      return { login: account?.login ?? account?.slug ?? `installation-${installationId}` };
    },
  };
}
