import type { Ctx } from '../../core/context.js';
import { reportOps } from '../../core/router.js';

/** 설치 생성은 Setup URL(state 검증)에서 연결한다. 여기서는 해제만 처리한다. */
export async function handleInstallation(ctx: Ctx, body: any): Promise<void> {
  if (body.action !== 'deleted') return;
  const id: number | undefined = body.installation?.id;
  if (!id) return;
  const inst = ctx.repo.getInstallation(id);
  if (!inst) return;
  ctx.repo.markInstallationRemoved(id);
  const team = inst.teamId ? ctx.repo.getTeam(inst.teamId) : null;
  await reportOps(ctx, `:electric_plug: GitHub App 설치 해제 — 조직 ${inst.orgLogin}${team ? ` (팀 ${team.name})` : ''}. 이 조직의 알림이 중단됩니다.`);
}
