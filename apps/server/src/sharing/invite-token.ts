import { createHash, randomBytes } from 'crypto';

/**
 * Invite-link tokens. The raw token is the bearer secret in the shareable URL;
 * only its SHA-256 hash is persisted (`tokenHash`, unique). Lookup hashes the
 * incoming token and matches the stored hash — the plaintext never hits the DB,
 * consistent with the WorkspaceInvite/ProjectInvite schema.
 */
export function generateInviteToken(): { token: string; tokenHash: string } {
  // 24 random bytes → 32-char url-safe string; ample entropy for a bearer link.
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  // 64 hex chars — within the tokenHash VarChar(128).
  return createHash('sha256').update(token.trim()).digest('hex');
}
