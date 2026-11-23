// 폴링 모드 통합 테스트: 가짜 GitHub·Slack 서버로 src/poll.ts를 두 번 실행한다.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const PORT = 4020;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-e2e-'));
const posts: { channel: string; text: string }[] = [];
let mainSha = 'aaa1';
let pulls: any[] = [];

const m = express();
m.use(express.urlencoded({ extended: true }));
m.use(express.json());
m.post('/slack/api/:method', (req, res) => {
  if (req.params.method === 'chat.postMessage') posts.push({ channel: req.body.channel, text: req.body.text });
  res.json({ ok: true, ts: '1' });
});
m.get('/github/app/installations', (_q, r) => r.json([{ id: 99, account: { login: 'tuktak-lab' } }]));
m.post('/github/app/installations/:id/access_tokens', (_q, r) => r.status(201).json({ token: 'ghs_x', expires_at: new Date(Date.now() + 3600e3).toISOString() }));
m.get('/github/installation/repositories', (_q, r) => r.json({ total_count: 1, repositories: [{ name: 'Keepsy', full_name: 'tuktak-lab/Keepsy', owner: { login: 'tuktak-lab' } }] }));
m.get('/github/repos/:o/:r/pulls', (_q, r) => r.json(pulls));
m.get('/github/repos/:o/:r/pulls/:n/reviews', (q, r) => r.json(q.params.n === '7' ? [{ id: 70, state: 'APPROVED', body: 'LGTM', html_url: 'u', submitted_at: new Date().toISOString(), user: { login: 'wol20670' } }] : []));
m.get('/github/repos/:o/:r/branches/:b', (q, r) => (q.params.b === 'main' ? r.json({ commit: { sha: mainSha } }) : r.status(404).json({ message: 'Not Found' })));
m.get('/github/repos/:o/:r/compare/:bh', (_q, r) => r.json({ status: 'ahead', html_url: 'https://github.com/c', commits: [{ sha: mainSha, html_url: 'h', commit: { message: 'hotfix', author: { name: 'x' } }, author: { login: 'tjtndud2' } }] }));
m.get('/github/repos/:o/:r/commits/:sha/pulls', (_q, r) => r.json([]));
const server = m.listen(PORT);

const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const env = {
  ...process.env,
  APP_ID: '1',
  APP_PRIVATE_KEY: Buffer.from(key).toString('base64'),
  SLACK_BOT_TOKEN: 'xoxb-x',
  OPS_CHANNEL_ID: 'COPS0001',
  PILOT_MEMBERS_JSON: fs.readFileSync(fs.existsSync('scripts/pilot-members.json') ? 'scripts/pilot-members.json' : 'scripts/pilot-members.example.json', 'utf8'),
  STATE_DIR: tmp,
  GITHUB_API_URL: `http://localhost:${PORT}/github`,
  SLACK_API_URL: `http://localhost:${PORT}/slack/api/`,
};
const tsx = path.join('node_modules', 'tsx', 'dist', 'cli.mjs');
const runPoll = () => new Promise<string>((resolve) => {
  setTimeout(() => {
    const r = spawnSync(process.execPath, [tsx, 'src/poll.ts'], { env, encoding: 'utf8' });
    resolve((r.stdout + r.stderr).trim());
  }, 0);
});

(async () => {
  // spawnSync가 이벤트 루프를 막으므로 가짜 서버는 별도 프로세스가 필요 — 대신 비동기 spawn 사용
  const { spawn } = await import('node:child_process');
  const run = () =>
    new Promise<string>((resolve) => {
      const p = spawn(process.execPath, [tsx, 'src/poll.ts'], { env });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', () => resolve(out.trim()));
    });
  void runPoll;

  console.log('1회차(기준선):', await run());
  const first = posts.length;
  pulls = [{ number: 7, title: '새 기능', html_url: 'https://github.com/tuktak-lab/Keepsy/pull/7', draft: false, user: { login: 'yoosoo2217' }, head: { ref: 'f' }, base: { ref: 'main' }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), merged_at: null, merge_commit_sha: null }];
  mainSha = 'bbb2';
  console.log('2회차(변화 있음):', await run());
  const texts = posts.slice(first).map((p) => p.text.split('\n')[0]);
  console.log('\n1회차 메시지:', posts.slice(0, first).map((p) => p.text.split('\n')[0]));
  console.log('2회차 메시지:', texts);
  const ok =
    first === 1 && posts[0].text.includes('클라우드') &&
    texts.some((t) => t.includes('새 PR')) && texts.some((t) => t.includes('PR 승인')) &&
    texts.some((t) => t.includes('main 갱신')) && texts.some((t) => t.includes('직접 push'));
  console.log(ok ? '\n✅ 폴링 통합 테스트 통과' : '\n❌ 실패');
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})();
