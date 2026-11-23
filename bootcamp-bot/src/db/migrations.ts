// 순서대로 한 번씩만 적용되는 마이그레이션. 이미 배포된 항목은 수정하지 말고 새 항목을 뒤에 추가한다.
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
      CREATE TABLE cohorts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        ops_channel_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cohort_id INTEGER NOT NULL REFERENCES cohorts(id),
        name TEXT NOT NULL,
        github_login TEXT NOT NULL,
        slack_user_id TEXT,
        role TEXT NOT NULL DEFAULT 'student',
        UNIQUE (cohort_id, github_login)
      );

      CREATE TABLE modules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cohort_id INTEGER NOT NULL REFERENCES cohorts(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned',
        default_settings TEXT NOT NULL DEFAULT '{}',
        common_channel_id TEXT,
        UNIQUE (cohort_id, code)
      );

      CREATE TABLE teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id INTEGER NOT NULL REFERENCES modules(id),
        name TEXT NOT NULL,
        slack_channel_id TEXT NOT NULL,
        lead_member_id INTEGER REFERENCES members(id),
        delegate_member_id INTEGER REFERENCES members(id),
        status TEXT NOT NULL DEFAULT 'active',
        UNIQUE (module_id, name)
      );

      CREATE TABLE team_members (
        team_id INTEGER NOT NULL REFERENCES teams(id),
        member_id INTEGER NOT NULL REFERENCES members(id),
        PRIMARY KEY (team_id, member_id)
      );

      CREATE TABLE installations (
        installation_id INTEGER PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id),
        github_org_login TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE team_settings (
        team_id INTEGER PRIMARY KEY REFERENCES teams(id),
        settings TEXT NOT NULL DEFAULT '{}',
        updated_by INTEGER REFERENCES members(id),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE settings_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL REFERENCES teams(id),
        changed_by INTEGER REFERENCES members(id),
        diff TEXT NOT NULL,
        changed_at INTEGER NOT NULL
      );

      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        delivery_id TEXT NOT NULL UNIQUE,
        installation_id INTEGER,
        type TEXT NOT NULL,
        action TEXT,
        repo TEXT,
        pr_number INTEGER,
        actor_login TEXT,
        slack_thread_ts TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        run_after INTEGER NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX jobs_pending ON jobs (status, run_after);

      -- 직접 push 판별용: PR 머지로 생긴 커밋 기록
      CREATE TABLE merged_prs (
        installation_id INTEGER NOT NULL,
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        merge_commit_sha TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        merged_at INTEGER NOT NULL,
        PRIMARY KEY (installation_id, repo, pr_number)
      );
      CREATE INDEX merged_prs_sha ON merged_prs (repo, merge_commit_sha);

      -- 미등록 설치는 운영진 채널에 한 번만 보고
      CREATE TABLE unknown_reports (
        installation_id INTEGER PRIMARY KEY,
        reported_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: 'poll_mode',
    sql: `
      -- 폴링 모드: 감시 브랜치의 마지막으로 본 커밋
      CREATE TABLE branch_heads (
        installation_id INTEGER NOT NULL,
        repo TEXT NOT NULL,
        branch TEXT NOT NULL,
        sha TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (installation_id, repo, branch)
      );
      -- 폴링 모드: 리포별 첫 실행(기준선) 여부
      CREATE TABLE poll_baselines (
        installation_id INTEGER NOT NULL,
        repo TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (installation_id, repo)
      );
    `,
  },
];
