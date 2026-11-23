import bolt from '@slack/bolt';
import type { Logger } from '../core/context.js';
import type { Notifier } from '../core/ports.js';

const { App, ExpressReceiver } = bolt;

// 매니페스트(docs/SETUP.md)에 등록된 커맨드. 1단계에서는 안내만 한다.
const PLANNED_COMMANDS: Record<string, string> = {
  '/cohort': '기수 생성은 4단계에서 열려요. 파일럿은 `npm run seed:pilot`으로 등록해요.',
  '/module': '모듈 시작·종료는 4단계에서 자동화돼요. 파일럿은 `npm run seed:pilot`으로 등록해요.',
  '/team': '팀 등록·이동은 4단계에서 열려요.',
  '/github-link': 'GitHub 계정 연결은 2단계에서 열려요. 파일럿 팀원은 이미 등록돼 있어요.',
  '/notify-settings': '알림·브랜치 전략 설정은 2단계에서 열려요.',
  '/pr-status': 'PR 현황 조회는 5단계에서 열려요.',
};

export function createSlack(opts: { token: string; signingSecret: string; log: Logger; apiUrl?: string }) {
  const receiver = new ExpressReceiver({ signingSecret: opts.signingSecret, endpoints: '/slack/events' });
  const api = opts.apiUrl ? { slackApiUrl: opts.apiUrl } : {};
  const app = new App({ token: opts.token, receiver, clientOptions: api });
  // 알림 발송 전용 클라이언트. 기본 재시도(약 30분)는 워커를 오래 붙잡으므로 짧게 줄이고, 재시도는 jobs 큐가 맡는다
  const sender = new bolt.webApi.WebClient(opts.token, { ...api, retryConfig: { retries: 2, factor: 2 } });

  for (const [cmd, msg] of Object.entries(PLANNED_COMMANDS)) {
    app.command(cmd, async ({ ack }) => {
      await ack(`:construction: 준비 중인 기능이에요. ${msg}`);
    });
  }
  // 링크 버튼(GitHub 연결하기)을 눌러도 슬랙이 액션을 보내므로 응답만 해준다
  app.action(/.*/, async ({ ack }) => {
    await ack();
  });
  app.error(async (err) => {
    opts.log.error('Slack 처리 오류', err);
  });

  const notifier: Notifier = {
    async post(channel, msg) {
      await sender.chat.postMessage({
        channel,
        text: msg.text,
        blocks: msg.blocks as any,
        unfurl_links: false,
        unfurl_media: false,
      });
    },
  };

  return { app, receiver, notifier };
}
