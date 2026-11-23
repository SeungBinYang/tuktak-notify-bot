import bolt from '@slack/bolt';
import type { Notifier } from '../core/ports.js';

/** 알림 발송 전용 슬랙 클라이언트. 기본 재시도(약 30분)는 너무 길어 2회로 줄이고, 재시도는 jobs 큐가 맡는다. */
export function createNotifier(token: string, apiUrl?: string): Notifier {
  const client = new bolt.webApi.WebClient(token, { ...(apiUrl ? { slackApiUrl: apiUrl } : {}), retryConfig: { retries: 2, factor: 2 } });
  return {
    async post(channel, msg) {
      await client.chat.postMessage({ channel, text: msg.text, blocks: msg.blocks as any, unfurl_links: false, unfurl_media: false });
    },
  };
}
