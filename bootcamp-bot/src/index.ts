import './silence-sqlite-warning.js';
import 'dotenv/config';
import { loadConfig } from './config.js';
import { consoleLogger, type Ctx } from './core/context.js';
import { startWorker } from './core/queue.js';
import { reportOps } from './core/router.js';
import { openDb, Repo } from './db/repo.js';
import { createGitHubApi } from './github/api.js';
import { githubSetupRouter } from './github/setup.js';
import { githubWebhookRouter } from './github/webhook.js';
import { createSlack } from './slack/app.js';

async function main() {
  const config = loadConfig();
  const log = consoleLogger;
  const db = openDb(config.DATABASE_PATH);
  const repo = new Repo(db);

  const github = createGitHubApi(config.GITHUB_APP_ID, config.githubPrivateKey, config.GITHUB_API_URL);
  const slack = createSlack({ token: config.SLACK_BOT_TOKEN, signingSecret: config.SLACK_SIGNING_SECRET, log, apiUrl: config.SLACK_API_URL });

  const ctx: Ctx = { repo, github, notifier: slack.notifier, opsChannelId: config.OPS_CHANNEL_ID, log };

  const router = slack.receiver.router;
  router.get('/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true, pendingJobs: repo.pendingJobCount() });
    } catch (err) {
      res.status(500).json({ ok: false });
    }
  });
  router.use(githubWebhookRouter({ repo, secret: config.GITHUB_WEBHOOK_SECRET, log }));
  router.use(githubSetupRouter(ctx, config.STATE_SIGNING_SECRET));

  await slack.app.start(config.PORT);
  const stopWorker = startWorker(ctx);
  log.info(`봇 서버 시작: 포트 ${config.PORT}, 공개 주소 ${config.PUBLIC_BASE_URL}`);
  await reportOps(ctx, ':robot_face: 알림 봇이 시작됐어요.');

  const shutdown = async (signal: string) => {
    log.info(`${signal} 수신, 종료합니다`);
    stopWorker();
    try {
      await slack.app.stop();
    } finally {
      db.close();
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
