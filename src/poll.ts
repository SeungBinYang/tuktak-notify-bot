// 폴링 모드 진입점. GitHub Actions가 5분마다 실행한다: node --import tsx src/poll.ts
// 서버·터널·웹훅이 필요 없다. 상태(DB)는 STATE_DIR에 두고 Actions 캐시로 다음 실행에 넘긴다.
import './silence-sqlite-warning.js';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { readPrivateKey } from './config.js';
import { consoleLogger, type Ctx } from './core/context.js';
import { processJobs } from './core/queue.js';
import { reportOps } from './core/router.js';
import { pilotSchema, seedPilot } from './core/seed.js';
import { openDb, Repo } from './db/repo.js';
import { createGitHubApi } from './github/api.js';
import { createPollApi } from './poll/api.js';
import { pollOnce } from './poll/poller.js';
import { createNotifier } from './slack/notifier.js';

// Actions 시크릿 이름은 GITHUB_로 시작할 수 없어 APP_ 접두사를 쓴다(로컬 .env 이름도 함께 받는다)
const env = z
  .object({
    APP_ID: z.string().min(1),
    APP_PRIVATE_KEY: z.string().optional(),
    APP_PRIVATE_KEY_PATH: z.string().optional(),
    SLACK_BOT_TOKEN: z.string().startsWith('xoxb-', 'SLACK_BOT_TOKEN은 xoxb- 로 시작해야 해요'),
    OPS_CHANNEL_ID: z.string().regex(/^[CG][A-Z0-9]+$/, 'OPS_CHANNEL_ID는 C 또는 G로 시작하는 채널 ID여야 해요'),
    PILOT_MEMBERS_JSON: z.string().min(2, 'PILOT_MEMBERS_JSON(팀 정보)이 비어 있어요'),
    STATE_DIR: z.string().default('./state'),
    GITHUB_API_URL: z.string().url().optional(),
    SLACK_API_URL: z.string().url().optional(),
  })
  .parse({
    ...process.env,
    APP_ID: process.env.APP_ID ?? process.env.GITHUB_APP_ID,
    APP_PRIVATE_KEY: process.env.APP_PRIVATE_KEY ?? process.env.GITHUB_PRIVATE_KEY,
    APP_PRIVATE_KEY_PATH: process.env.APP_PRIVATE_KEY_PATH ?? process.env.GITHUB_PRIVATE_KEY_PATH,
    PILOT_MEMBERS_JSON:
      process.env.PILOT_MEMBERS_JSON ?? (fs.existsSync('scripts/pilot-members.json') ? fs.readFileSync('scripts/pilot-members.json', 'utf8') : undefined),
  });

async function main() {
  const log = consoleLogger;
  const privateKey = readPrivateKey(env.APP_PRIVATE_KEY, env.APP_PRIVATE_KEY_PATH);
  const team = pilotSchema.parse(JSON.parse(env.PILOT_MEMBERS_JSON));
  if (!team.team.github_org) throw new Error('팀 정보에 github_org(예: tuktak-lab)가 필요해요');

  fs.mkdirSync(env.STATE_DIR, { recursive: true });
  const dbFile = path.join(env.STATE_DIR, 'bot.db');
  const fresh = !fs.existsSync(dbFile);
  const errFile = path.join(env.STATE_DIR, 'last-error.txt');
  const db = openDb(dbFile);
  db.pragma('journal_mode = DELETE'); // 캐시로 넘길 파일을 하나로 유지
  const repo = new Repo(db);

  const notifier = createNotifier(env.SLACK_BOT_TOKEN, env.SLACK_API_URL);
  const ctx: Ctx = { repo, github: createGitHubApi(env.APP_ID, privateKey, env.GITHUB_API_URL), notifier, opsChannelId: env.OPS_CHANNEL_ID, log };
  const api = createPollApi(env.APP_ID, privateKey, env.GITHUB_API_URL);

  try {
    const { teamId } = seedPilot(repo, team);
    const installationId = await api.findInstallation(team.team.github_org);
    if (!installationId) {
      log.error(`GitHub App이 ${team.team.github_org} 조직에 설치돼 있지 않아요. 앱 설치 후 다음 실행부터 동작해요.`);
      return;
    }
    if (repo.getInstallation(installationId)?.teamId !== teamId || repo.getInstallation(installationId)?.status !== 'active') {
      repo.linkInstallation(installationId, teamId, team.team.github_org);
    }

    const result = await pollOnce(ctx, api, installationId);
    db.prepare(`UPDATE jobs SET run_after = 0 WHERE status = 'pending'`).run();
    while ((await processJobs(ctx)) > 0) {
      db.prepare(`UPDATE jobs SET run_after = 0 WHERE status = 'pending'`).run();
    }
    log.info(`확인 완료: 리포 ${result.repos}개, 새 알림 ${result.queued}건`);

    if (fresh) {
      await notifier.post(team.team.slack_channel_id, {
        text: `:cloud: 알림 봇이 클라우드(GitHub Actions)에서 동작을 시작했어요. 이제 *${team.team.github_org}* 조직의 리포를 약 5분마다 확인해서 알려드려요. 컴퓨터를 켜둘 필요가 없어요.`,
      });
    }
    fs.rmSync(errFile, { force: true });
  } catch (err) {
    log.error('폴링 실패', err);
    // 같은 오류가 5분마다 반복 보고되지 않도록, 오류 내용이 바뀔 때만 알린다
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 400);
    const prev = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : '';
    if (prev !== msg) await reportOps(ctx, `:x: 봇 확인 실패 — ${msg}\n(같은 오류는 다시 보고하지 않아요)`);
    fs.writeFileSync(errFile, msg);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
