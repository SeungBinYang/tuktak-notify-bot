// 외부 시스템 경계. 테스트에서는 가짜 구현으로 바꿔 끼운다.

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

export interface Notifier {
  post(channel: string, msg: SlackMessage): Promise<void>;
}

export interface Review {
  state: string;
  login: string | null;
  submittedAt: string | null;
}

export interface GitHubApi {
  listReviews(installationId: number, owner: string, repo: string, prNumber: number): Promise<Review[]>;
  /** 커밋을 포함한 PR 번호 목록 */
  commitPulls(installationId: number, owner: string, repo: string, sha: string): Promise<number[]>;
  getInstallationAccount(installationId: number): Promise<{ login: string }>;
}
