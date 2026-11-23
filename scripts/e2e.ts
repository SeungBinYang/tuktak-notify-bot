// 통합 테스트: 가짜 GitHub·Slack 서버를 띄우고, 빌드된 실제 봇 서버에 Keepsy 시나리오를 흘려보낸다.
// 실행: npm run test:e2e   (실제 GitHub·Slack에는 아무것도 보내지 않는다)
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const MOCK_PORT = 4010;
const BOT_PORT = 4011;
const INSTALLATION_ID = 777;
const TEAM_CHANNEL = 'C0CL42NA29Y';
const OPS_CHANNEL = 'COPS000001';
const WEBHOOK_SECRET = 'e2e-webhook-secret-0123456789';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-e2e-'));

// ---------------- 가짜 GitHub · Slack ----------------
const posts: { channel: string; text: string }[] = [];
const approvedPrs = new Set<number>([14]);

const mock = express();
mock.use(express.urlencoded({ extended: true }));
mock.use(express.json());
mock.post('/slack/api/:method', (req, res) => {
  if (req.params.method === 'chat.postMessage') {
    posts.push({ channel: req.body.channel, text: req.body.text });
    res.json({ ok: true, ts: `${Date.now() / 1000}` });
    return;
  }
  res.json({ ok: true, user_id: 'UBOT', team_id: 'T1', bot_id: 'B1' });
});
mock.post('/github/app/installations/:id/access_tokens', (_req, res) => {
  res.status(201).json({ token: 'ghs_e2e_fake', expires_at: new Date(Date.now() + 3600_000).toISOString(), permissions: {}, repository_selection: 'all' });
});
mock.get('/github/app/installations/:id', (req, res) => {
  res.json({ id: Number(req.params.id), account: { login: 'tuktak-lab', type: 'Organization' } });
});
mock.get('/github/repos/:owner/:repo/pulls/:n/reviews', (req, res) => {
  const n = Number(req.params.n);
  res.json(approvedPrs.has(n) ? [{ state: 'APPROVED', user: { login: 'tjddnjs0316' }, submitted_at: '2026-11-23T09:00:00Z' }] : []);
});
mock.get('/github/repos/:owner/:repo/commits/:sha/pulls', (_req, res) => res.json([]));
const mockServer = mock.listen(MOCK_PORT);

// ---------------- 봇 서버 ----------------
const keyFile = path.join(tmp, 'key.pem');
fs.writeFileSync(keyFile, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }));
const membersFile = fs.existsSync('scripts/pilot-members.json') ? 'scripts/pilot-members.json' : 'scripts/pilot-members.example.json';

const env = {
  ...process.env,
  PORT: String(BOT_PORT),
  PUBLIC_BASE_URL: `http://localhost:${BOT_PORT}`,
  DATABASE_PATH: path.join(tmp, 'bot.db'),
  GITHUB_APP_ID: '123456',
  GITHUB_APP_SLUG: 'bootcamp-notify-bot',
  GITHUB_PRIVATE_KEY_PATH: keyFile,
  GITHUB_PRIVATE_KEY: '',
  GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
  SLACK_BOT_TOKEN: 'xoxb-e2e-fake',
  SLACK_SIGNING_SECRET: 'e2e-signing-secret',
  OPS_CHANNEL_ID: OPS_CHANNEL,
  STATE_SIGNING_SECRET: 'e2e-state-secret-0123456789',
  GITHUB_API_URL: `http://localhost:${MOCK_PORT}/github`,
  SLACK_API_URL: `http://localhost:${MOCK_PORT}/slack/api/`,
  PILOT_MEMBERS_JSON: fs.readFileSync(membersFile, 'utf8').replace(/"slack_channel_id":\s*"[^"]+"/, `"slack_channel_id": "${TEAM_CHANNEL}"`),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bot: ChildProcess | null = null;
let botLog = '';

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });
}

async function webhook(event: string, body: unknown) {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  const res = await fetch(`http://localhost:${BOT_PORT}/github/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': crypto.randomUUID(), 'x-hub-signature-256': sig },
    body: raw,
  });
  return `${res.status} ${await res.text()}`;
}

const repo = { name: 'Keepsy', full_name: 'tuktak-lab/Keepsy', owner: { login: 'tuktak-lab', name: 'tuktak-lab' } };
const inst = { id: INSTALLATION_ID };
const pr = (n: number, title: string, extra: object) => ({
  installation: inst,
  repository: repo,
  sender: { login: 'yoosoo2217', type: 'User' },
  pull_request: { number: n, title, html_url: `https://github.com/tuktak-lab/Keepsy/pull/${n}`, draft: false, user: { login: 'yoosoo2217' }, head: { ref: `feature/${n}` }, base: { ref: 'main' }, ...extra },
});
const push = (after: string, message: string, extra: object = {}) => ({
  ref: 'refs/heads/main', before: '1'.repeat(40), after, created: false, deleted: false, forced: false,
  compare: 'https://github.com/tuktak-lab/Keepsy/compare/x...y', installation: inst, repository: repo,
  sender: { login: 'wol20670', type: 'User' }, pusher: { name: 'wol20670' },
  commits: [{ id: after, message, url: `https://github.com/tuktak-lab/Keepsy/commit/${after}`, author: { username: 'wol20670' } }],
  ...extra,
});

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push({ name, ok, detail });
const team = () => posts.filter((p) => p.channel === TEAM_CHANNEL);
const ops = () => posts.filter((p) => p.channel === OPS_CHANNEL);
const has = (list: { text: string }[], s: string) => list.some((p) => p.text.includes(s));

