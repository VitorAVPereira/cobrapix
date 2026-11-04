import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';

const TIMEOUT_MS = 10_000;

export type WebhookSendResult =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode: number | null; error: string };

/** v1 = HMAC-SHA256(secret, "<timestamp>.<raw body>"), as the seller checks it. */
export function webhookSignature(
  secret: string,
  timestamp: number,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

function ipv4Private(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return ipv4Private(ip);
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return ipv4Private(mapped[1]);
  return (
    lower === '::' ||
    lower === '::1' ||
    /^f[cd]/.test(lower) ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith('ff')
  );
}

/**
 * What a seller may type: https on the default port, a host name (not an IP
 * literal or localhost), no credentials. Returns a message for the seller.
 */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Informe uma URL válida.';
  }
  if (url.protocol !== 'https:') return 'A URL precisa começar com https://.';
  if (url.username || url.password) return 'Não use usuário e senha na URL.';
  if (url.port && url.port !== '443') return 'Use a porta padrão do https.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || host === 'localhost' || host.endsWith('.localhost'))
    return 'Use um endereço público, com nome de domínio.';
  return null;
}

/**
 * Posts one signed notice. The host is resolved before each send and every
 * address must be public, so the webhook cannot reach the server's network.
 */
@Injectable()
export class CheckoutWebhookSender {
  async send(
    target: { url: string; secret: string },
    event: { id: string; type: string },
    body: string,
    now = new Date(),
  ): Promise<WebhookSendResult> {
    const problem = webhookUrlProblem(target.url);
    if (problem) return { ok: false, statusCode: null, error: 'URL_INVALID' };
    const host = new URL(target.url).hostname;
    try {
      const addresses = await lookup(host, { all: true, verbatim: true });
      if (
        !addresses.length ||
        addresses.some((entry) => isPrivateAddress(entry.address))
      )
        return { ok: false, statusCode: null, error: 'URL_NOT_PUBLIC' };
    } catch {
      return { ok: false, statusCode: null, error: 'DNS_FAILED' };
    }
    const timestamp = Math.floor(now.getTime() / 1000);
    try {
      const response = await fetch(target.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CifraCheckout-Webhook/1.0',
          'X-Cifra-Event-Id': event.id,
          'X-Cifra-Event-Type': event.type,
          'X-Cifra-Signature': `t=${timestamp},v1=${webhookSignature(target.secret, timestamp, body)}`,
        },
        body,
      });
      // Only the status matters; the body is never read.
      await response.body?.cancel().catch(() => undefined);
      return response.status >= 200 && response.status < 300
        ? { ok: true, statusCode: response.status }
        : { ok: false, statusCode: response.status, error: 'HTTP_STATUS' };
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      return {
        ok: false,
        statusCode: null,
        error: timedOut ? 'TIMEOUT' : 'NETWORK',
      };
    }
  }
}
