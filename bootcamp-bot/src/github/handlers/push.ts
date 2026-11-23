import type { Ctx } from '../../core/context.js';
import { emit, escape, mention, resolveRoute, watchedBranches } from '../../core/router.js';
import { section } from './pullRequest.js';

export const DIRECT_PUSH_CHECK_DELAY_MS = 15_000;

/** #2 보호 브랜치 변동, #10 force push, #9 직접 push(지연 검사 예약) */
export async function handlePush(ctx: Ctx, body: any): Promise<void> {
  const ref: string = body.ref ?? '';
  if (!ref.startsWith('refs/heads/')) return; // 태그 push 제외
  const branch = ref.slice('refs/heads/'.length);
  const repo = body.repository;
  if (!repo || body.deleted) return;

  const route = await resolveRoute(ctx, body.installation?.id, 'push');
  if (!route) return;
  if (!watchedBranches(route).includes(branch)) return;

  const who = mention(ctx, route, body.sender?.login ?? body.pusher?.name);
  const where = `${escape(repo.name)}의 \`${escape(branch)}\``;

  if (body.forced) {
    const text =
      `:warning: *force push 감지* — ${where}\n` +
      `by ${who} · <${body.compare}|변경 비교>\n` +
      `이전 커밋 \`${String(body.before).slice(0, 7)}\` 이후 기록이 덮어써졌을 수 있어요. 팀원들은 pull 하기 전에 확인해 주세요.`;
    await emit(ctx, 10, route, section(text));
    return;
  }

  // 브랜치 최초 생성(새 리포의 첫 커밋 포함)은 변동 알림과 직접 push 판별에서 제외
  if (body.created) return;

  const commits: any[] = body.commits ?? [];
  const lines = commits.slice(-5).map((c) => {
    const first = String(c.message ?? '').split('\n')[0];
    return `• <${c.url}|\`${String(c.id).slice(0, 7)}\`> ${escape(first)} — ${escape(c.author?.username ?? c.author?.name ?? '')}`;
  });
  const more = commits.length > 5 ? `\n외 ${commits.length - 5}개` : '';
  const text =
    `:package: *${escape(branch)} 갱신* — ${escape(repo.name)} · 커밋 ${commits.length}개 · by ${who}\n` +
    `${lines.join('\n')}${more}\n<${body.compare}|변경 비교>`;
  await emit(ctx, 2, route, section(text));

  if (body.sender?.type === 'Bot') return;

  // PR 머지 이벤트가 먼저 기록될 시간을 두고 직접 push 여부를 판별한다
  ctx.repo.enqueue(
    'check_direct_push',
    {
      installationId: body.installation.id,
      owner: repo.owner?.login ?? repo.owner?.name,
      repoName: repo.name,
      fullName: repo.full_name,
      branch,
      after: body.after,
      commitCount: commits.length,
      sender: body.sender?.login ?? body.pusher?.name,
      compare: body.compare,
    },
    DIRECT_PUSH_CHECK_DELAY_MS,
  );
}

export async function checkDirectPush(ctx: Ctx, p: any): Promise<void> {
  const route = await resolveRoute(ctx, p.installationId, 'push');
  if (!route || !watchedBranches(route).includes(p.branch)) return;

  // 1) 봇이 받은 PR 머지 기록 2) GitHub API(기본 브랜치의 머지된 PR, 또는 열린 PR) 순으로 확인
  if (ctx.repo.findMergedPrBySha(p.fullName, p.after) !== null) return;
  const prs = await ctx.github.commitPulls(p.installationId, p.owner, p.repoName, p.after);
  if (prs.length > 0) return;

  const text =
    `:no_entry: *보호 브랜치 직접 push* — ${escape(p.repoName)}의 \`${escape(p.branch)}\`에 PR 없이 커밋 ${p.commitCount}개가 올라왔어요.\n` +
    `by ${mention(ctx, route, p.sender)} · <${p.compare}|변경 보기>\n` +
    `보호 브랜치는 PR과 리뷰를 거쳐 머지해 주세요.`;
  await emit(ctx, 9, route, section(text));
}
