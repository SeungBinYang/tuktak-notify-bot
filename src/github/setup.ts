import express, { type Router } from 'express';
import type { Ctx } from '../core/context.js';
import { reportOps } from '../core/router.js';
import { verifyState } from '../core/state.js';

/**
 * GitHub App 설치 후 돌아오는 Setup URL.
 * state(서명된 팀ID)를 검증하고, 설치가 실제로 존재하는지 API로 확인한 뒤 팀–조직을 연결한다.
 */
export async function completeSetup(
  ctx: Ctx,
  q: { installationId: number; state: string | null; stateSecret: string },
): Promise<{ ok: boolean; message: string }> {
  if (!q.state) {
    const known = ctx.repo.getInstallation(q.installationId);
    if (known?.status === 'active' && known.teamId) return { ok: true, message: '설정이 업데이트됐어요. 이 창은 닫아도 돼요.' };
    await reportOps(ctx, `:grey_question: state 없이 설치됨 — 설치 ID ${q.installationId}. 팀 채널의 버튼을 거치지 않은 설치라 연결하지 않았어요.`);
    return { ok: false, message: '팀 슬랙 채널의 "GitHub 연결하기" 버튼으로 다시 설치해 주세요.' };
  }
  const verified = verifyState(q.state, q.stateSecret);
  if (!verified) return { ok: false, message: '설치 링크가 만료됐거나 올바르지 않아요. 팀 채널의 최신 버튼으로 다시 시도해 주세요.' };

  const team = ctx.repo.getTeam(verified.teamId);
  if (!team || team.status !== 'active') return { ok: false, message: '연결할 팀을 찾을 수 없어요. 운영진에게 문의해 주세요.' };

  const account = await ctx.github.getInstallationAccount(q.installationId);
  ctx.repo.linkInstallation(q.installationId, team.id, account.login);

  await ctx.notifier.post(team.channelId, {
    text: `:white_check_mark: GitHub 조직 *${account.login}* 연결 완료! 이제 이 조직의 PR·브랜치 알림이 이 채널로 와요.`,
  });
  await reportOps(ctx, `:link: 팀 *${team.name}* ↔ 조직 *${account.login}* 연결됨 (설치 ID ${q.installationId})`);
  return { ok: true, message: `${account.login} 조직이 ${team.name} 팀 채널에 연결됐어요. 이 창은 닫아도 돼요.` };
}

export function githubSetupRouter(ctx: Ctx, stateSecret: string): Router {
  const router = express.Router();
  router.get('/github/setup', async (req, res) => {
    const installationId = Number(req.query.installation_id);
    if (!Number.isInteger(installationId)) {
      res.status(400).send(page(false, '잘못된 요청이에요.'));
      return;
    }
    try {
      const r = await completeSetup(ctx, {
        installationId,
        state: typeof req.query.state === 'string' ? req.query.state : null,
        stateSecret,
      });
      res.status(r.ok ? 200 : 400).send(page(r.ok, r.message));
    } catch (err) {
      ctx.log.error('설치 연결 실패', err);
      await reportOps(ctx, `:x: 설치 연결 실패 — 설치 ID ${installationId}: ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).send(page(false, '연결 중 오류가 났어요. 운영진에게 알려주세요.'));
    }
  });
  return router;
}

function page(ok: boolean, message: string): string {
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GitHub 연결</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.6"><h1 style="font-size:1.4rem">${ok ? '✅ 연결 완료' : '⚠️ 연결하지 못했어요'}</h1><p>${safe}</p></body></html>`;
}
