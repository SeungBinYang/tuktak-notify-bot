import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.js';

/**
 * Node 내장 SQLite(node:sqlite) 얇은 래퍼.
 * 별도 네이티브 모듈 설치가 필요 없어 Windows·Docker 어디서든 그대로 동작한다.
 * better-sqlite3와 같은 모양(prepare/exec/transaction)으로 쓴다.
 */
export class DB {
  private readonly raw: DatabaseSync;
  private depth = 0;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
  }

  prepare(sql: string): StatementSync {
    return this.raw.prepare(sql);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  pragma(p: string): void {
    this.raw.exec(`PRAGMA ${p}`);
  }

  /** fn을 트랜잭션으로 감싼 함수를 돌려준다(중첩 시 savepoint). */
  transaction<T>(fn: () => T): () => T {
    return () => {
      const sp = `sp_${this.depth}`;
      this.raw.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const result = fn();
        this.depth--;
        this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        return result;
      } catch (err) {
        this.depth--;
        this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw err;
      }
    };
  }

  close(): void {
    this.raw.close();
  }
}

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DB(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: DB): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r: any) => r.id as number));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, Date.now());
    })();
    applied.push(m.id);
  }
  return applied;
}

export interface TeamRoute {
  teamId: number;
  teamName: string;
  channelId: string;
  orgLogin: string;
  settings: TeamSettings;
}

export interface TeamSettings {
  features?: Record<string, boolean>;
  watchedBranches?: string[];
}

export interface Job {
  id: number;
  type: string;
  payload: any;
  attempts: number;
}

/** 모든 SQL은 이 클래스에만 둔다. */
export class Repo {
  constructor(public readonly db: DB) {}

  // ---------- 라우팅 ----------
  findActiveRoute(installationId: number): TeamRoute | null {
    const row = this.db
      .prepare(
        `SELECT t.id AS teamId, t.name AS teamName, t.slack_channel_id AS channelId,
                i.github_org_login AS orgLogin, COALESCE(s.settings, '{}') AS settings
           FROM installations i
           JOIN teams t ON t.id = i.team_id
           JOIN modules m ON m.id = t.module_id
           LEFT JOIN team_settings s ON s.team_id = t.id
          WHERE i.installation_id = ? AND i.status = 'active'
            AND t.status = 'active' AND m.status = 'active'`,
      )
      .get(installationId) as any;
    if (!row) return null;
    return { ...row, settings: safeJson(row.settings) };
  }

  slackIdForGithub(teamId: number, login: string): string | null {
    const row = this.db
      .prepare(
        `SELECT mb.slack_user_id AS sid
           FROM members mb
           JOIN teams t ON t.id = ?
           JOIN modules m ON m.id = t.module_id
          WHERE mb.cohort_id = m.cohort_id AND lower(mb.github_login) = lower(?)`,
      )
      .get(teamId, login) as any;
    return row?.sid ?? null;
  }

  markUnknownReported(installationId: number): boolean {
    const r = this.db
      .prepare('INSERT OR IGNORE INTO unknown_reports (installation_id, reported_at) VALUES (?, ?)')
      .run(installationId, Date.now());
    return r.changes === 1;
  }

  // ---------- 팀·설치 ----------
  getTeam(teamId: number): { id: number; name: string; channelId: string; status: string } | null {
    return (this.db
      .prepare('SELECT id, name, slack_channel_id AS channelId, status FROM teams WHERE id = ?')
      .get(teamId) as any) ?? null;
  }

