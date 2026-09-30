import { ForbiddenException, NotFoundException } from '@nestjs/common';

/** Prisma unique-constraint violation (raced concurrent insert). */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { code?: string }).code === 'P2002';
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve the invite expiry timestamp. `null` / omitted `expiresInDays` means
 * permanent until revoke — matches the studio share UI copy.
 */
export function resolveInviteExpiresAt(
  expiresInDays: number | null | undefined,
): Date | null {
  if (expiresInDays == null) return null;
  return new Date(Date.now() + expiresInDays * MS_PER_DAY);
}

/**
 * Effective invite status with lazy expiry: a still-`pending` invite whose
 * `expiresAt` has passed reads as `expired` without a sweeper. `expiresAt =
 * null` never expires. Any terminal status (accepted / revoked / expired)
 * passes through unchanged. Generic over the per-scope status enum (both share
 * the same string values).
 */
export function effectiveInviteStatus<S extends string>(
  invite: { status: S; expiresAt: Date | null },
  now: Date = new Date(),
): S | 'expired' {
  if (
    invite.status === 'pending' &&
    invite.expiresAt != null &&
    invite.expiresAt.getTime() <= now.getTime()
  ) {
    return 'expired';
  }
  return invite.status;
}

/** Link expiry does not revoke existing membership; only current access matters. */
export async function existingInviteAccess<T>(
  read: () => Promise<T>,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof ForbiddenException ||
      error instanceof NotFoundException
    )
      return null;
    throw error;
  }
}
