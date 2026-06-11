import { randomBytes } from 'crypto';

/**
 * Short URL-safe random IDs.
 *
 * 9 random bytes encoded as base64url gives 12 chars / 72 bits of entropy.
 * That is compact enough for URLs and logs, while still leaving collision
 * probability far below practical production risk for this app.
 */
export function newShortId(): string {
  return randomBytes(9).toString('base64url');
}

/**
 * RFC 9562 UUIDv7.
 *
 * The first 48 bits are Unix epoch milliseconds, so values sort roughly
 * by creation time while retaining 74 random bits for distributed
 * uniqueness. Use this for durable business identifiers that need to
 * interoperate cleanly with Postgres `uuid`, logs, and provider evidence.
 */
export function newUuidV7(nowMs = Date.now()): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(nowMs);

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
