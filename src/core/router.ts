import type { TeamRoute } from '../db/repo.js';
import type { Ctx } from './context.js';
import { DEFAULT_WATCHED_BRANCHES, FEATURES, type FeatureId } from './features.js';
import type { SlackMessage } from './ports.js';

/**
 * installation_id로 팀을 찾는다. 미등록·종료된 설치면 운영진 채널에 한 번만 보고하고 null.
 * 라우팅 키는 installation_id 하나뿐이며 리포 이름은 쓰지 않는다.
 */
export async function resolveRoute(ctx: Ctx, installationId: number | null | undefined, eventDesc: string): Promise<TeamRoute | null> {
  if (!installationId) return null;
  const route = ctx.repo.findActiveRoute(installationId);
  if (route) return route;
  if (ctx.repo.markUnknownReported(installationId)) {
    const inst = ctx.repo.getInstallation(installationId);
    const org = inst?.orgLogin ? ` (조직: ${inst.orgLogin})` : '';
    await reportOps(
      ctx,
      `:grey_question: 미등록 조직 이벤트 — 설치 ID ${installationId}${org}에서 \`${eventDesc}\` 이벤트가 왔지만 연결된 팀이 없어요. 팀 채널의 "GitHub 연결하기" 버튼으로 설치했는지 확인해 주세요. (같은 설치는 다시 보고하지 않아요)`,
    );
  }
  return null;
}

export function isTeamEnabled(route: TeamRoute, featureId: FeatureId): boolean {
  const f = FEATURES[featureId];
  if (!f.team) return false;
  if (f.teamLocked) return true;
  const override = route.settings.features?.[String(featureId)];
  return typeof override === 'boolean' ? override : f.defaultOn;
}

export function watchedBranches(route: TeamRoute): string[] {
  const b = route.settings.watchedBranches;
  return Array.isArray(b) && b.length > 0 ? b : DEFAULT_WATCHED_BRANCHES;
}

/** 모든 알림의 단일 출구. 팀 설정과 잠금 규칙을 여기서만 적용한다. */
export async function emit(ctx: Ctx, featureId: FeatureId, route: TeamRoute, msg: SlackMessage): Promise<void> {
  const f = FEATURES[featureId];
  if (isTeamEnabled(route, featureId)) {
    await ctx.notifier.post(route.channelId, msg);
  }
  if (f.ops) {
    await ctx.notifier.post(ctx.opsChannelId, {
      text: `[${route.teamName}] ${msg.text}`,
      blocks: [
        { type: 'context', elements: [{ type: 'mrkdwn', text: `*${escape(route.teamName)}* · #${featureId} ${f.name}` }] },
        ...(msg.blocks ?? [{ type: 'section', text: { type: 'mrkdwn', text: msg.text } }]),
      ],
    });
  }
}

/** 운영진 채널 보고. 보고 실패가 본 처리를 깨지 않도록 예외를 삼키고 로그만 남긴다. */
export async function reportOps(ctx: Ctx, text: string): Promise<void> {
  try {
    await ctx.notifier.post(ctx.opsChannelId, { text });
  } catch (err) {
    ctx.log.error('운영진 채널 보고 실패', err);
  }
}

export function mention(ctx: Ctx, route: TeamRoute, login: string | null | undefined): string {
  if (!login) return '알 수 없음';
  const sid = ctx.repo.slackIdForGithub(route.teamId, login);
  return sid ? `<@${sid}>` : `*${escape(login)}*`;
}

/** Slack mrkdwn 특수문자 이스케이프 */
export function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
