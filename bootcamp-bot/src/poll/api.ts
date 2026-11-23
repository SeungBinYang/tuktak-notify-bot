import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';

// 폴링 모드에서 쓰는 GitHub 조회. 모두 App installation token으로 호출한다(개인 토큰 없음).

export interface PolledPull {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  user: { login: string } | null;
  head: { ref: string };
  base: { ref: string };
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  merged_by?: { login: string } | null;
}

export interface PolledReview {
  id: number;
  state: string;
  body: string | null;
  html_url: string;
  submitted_at: string | null;
  user: { login: string } | null;
}

export interface CompareResult {
  status: 'ahead' | 'behind' | 'diverged' | 'identical';
  html_url: string;
  commits: { sha: string; html_url: string; message: string; authorLogin: string | null; authorName: string | null }[];
}

export interface PollApi {
  findInstallation(orgLogin: string): Promise<number | null>;
  listRepos(installationId: number): Promise<{ name: string; full_name: string; owner: string }[]>;
  listRecentPulls(installationId: number, owner: string, repo: string): Promise<PolledPull[]>;
  getPull(installationId: number, owner: string, repo: string, n: number): Promise<PolledPull>;
  listReviews(installationId: number, owner: string, repo: string, n: number): Promise<PolledReview[]>;
  branchSha(installationId: number, owner: string, repo: string, branch: string): Promise<string | null>;
  compare(installationId: number, owner: string, repo: string, base: string, head: string): Promise<CompareResult>;
}

export function createPollApi(appId: string, privateKey: string, baseUrl?: string): PollApi {
  const app = new App({ appId, privateKey, ...(baseUrl ? { Octokit: Octokit.defaults({ baseUrl }) } : {}) });
  const inst = (id: number) => app.getInstallationOctokit(id);

  return {
    async findInstallation(orgLogin) {
      const res = await app.octokit.request('GET /app/installations', { per_page: 100 });
      const hit = (res.data as any[]).find((i) => i.account?.login?.toLowerCase() === orgLogin.toLowerCase());
      return hit ? (hit.id as number) : null;
    },
    async listRepos(id) {
      const o = await inst(id);
      const res = await o.request('GET /installation/repositories', { per_page: 100 });
      return (res.data as any).repositories.map((r: any) => ({ name: r.name, full_name: r.full_name, owner: r.owner.login }));
    },
    async listRecentPulls(id, owner, repo) {
      const o = await inst(id);
      const res = await o.request('GET /repos/{owner}/{repo}/pulls', { owner, repo, state: 'all', sort: 'updated', direction: 'desc', per_page: 30 });
      return res.data as any;
    },
    async getPull(id, owner, repo, n) {
      const o = await inst(id);
      const res = await o.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo, pull_number: n });
      return res.data as any;
    },
    async listReviews(id, owner, repo, n) {
      const o = await inst(id);
      const res = await o.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', { owner, repo, pull_number: n, per_page: 100 });
      return res.data as any;
    },
    async branchSha(id, owner, repo, branch) {
      const o = await inst(id);
      try {
        const res = await o.request('GET /repos/{owner}/{repo}/branches/{branch}', { owner, repo, branch });
        return (res.data as any).commit.sha;
      } catch (err: any) {
        if (err?.status === 404) return null;
        throw err;
      }
    },
    async compare(id, owner, repo, base, head) {
      const o = await inst(id);
      const res = await o.request('GET /repos/{owner}/{repo}/compare/{basehead}', { owner, repo, basehead: `${base}...${head}` });
      const d: any = res.data;
      return {
        status: d.status,
        html_url: d.html_url,
        commits: (d.commits ?? []).map((c: any) => ({
          sha: c.sha,
          html_url: c.html_url,
          message: c.commit?.message ?? '',
          authorLogin: c.author?.login ?? null,
          authorName: c.commit?.author?.name ?? null,
        })),
      };
    },
  };
}
