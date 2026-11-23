import crypto from 'node:crypto';

/** X-Hub-Signature-256 검증 (sha256=<hex>) */
export function verifyGithubSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
