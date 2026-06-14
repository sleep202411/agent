import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed access token for the self-hosted realtime WS plane.
 *
 * This is the self-hosted analogue of Azure Web PubSub's client access JWT: the
 * negotiate endpoint authorizes a user for a set of fan-out groups and mints a
 * short-lived token; the WS gateway verifies it on connect and trusts the
 * embedded groups (no per-connection DB round trip). HMAC-SHA256 over a
 * compact `<base64url(payload)>.<base64url(sig)>` envelope — symmetric because a
 * single service both signs and verifies.
 */
export interface RealtimeTokenPayload {
  userId: string;
  /** Fan-out groups this client is authorized to receive. */
  groups: string[];
  /** Expiry, ms since epoch. */
  exp: number;
}

export function signRealtimeToken(
  secret: string,
  payload: RealtimeTokenPayload,
): string {
  const body = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = base64urlEncode(hmac(secret, body));
  return `${body}.${sig}`;
}

export function verifyRealtimeToken(
  secret: string,
  token: string,
  nowMs: number,
): RealtimeTokenPayload | null {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = base64urlEncode(hmac(secret, body));
  if (!constantTimeEqual(providedSig, expectedSig)) return null;

  let payload: RealtimeTokenPayload;
  try {
    payload = JSON.parse(
      base64urlDecode(body).toString('utf8'),
    ) as RealtimeTokenPayload;
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.userId !== 'string' ||
    !Array.isArray(payload.groups) ||
    !payload.groups.every((g) => typeof g === 'string') ||
    typeof payload.exp !== 'number'
  ) {
    return null;
  }
  if (payload.exp <= nowMs) return null;
  return payload;
}

function hmac(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
