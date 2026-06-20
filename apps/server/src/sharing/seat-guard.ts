import { ForbiddenException } from '@nestjs/common';
import { WorkspaceMemberStatus, type Prisma } from '@prisma/client';
import type { EntitlementService } from '../entitlements/entitlement.service';
import { decideSeatAdmission } from '../entitlements/seat-policy';

/**
 * Seat-limit enforcement for the two ways a *new* member occupies a seat: admin
 * add-by-account and invite-accept. Split into the lock + the assertion so the
 * caller controls lock ordering:
 *
 *   1. `acquireSeatLock` FIRST in the transaction (before any row `FOR UPDATE`),
 *      so the per-workspace lock order is identical across paths (no deadlock)
 *      and concurrent adds serialize.
 *   2. `assertSeatAvailable` right before the create — it resolves the policy AND
 *      counts members on the same locked transaction, so there's no stale-policy
 *      TOCTOU (a plan change can't slip between resolve and count).
 */
export async function acquireSeatLock(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace:seats:${workspaceId}`})::bigint)`;
}

export async function assertSeatAvailable(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  entitlements: EntitlementService,
): Promise<void> {
  const policy = await entitlements.resolveWorkspaceSeatPolicy(workspaceId, {
    tx,
  });
  const activeSeats = await tx.workspaceMember.count({
    where: {
      workspaceId,
      removedAt: null,
      status: WorkspaceMemberStatus.active,
    },
  });

  const admission = decideSeatAdmission(policy, activeSeats);
  if (admission.kind === 'allow') return;

  if (admission.kind === 'requires_purchase') {
    // FUTURE pay-per-seat: the caller would route to a one-seat checkout for
    // `seatPriceId`. Until that flow exists, surface a distinct, actionable code.
    throw new ForbiddenException({
      code: 'WORKSPACE_SEAT_PURCHASE_REQUIRED',
      msg: 'An additional paid seat is required to add this member.',
      seatPriceId: admission.seatPriceId,
      includedSeats: admission.policy.includedSeats,
      activeSeats: admission.activeSeats,
    });
  }

  throw new ForbiddenException({
    code: 'WORKSPACE_SEAT_LIMIT_REACHED',
    msg: admission.reason,
    planKey: admission.policy.planKey,
    includedSeats: admission.policy.includedSeats,
    maxSeats: admission.policy.maxSeats,
    activeSeats: admission.activeSeats,
  });
}
