import type { Repo, TeamRoute } from '../db/repo.js';
import type { GitHubApi, Notifier } from './ports.js';

export interface Logger {
  info(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

export const consoleLogger: Logger = {
  info: (m, e) => console.log(`[info] ${m}`, e ?? ''),
  error: (m, e) => console.error(`[error] ${m}`, e ?? ''),
};

export interface Ctx {
  repo: Repo;
  github: GitHubApi;
  notifier: Notifier;
  opsChannelId: string;
  log: Logger;
}

export type { TeamRoute };
