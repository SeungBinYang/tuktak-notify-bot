import { JOB_HANDLERS } from '../github/handlers/index.js';
import type { Ctx } from './context.js';
import { reportOps } from './router.js';

export const MAX_ATTEMPTS = 3;

/** 실행 가능한 작업을 꺼내 처리한다. 처리한 개수를 돌려준다. */
export async function processJobs(ctx: Ctx, limit = 10): Promise<number> {
  const jobs = ctx.repo.claimJobs(limit);
  for (const job of jobs) {
    const handler = JOB_HANDLERS[job.type];
    try {
      if (!handler) throw new Error(`알 수 없는 작업 유형: ${job.type}`);
      await handler(ctx, job.payload);
      ctx.repo.completeJob(job.id);
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      if (job.attempts < MAX_ATTEMPTS) {
        ctx.repo.retryJob(job.id, msg, 30_000 * job.attempts);
        ctx.log.error(`작업 #${job.id}(${job.type}) 실패, 재시도 예정 (${job.attempts}/${MAX_ATTEMPTS})`, err);
      } else {
        ctx.repo.failJob(job.id, msg);
        ctx.log.error(`작업 #${job.id}(${job.type}) 최종 실패`, err);
        const first = err instanceof Error ? err.message : String(err);
        await reportOps(ctx, `:x: 봇 처리 오류 — 작업 #${job.id} (${job.type})가 ${MAX_ATTEMPTS}회 실패했어요.\n\`${first.slice(0, 300)}\``);
      }
    }
  }
  return jobs.length;
}

export function startWorker(ctx: Ctx, intervalMs = 1000): () => void {
  const revived = ctx.repo.resetStuckJobs();
  if (revived > 0) ctx.log.info(`중단됐던 작업 ${revived}개를 다시 대기열에 넣었어요`);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      while ((await processJobs(ctx)) > 0) {
        /* 쌓인 작업을 모두 비울 때까지 */
      }
    } catch (err) {
      ctx.log.error('워커 루프 오류', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
