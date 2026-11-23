// 한 번에 로컬 실행: npm run local
// .env 준비 → 개인키 찾기 → 터널 주소 받기 → 봇 서버 실행 → 팀 채널에 연결 버튼 보내기
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { bin as cloudflaredBin, install as installCloudflared, Tunnel } from 'cloudflared';

const ENV_FILE = '.env';
const KEY_FILE = path.join('secrets', 'github-app.pem');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const say = (s = '') => console.log(s);

// ---------- .env 읽기·쓰기 ----------
if (!fs.existsSync(ENV_FILE)) fs.copyFileSync('.env.example', ENV_FILE);
const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
const get = (k: string) => lines.find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? '';
const set = (k: string, v: string) => {
  const i = lines.findIndex((l) => l.startsWith(`${k}=`));
  if (i >= 0) lines[i] = `${k}=${v}`;
  else lines.push(`${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n'));
};
const isBlank = (v: string) => !v || v.includes('여기에') || v.includes('your-') || v.includes('나중에');
const random = () => crypto.randomBytes(32).toString('hex');

async function ask(label: string, check: (v: string) => boolean, hint: string): Promise<string> {
  for (;;) {
    const v = (await rl.question(`${label}: `)).trim();
    if (check(v)) return v;
    say(`  ↳ ${hint}`);
  }
}

async function main() {
  say('━━━ 알림 봇 로컬 실행 ━━━\n');

  // 1) 고정값과 랜덤 시크릿
  if (isBlank(get('GITHUB_APP_ID'))) set('GITHUB_APP_ID', '5884754');
  if (isBlank(get('GITHUB_APP_SLUG'))) set('GITHUB_APP_SLUG', 'tuktak-notify-bot');
  if (isBlank(get('GITHUB_PRIVATE_KEY_PATH'))) set('GITHUB_PRIVATE_KEY_PATH', './secrets/github-app.pem');
  if (isBlank(get('PORT'))) set('PORT', '3000');
  if (isBlank(get('DATABASE_PATH'))) set('DATABASE_PATH', './data/bot.db');
  if (isBlank(get('GITHUB_WEBHOOK_SECRET'))) set('GITHUB_WEBHOOK_SECRET', random());
  if (isBlank(get('STATE_SIGNING_SECRET'))) set('STATE_SIGNING_SECRET', random());
  if (isBlank(get('OPS_CHANNEL_ID'))) {
    const team = fs.existsSync('scripts/pilot-members.json') ? JSON.parse(fs.readFileSync('scripts/pilot-members.json', 'utf8')).team?.slack_channel_id : '';
    set('OPS_CHANNEL_ID', team || (await ask('운영진 채널 ID(C로 시작)', (v) => /^[CG][A-Z0-9]+$/.test(v), 'C 또는 G로 시작하는 채널 ID')));
  }
  say('✔ 기본 설정 완료');

  // 2) GitHub 개인키: 다운로드 폴더에서 찾아 복사
  if (!fs.existsSync(KEY_FILE)) {
    const downloads = path.join(os.homedir(), 'Downloads');
    const found = fs.existsSync(downloads)
      ? fs
          .readdirSync(downloads)
          .filter((f) => f.endsWith('.private-key.pem'))
          .map((f) => path.join(downloads, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      : [];
    if (found.length === 0) {
      say('\n✖ GitHub 개인키(.pem)를 찾지 못했어요.');
      say('  GitHub App 설정 화면 맨 위 "generate a private key"를 눌러 받은 뒤 다시 실행해 주세요.');
      process.exit(1);
    }
    fs.mkdirSync('secrets', { recursive: true });
    fs.copyFileSync(found[0], KEY_FILE);
    say(`✔ 개인키 복사: ${path.basename(found[0])} → ${KEY_FILE}`);
  } else {
    say('✔ 개인키 확인');
  }

  // 3) 슬랙 값: 비어 있으면 입력받아 .env에만 저장
  if (!get('SLACK_BOT_TOKEN').startsWith('xoxb-')) {
    say('\n슬랙 앱 설정 → OAuth & Permissions → Bot User OAuth Token');
    set('SLACK_BOT_TOKEN', await ask('Bot Token(xoxb-…) 붙여넣기', (v) => v.startsWith('xoxb-'), 'xoxb- 로 시작하는 값'));
  }
  if (isBlank(get('SLACK_SIGNING_SECRET'))) {
    say('\n슬랙 앱 설정 → Basic Information → Signing Secret (Show)');
    set('SLACK_SIGNING_SECRET', await ask('Signing Secret 붙여넣기', (v) => /^[a-f0-9]{20,}$/.test(v), '영문 소문자·숫자로 된 값'));
  }
  say('✔ 슬랙 설정 확인');

  // 4) 터널 주소
  // npm 설치 때 터널 프로그램 다운로드가 빠졌으면(백신 차단 등) 여기서 받는다
  if (!fs.existsSync(cloudflaredBin)) {
    say('\n터널 프로그램 내려받는 중… (처음 한 번만)');
    await installCloudflared(cloudflaredBin);
  }
  say('\n터널 여는 중…');
  const port = Number(get('PORT') || 3000);
  const tunnel = Tunnel.quick(`http://localhost:${port}`);
  const url: string = await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      tunnel.stop();
      reject(new Error('터널 주소를 60초 안에 받지 못했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.'));
    }, 60_000);
    // 실패 로그 속 api.trycloudflare.com 을 주소로 오인하지 않도록 실제 하위 도메인만 받는다
    tunnel.on('url', (u: string) => {
      if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(u) || u === 'https://api.trycloudflare.com') return;
      clearTimeout(t);
      resolve(u);
    });
    tunnel.once('error', reject);
    tunnel.once('exit', (code) => reject(new Error(`터널 프로그램이 종료됐어요(code ${code}). 인터넷 연결을 확인하고 다시 실행해 주세요.`)));
  });
  const previous = get('PUBLIC_BASE_URL');
  set('PUBLIC_BASE_URL', url);

  // 5) 봇 서버 실행
  for (const l of lines) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
  const tsx = path.join('node_modules', 'tsx', 'dist', 'cli.mjs');
  // watch: 코드 파일을 덮어쓰면 서버만 자동 재시작된다(터널 주소는 그대로 유지)
  const server = spawn(process.execPath, [tsx, 'watch', 'src/index.ts'], { stdio: 'inherit', env: process.env });
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  const secret = get('GITHUB_WEBHOOK_SECRET');
  if (process.platform === 'win32') {
    const clip = spawn('clip');
    clip.stdin.end(secret);
  }

  say('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  say(`  봇 주소:  ${url}`);
  say(`  웹훅 시크릿: ${secret}`);
  if (process.platform === 'win32') say('  (웹훅 시크릿은 클립보드에 복사돼 있어요)');
  say('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  say('  ① 위 "봇 주소"를 Claude에게 알려주세요. GitHub·Slack 앱 URL을 바꿔줘요.');
  say('  ② GitHub App 설정의 Webhook secret 칸에는 웹훅 시크릿을 직접 붙여넣으세요.');
  if (previous && !isBlank(previous) && previous !== url) say('  ※ 지난번과 주소가 달라졌어요. 앱 URL도 새 주소로 바꿔야 해요.');
  say('');

  await rl.question('팀 채널(과 운영진 채널)에서 /invite @github-bot 을 했고, 앱 URL 변경도 끝났으면 Enter… ');
  const seed = spawn(process.execPath, [tsx, 'scripts/seed-pilot.ts', '--welcome'], { stdio: 'inherit', env: process.env });
  await new Promise((r) => seed.on('close', r));
  say('\n✔ 준비 끝! 팀 채널의 "GitHub 연결하기" 버튼을 tuktak-lab 조직 owner가 눌러주세요.');
  say('  종료하려면 Ctrl+C (다시 켜면 터널 주소가 바뀌어요)');

  const stop = () => {
    tunnel.stop();
    server.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
