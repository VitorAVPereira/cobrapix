import { createHmac, timingSafeEqual } from 'node:crypto';

export interface DatafySignatureInput {
  secret: string | undefined;
  rawBody: Buffer | undefined;
  timestamp: unknown;
  signature: unknown;
  now?: number;
}

export function verifyDatafySignature(input: DatafySignatureInput): boolean {
  if (
    !input.secret ||
    !Buffer.isBuffer(input.rawBody) ||
    typeof input.timestamp !== 'string' ||
    !/^\d{10}$/.test(input.timestamp) ||
    typeof input.signature !== 'string' ||
    !/^sha256=[a-f0-9]{64}$/.test(input.signature)
  )
    return false;
  const seconds = Number(input.timestamp);
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  // Five minutes for delivery/replay; only a small allowance for clock skew into the future.
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < now - 300 ||
    seconds > now + 30
  )
    return false;
  const expected = createHmac('sha256', input.secret)
    .update(`${input.timestamp}.`)
    .update(input.rawBody)
    .digest();
  const actual = Buffer.from(input.signature.slice(7), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
