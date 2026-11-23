import express, { type Router } from 'express';
import type { Repo } from '../db/repo.js';
import type { Logger } from '../core/context.js';
import { verifyGithubSignature } from './verify.js';

export type IngestResult = 'queued' | 'duplicate' | 'ignored';

/** 검증이 끝난 웹훅을 기록하고 큐에 넣는다. 실제 처리는 워커가 한다. */
export function ingestWebhook(repo: Repo, deliveryId: string, event: string, body: any, opts: { silent?: boolean } = {}): IngestResult {
  if (event === 'ping') return 'ignored';
  const queued = repo.recordEventAndEnqueue({
    deliveryId,
    installationId: body?.installation?.id ?? null,
    type: event,
    action: body?.action ?? null,
    repo: body?.repository?.full_name ?? null,
    prNumber: body?.pull_request?.number ?? null,
    actor: body?.sender?.login ?? null,
    jobPayload: { event, deliveryId, body },
    silent: opts.silent,
  });
  return queued ? 'queued' : 'duplicate';
}

export function githubWebhookRouter(deps: { repo: Repo; secret: string; log: Logger }): Router {
  const router = express.Router();
  // 서명 검증을 위해 원문 바이트가 필요하므로 raw 파서를 쓴다
  router.post('/github/webhook', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!verifyGithubSignature(raw, req.header('x-hub-signature-256'), deps.secret)) {
      res.status(401).send('invalid signature');
      return;
    }
    const event = req.header('x-github-event') ?? 'unknown';
    const deliveryId = req.header('x-github-delivery');
    if (!deliveryId) {
      res.status(400).send('missing delivery id');
      return;
    }
    let body: any;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      res.status(400).send('invalid json');
      return;
    }
    try {
      const result = ingestWebhook(deps.repo, deliveryId, event, body);
      res.status(200).send(result);
    } catch (err) {
      deps.log.error('웹훅 적재 실패', err);
      res.status(500).send('error');
    }
  });
  return router;
}
