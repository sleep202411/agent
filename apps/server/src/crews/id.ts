import { newShortId } from '../common/id';

/**
 * Short URL-safe random IDs for public crew URLs.
 *
 * 9 random bytes encoded as base64url gives 12 chars / 72 bits of
 * entropy. That keeps URLs readable without exposing time-shaped CUID
 * prefixes such as `cmpd...`.
 */
export function newCrewDomainId(): string {
  return newShortId();
}

export const newCrewId = newCrewDomainId;