  linkInstallation(installationId: number, teamId: number, orgLogin: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE installations SET status = 'removed' WHERE team_id = ? AND installation_id != ? AND status = 'active'`)
        .run(teamId, installationId);
      this.db
        .prepare(
          `INSERT INTO installations (installation_id, team_id, github_org_login, installed_at, status)
           VALUES (?, ?, ?, ?, 'active')
           ON CONFLICT(installation_id) DO UPDATE SET team_id = excluded.team_id,
             github_org_login = excluded.github_org_login, status = 'active'`,
        )
        .run(installationId, teamId, orgLogin, Date.now());
      this.db.prepare('DELETE FROM unknown_reports WHERE installation_id = ?').run(installationId);
    })();
  }

  getInstallation(installationId: number): { teamId: number | null; orgLogin: string; status: string } | null {
    return (this.db
      .prepare('SELECT team_id AS teamId, github_org_login AS orgLogin, status FROM installations WHERE installation_id = ?')
      .get(installationId) as any) ?? null;
  }

  markInstallationRemoved(installationId: number): void {
    this.db.prepare(`UPDATE installations SET status = 'removed' WHERE installation_id = ?`).run(installationId);
  }

  // ---------- 이벤트·큐 ----------
  /** 이벤트 기록 + 처리 작업 적재. 이미 받은 delivery면 false. */
  recordEventAndEnqueue(e: {
    deliveryId: string;
    installationId: number | null;
    type: string;
    action: string | null;
    repo: string | null;
    prNumber: number | null;
    actor: string | null;
    jobPayload: unknown;
    /** true면 기록만 하고 알림 작업은 만들지 않는다(폴링 첫 실행 기준선용) */
    silent?: boolean;
  }): boolean {
    return this.db.transaction(() => {
      const r = this.db
        .prepare(
          `INSERT OR IGNORE INTO events (delivery_id, installation_id, type, action, repo, pr_number, actor_login, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(e.deliveryId, e.installationId, e.type, e.action, e.repo, e.prNumber, e.actor, Date.now());
      if (r.changes === 0) return false;
      if (!e.silent) this.enqueue('github_event', e.jobPayload);
      return true;
    })();
  }

  enqueue(type: string, payload: unknown, delayMs = 0): number {
    const now = Date.now();
    const r = this.db
      .prepare('INSERT INTO jobs (type, payload, status, run_after, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(type, JSON.stringify(payload), 'pending', now + delayMs, now);
    return Number(r.lastInsertRowid);
  }

  claimJobs(limit: number, now = Date.now()): Job[] {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare(`SELECT id, type, payload, attempts FROM jobs WHERE status = 'pending' AND run_after <= ? ORDER BY run_after, id LIMIT ?`)
        .all(now, limit) as any[];
      const mark = this.db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?`);
      for (const r of rows) mark.run(r.id);
      return rows.map((r) => ({ id: r.id, type: r.type, payload: safeJson(r.payload), attempts: r.attempts + 1 }));
    })();
  }

  completeJob(id: number): void {
    // 원본 페이로드는 커서 완료 후 비운다
    this.db.prepare(`UPDATE jobs SET status = 'done', payload = NULL WHERE id = ?`).run(id);
  }

  retryJob(id: number, error: string, delayMs: number): void {
    this.db
      .prepare(`UPDATE jobs SET status = 'pending', last_error = ?, run_after = ? WHERE id = ?`)
      .run(error.slice(0, 2000), Date.now() + delayMs, id);
  }

  failJob(id: number, error: string): void {
    this.db.prepare(`UPDATE jobs SET status = 'failed', last_error = ? WHERE id = ?`).run(error.slice(0, 2000), id);
  }

  /** 서버가 처리 도중 죽어 running으로 남은 작업을 되살린다. */
  resetStuckJobs(): number {
    return Number(this.db.prepare(`UPDATE jobs SET status = 'pending' WHERE status = 'running'`).run().changes);
  }

  pendingJobCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending'`).get() as any).n;
  }

  // ---------- 폴링 상태 ----------
  hasEvent(deliveryId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM events WHERE delivery_id = ?').get(deliveryId);
  }

  getBranchHead(installationId: number, repo: string, branch: string): string | null {
    const row = this.db
      .prepare('SELECT sha FROM branch_heads WHERE installation_id = ? AND repo = ? AND branch = ?')
      .get(installationId, repo, branch) as any;
    return row?.sha ?? null;
  }

  setBranchHead(installationId: number, repo: string, branch: string, sha: string): void {
    this.db
      .prepare(
        `INSERT INTO branch_heads (installation_id, repo, branch, sha, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(installation_id, repo, branch) DO UPDATE SET sha = excluded.sha, updated_at = excluded.updated_at`,
      )
      .run(installationId, repo, branch, sha, Date.now());
  }

  hasBaseline(installationId: number, repo: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM poll_baselines WHERE installation_id = ? AND repo = ?').get(installationId, repo);
  }

  markBaseline(installationId: number, repo: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO poll_baselines (installation_id, repo, created_at) VALUES (?, ?, ?)')
      .run(installationId, repo, Date.now());
  }

  /** org 이름으로 활성 팀을 찾는다(폴링 모드 연결용) */
  findTeamIdByName(name: string): number | null {
    const row = this.db
      .prepare(`SELECT t.id FROM teams t JOIN modules m ON m.id = t.module_id WHERE t.name = ? AND t.status = 'active' AND m.status = 'active'`)
      .get(name) as any;
    return row?.id ?? null;
  }

  // ---------- 머지 기록 ----------
  recordMergedPr(p: { installationId: number; repo: string; prNumber: number; sha: string; baseRef: string }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO merged_prs (installation_id, repo, pr_number, merge_commit_sha, base_ref, merged_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(p.installationId, p.repo, p.prNumber, p.sha, p.baseRef, Date.now());
  }

  findMergedPrBySha(repo: string, sha: string): number | null {
    const row = this.db.prepare('SELECT pr_number AS n FROM merged_prs WHERE repo = ? AND merge_commit_sha = ?').get(repo, sha) as any;
    return row?.n ?? null;
  }
}

function safeJson(s: string | null): any {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
