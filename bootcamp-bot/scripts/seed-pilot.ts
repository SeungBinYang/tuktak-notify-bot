// 사용법(로컬):  npm run seed:pilot              → DB에 파일럿 팀 등록 + 설치 링크 출력
//               npm run seed:pilot -- --welcome  → 위 작업 + 팀 채널에 "GitHub 연결하기" 버튼 메시지 발송
// 사용법(서버):  node dist/scripts/seed-pilot.js --welcome
import '../src/silence-sqlite-warning.js';
import 'dotenv/config';
import bolt from '@slack/bolt';
import fs from 'node:fs';
import path from 'node:path';
import { pilotSchema, seedPilot, welcomeMessage } from '../src/core/seed.js';
import { installUrl, signState } from '../src/core/state.js';
import { openDb, Repo } from '../src/db/repo.js';

// 팀 정보는 scripts/pilot-members.json 파일 또는 PILOT_MEMBERS_JSON 환경변수(서버 컨테이너에서 실행할 때)에서 읽는다
const file = path.resolve('scripts/pilot-members.json');
const rawJson = process.env.PILOT_MEMBERS_JSON ?? (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
if (!rawJson) {
  console.error('팀 정보가 없어요. scripts/pilot-members.json 을 만들거나 PILOT_MEMBERS_JSON 환경변수를 설정해 주세요.');
  process.exit(1);
}
const data = pilotSchema.parse(JSON.parse(rawJson));
const repo = new Repo(openDb(process.env.DATABASE_PATH ?? './data/bot.db'));
const { teamId, memberCount } = seedPilot(repo, data);
console.log(`✔ 팀 "${data.team.name}" 등록 완료 (팀 ID ${teamId}, 팀원 ${memberCount}명)`);

const slug = process.env.GITHUB_APP_SLUG;
const secret = process.env.STATE_SIGNING_SECRET;
if (!slug || !secret) {
  console.log('GITHUB_APP_SLUG, STATE_SIGNING_SECRET 이 설정되면 설치 링크를 만들어 드려요.');
  process.exit(0);
}
const link = installUrl(slug, signState(teamId, secret));
console.log(`설치 링크(7일 유효): ${link}`);

if (process.argv.includes('--welcome')) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('SLACK_BOT_TOKEN 이 없어 환영 메시지를 보내지 못했어요.');
    process.exit(1);
  }
  const client = new bolt.webApi.WebClient(token, process.env.SLACK_API_URL ? { slackApiUrl: process.env.SLACK_API_URL } : {});
  const msg = welcomeMessage(data, link);
  await client.chat.postMessage({ channel: data.team.slack_channel_id, text: msg.text, blocks: msg.blocks as any });
  console.log('✔ 팀 채널에 환영 메시지와 연결 버튼을 보냈어요.');
}
