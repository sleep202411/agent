/** Prisma unique-constraint violation (raced concurrent insert). */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { code?: string }).code === 'P2002';
}

/**
 * Effective invite status with lazy expiry: a still-`pending` invite whose
 * `expiresAt` has passed reads as `expired` without a sweeper. Any terminal
 * status (accepted / revoked / expired) passes through unchanged. Generic over
 * the per-scope status enum (both share the same string values).
 */
export function effectiveInviteStatus<S extends string>(
  invite: { status: S; expiresAt: Date },
  now: Date = new Date(),
): S | 'expired' {
  if (
    invite.status === 'pending' &&
    invite.expiresAt.getTime() <= now.getTime()
  ) {
    return 'expired';
  }
  return invite.status;
}
