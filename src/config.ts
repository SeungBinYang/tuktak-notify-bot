import fs from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  PUBLIC_BASE_URL: z.string().url().transform((s) => s.replace(/\/+$/, '')),
  DATABASE_PATH: z.string().default('./data/bot.db'),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(16, 'GITHUB_WEBHOOK_SECRET은 16자 이상이어야 해요'),
  SLACK_BOT_TOKEN: z.string().startsWith('xoxb-', 'SLACK_BOT_TOKEN은 xoxb- 로 시작해야 해요'),
  SLACK_SIGNING_SECRET: z.string().min(1),
  OPS_CHANNEL_ID: z.string().regex(/^[CG][A-Z0-9]+$/, 'OPS_CHANNEL_ID는 C 또는 G로 시작하는 채널 ID여야 해요'),
  STATE_SIGNING_SECRET: z.string().min(16, 'STATE_SIGNING_SECRET은 16자 이상이어야 해요'),
  // 비워두면 실제 GitHub·Slack 주소를 쓴다. 통합 테스트(가짜 서버)나 GitHub Enterprise에서만 설정
  GITHUB_API_URL: z.string().url().optional(),
  SLACK_API_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof schema> & { githubPrivateKey: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`환경변수 설정이 올바르지 않아요:\n${lines}`);
  }
  const c = parsed.data;
  return { ...c, githubPrivateKey: readPrivateKey(c.GITHUB_PRIVATE_KEY, c.GITHUB_PRIVATE_KEY_PATH) };
}

/** 호스팅 환경변수(원문 PEM 또는 base64) 또는 파일 경로 중 하나로 개인키를 받는다. */
export function readPrivateKey(inline?: string, filePath?: string): string {
  if (inline && inline.trim()) {
    const v = inline.trim();
    if (v.includes('BEGIN')) return v.replace(/\\n/g, '\n');
    return Buffer.from(v, 'base64').toString('utf8');
  }
  if (filePath) return fs.readFileSync(filePath, 'utf8');
  throw new Error('GITHUB_PRIVATE_KEY 또는 GITHUB_PRIVATE_KEY_PATH 중 하나는 설정해야 해요');
}
