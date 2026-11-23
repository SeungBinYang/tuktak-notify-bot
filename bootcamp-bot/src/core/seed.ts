import { z } from 'zod';
import type { Repo } from '../db/repo.js';
import { escape } from './router.js';

export const pilotSchema = z.object({
  team: z.object({
    name: z.string().min(1),
    slack_channel_id: z.string().regex(/^[CG][A-Z0-9]+$/),
    github_org: z.string().optional(),
  }),
  members: z
    .array(
      z.object({
        name: z.string().min(1),
        github_login: z.string().min(1),
        slack_user_id: z.string().regex(/^[UW][A-Z0-9]+$/),
        is_lead: z.boolean().default(false),
      }),
    )
    .min(1),
});

export type PilotData = z.infer<typeof pilotSchema>;

/** 파일럿 기수·모듈·팀·팀원을 등록한다. 여러 번 실행해도 중복 생성하지 않고 갱신한다. */
export function seedPilot(repo: Repo, data: PilotData, today = new Date()): { teamId: number; memberCount: number } {
  const leads = data.members.filter((m) => m.is_lead);
  if (leads.length > 1) throw new Error('팀장(is_lead: true)은 한 명만 지정해 주세요');
  const db = repo.db;
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 28 * 86400_000).toISOString().slice(0, 10);

  return db.transaction(() => {
    db.prepare(`INSERT INTO cohorts (name, created_at) VALUES ('파일럿', ?) ON CONFLICT(name) DO NOTHING`).run(Date.now());
    const cohortId = (db.prepare(`SELECT id FROM cohorts WHERE name = '파일럿'`).get() as any).id as number;

    db.prepare(
      `INSERT INTO modules (cohort_id, code, name, start_date, end_date, status)
       VALUES (?, 'pilot', '파일럿 모듈', ?, ?, 'active')
       ON CONFLICT(cohort_id, code) DO UPDATE SET status = 'active'`,
    ).run(cohortId, start, end);
    const moduleId = (db.prepare(`SELECT id FROM modules WHERE cohort_id = ? AND code = 'pilot'`).get(cohortId) as any).id as number;

    db.prepare(
      `INSERT INTO teams (module_id, name, slack_channel_id, status) VALUES (?, ?, ?, 'active')
       ON CONFLICT(module_id, name) DO UPDATE SET slack_channel_id = excluded.slack_channel_id, status = 'active'`,
    ).run(moduleId, data.team.name, data.team.slack_channel_id);
    const teamId = (db.prepare(`SELECT id FROM teams WHERE module_id = ? AND name = ?`).get(moduleId, data.team.name) as any).id as number;

    const upsertMember = db.prepare(
      `INSERT INTO members (cohort_id, name, github_login, slack_user_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(cohort_id, github_login) DO UPDATE SET name = excluded.name, slack_user_id = excluded.slack_user_id`,
    );
    const findMember = db.prepare(`SELECT id FROM members WHERE cohort_id = ? AND github_login = ?`);
    db.prepare(`DELETE FROM team_members WHERE team_id = ?`).run(teamId);
    const addToTeam = db.prepare(`INSERT INTO team_members (team_id, member_id) VALUES (?, ?)`);

    let leadId: number | null = null;
    for (const m of data.members) {
      upsertMember.run(cohortId, m.name, m.github_login, m.slack_user_id);
      const id = (findMember.get(cohortId, m.github_login) as any).id as number;
      addToTeam.run(teamId, id);
      if (m.is_lead) leadId = id;
    }
    db.prepare(`UPDATE teams SET lead_member_id = ? WHERE id = ?`).run(leadId, teamId);
    db.prepare(`INSERT INTO team_settings (team_id, settings, updated_at) VALUES (?, '{}', ?) ON CONFLICT(team_id) DO NOTHING`).run(teamId, Date.now());
    return { teamId, memberCount: data.members.length };
  })();
}

export function welcomeMessage(data: PilotData, installLink: string) {
  const lead = data.members.find((m) => m.is_lead);
  const people = data.members.map((m) => `<@${m.slack_user_id}>${m.is_lead ? ' (팀장)' : ''}`).join(' ');
  const text =
    `:wave: *${escape(data.team.name)}* 팀 채널에 GitHub 알림 봇이 들어왔어요!\n` +
    `팀원: ${people}\n\n` +
    `*지금 할 일 (1분)*: ${data.team.github_org ? `\`${escape(data.team.github_org)}\` ` : ''}조직의 *owner*가 아래 버튼을 눌러 앱을 설치해 주세요. 설치 화면에서 *All repositories*를 선택하면 앞으로 만들 리포까지 자동으로 알림 대상이 돼요.`;
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      {
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'GitHub 연결하기' }, url: installLink, style: 'primary', action_id: 'install_github_app' }],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              `설치 화면에 보이는 쓰기 권한(Administration)은 브랜치 보호 규칙 적용에만 쓰여요. 코드에는 쓰기 권한이 없어요.` +
              (lead ? ` 팀장: <@${lead.slack_user_id}>` : ''),
          },
        ],
      },
    ],
  };
}