async function main() {
  console.log('▶ 1. 팀 등록 + 환영 메시지');
  const seedOut = await run('node', ['dist/scripts/seed-pilot.js', '--welcome']);
  const link = seedOut.match(/https:\/\/github\.com\/apps\/\S+/)?.[0] ?? '';
  const state = new URL(link).searchParams.get('state') ?? '';
  check('팀 채널에 "GitHub 연결하기" 메시지', has(team(), 'GitHub 알림 봇이 들어왔어요'));

  console.log('▶ 2. 봇 서버 시작');
  bot = spawn('node', ['dist/src/index.js'], { env });
  bot.stdout?.on('data', (d) => (botLog += d));
  bot.stderr?.on('data', (d) => (botLog += d));
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(`http://localhost:${BOT_PORT}/health`)).ok) break;
    } catch {}
    await sleep(300);
  }
  check('헬스체크 응답', (await fetch(`http://localhost:${BOT_PORT}/health`)).ok);

  console.log('▶ 3. tuktak-lab에 앱 설치(Setup URL)');
  const setupRes = await fetch(`http://localhost:${BOT_PORT}/github/setup?installation_id=${INSTALLATION_ID}&setup_action=install&state=${state}`);
  check('설치 연결 성공 페이지', setupRes.ok && (await setupRes.text()).includes('연결 완료'));
  check('팀 채널에 "연결 완료"', has(team(), '연결 완료'));

  console.log('▶ 4. Keepsy 시나리오 웹훅 전송');
  await webhook('pull_request', { action: 'opened', ...pr(12, '로그인 화면', {}) });
  await webhook('pull_request', { action: 'closed', ...pr(13, '승인 없이 머지한 PR', { merged: true, merged_at: '2026-11-23T10:00:00Z', merged_by: { login: 'wol20670' }, merge_commit_sha: 'a'.repeat(40) }) });
  await webhook('push', push('a'.repeat(40), 'Merge pull request #13'));
  await webhook('pull_request', { action: 'closed', ...pr(14, '승인 받고 머지한 PR', { merged: true, merged_at: '2026-11-23T10:00:00Z', merged_by: { login: 'wol20670' }, merge_commit_sha: 'b'.repeat(40) }) });
  await webhook('push', push('b'.repeat(40), 'Merge pull request #14'));
  await webhook('push', push('d'.repeat(40), 'main에서 바로 고침'));
  await webhook('push', push('f'.repeat(40), '덮어쓰기', { forced: true }));
  await webhook('pull_request_review', {
    action: 'submitted', installation: inst, repository: repo,
    review: { state: 'approved', body: 'LGTM', user: { login: 'tjddnjs0316' }, html_url: 'https://github.com/tuktak-lab/Keepsy/pull/12#r1' },
    pull_request: { number: 12, title: '로그인 화면', html_url: 'https://github.com/tuktak-lab/Keepsy/pull/12', user: { login: 'yoosoo2217' }, head: { ref: 'feature/12' }, base: { ref: 'main' } },
  });
  const badSig = await fetch(`http://localhost:${BOT_PORT}/github/webhook`, { method: 'POST', headers: { 'x-github-event': 'push', 'x-github-delivery': 'bad', 'x-hub-signature-256': 'sha256=00' }, body: '{}' });
  check('위조 서명 거부(401)', badSig.status === 401);

  console.log('▶ 5. 직접 push 판별 대기(약 20초)');
  await sleep(20_000);

  check('#1 새 PR → 팀 채널', has(team(), '새 PR') && has(team(), '#12'));
  check('#3 승인 없는 머지(#13) → 팀 채널', team().some((p) => p.text.includes('승인 없이 머지됨') && p.text.includes('#13')));
  check('#3 승인 없는 머지(#13) → 운영진 채널', ops().some((p) => p.text.includes('승인 없이 머지됨') && p.text.includes('#13')));
  check('승인 받은 #14는 #3 알림 없음', !posts.some((p) => p.text.includes('승인 없이 머지됨') && p.text.includes('#14')));
  check('#2 main 갱신 3건(#13 머지, #14 머지, 직접 push)', team().filter((p) => p.text.includes('main 갱신')).length === 3);
  check('#9 직접 push → 팀·운영진 각 1건', team().filter((p) => p.text.includes('직접 push')).length === 1 && ops().filter((p) => p.text.includes('직접 push')).length === 1);
  check('PR 머지로 생긴 push는 #9 아님', posts.filter((p) => p.text.includes('직접 push')).length === 2);
  check('#10 force push → 팀·운영진', has(team(), 'force push') && has(ops(), 'force push'));
  check('#5 PR 승인 → 팀 채널', has(team(), 'PR 승인'));
  check('멘션이 슬랙 ID로 변환됨', team().some((p) => /<@U[A-Z0-9]+>/.test(p.text)));
}

main()
  .catch((err) => check('시나리오 실행', false, String(err)))
  .finally(() => {
    console.log('\n──────── 팀 채널에 올라간 메시지 ────────');
    team().forEach((p, i) => console.log(`[${i + 1}] ${p.text.split('\n')[0]}`));
    console.log('\n──────── 운영진 채널에 올라간 메시지 ────────');
    ops().forEach((p, i) => console.log(`[${i + 1}] ${p.text.split('\n')[0]}`));
    console.log('\n──────── 결과 ────────');
    for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` — ${r.detail.slice(0, 300)}` : ''}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} 통과`);
    if (failed) console.log('\n봇 로그:\n' + botLog.slice(-2000));
    bot?.kill();
    mockServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  });
