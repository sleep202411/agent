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
