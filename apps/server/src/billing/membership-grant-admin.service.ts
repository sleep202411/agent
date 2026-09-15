import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingSubjectType,
  EntitlementGrantStatus,
  WorkspaceStatus,
  type EntitlementGrant,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { EntitlementService } from '../entitlements';
import { enqueueEntitlementChanged } from './entitlement-realtime';
import type { GrantMembershipInput, ListMembershipGrantsQuery } from './dto';

/**
 * Admin 手动开会员 (complimentary membership grants). A thin admin surface over
 * EntitlementService.grantComplimentary — the same primitive the referral
 * reward packs use — so an admin-issued membership behaves exactly like any
 * other grant: highest rank wins, stacks onto an existing same-plan grant,
 * expires on its own at endsAt.
 */
const ADMIN_GRANT_SOURCE = 'admin_manual';

export type MembershipGrantView = {
  id: string;
  subjectType: BillingSubjectType;
  subjectId: string;
  planKey: string;
  sourceType: string;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
  note: string | null;
  /** Time-aware status for operators; unlike the stored lifecycle status, this expires at endsAt. */
  effectiveStatus: EntitlementGrantStatus;
};

function noteFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const note = (metadata as Record<string, unknown>).note;
  return typeof note === 'string' && note.length > 0 ? note : null;
}

function effectiveStatusAt(
  grant: EntitlementGrant,
  now: Date,
): EntitlementGrantStatus {
  if (grant.status === EntitlementGrantStatus.revoked) {
    return EntitlementGrantStatus.revoked;
  }
  if (grant.status === EntitlementGrantStatus.expired) {
    return EntitlementGrantStatus.expired;
  }
  if (grant.status === EntitlementGrantStatus.pending || grant.startsAt > now) {
    return EntitlementGrantStatus.pending;
  }
  if (grant.endsAt && grant.endsAt <= now) {
    return EntitlementGrantStatus.expired;
  }
  return EntitlementGrantStatus.active;
}

function toView(grant: EntitlementGrant, now: Date): MembershipGrantView {
  const effectiveStatus = effectiveStatusAt(grant, now);
  return {
    id: grant.id,
    subjectType: grant.subjectType,
    subjectId: grant.subjectId,
    planKey: grant.planKey,
    sourceType: grant.sourceType,
    startsAt: grant.startsAt,
    endsAt: grant.endsAt,
    revokedAt: grant.revokedAt,
    note: noteFromMetadata(grant.metadata),
    effectiveStatus,
  };
}

@Injectable()
export class MembershipGrantAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  /** Every grant on one subject (any source), newest first, for the admin dialog. */
  async listForSubject(
    input: ListMembershipGrantsQuery,
  ): Promise<MembershipGrantView[]> {
    const now = new Date();
    const grants = await this.prisma.entitlementGrant.findMany({
      where: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    });
    return grants.map((grant) => toView(grant, now));
  }

  async grant(
    adminId: string,
    input: GrantMembershipInput,
  ): Promise<MembershipGrantView> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGrantTarget(input, tx);
      const grant = await this.entitlements.grantComplimentary(
        {
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          planKey: input.planKey,
          durationDays: input.durationDays,
          sourceType: ADMIN_GRANT_SOURCE,
          // Every admin grant is a distinct source — grantComplimentary's
          // idempotency is per sourceId, and "grant again" must stack, not no-op.
          sourceId: randomUUID(),
          metadata: { note: input.note, grantedBy: adminId },
        },
        tx,
      );
      return toView(grant, new Date());
    });
  }

  /**
   * Early revoke. Restricted to admin-issued grants — purchased memberships
   * must go through the refund flow so money and entitlement stay consistent.
   */
  async revoke(grantId: string): Promise<MembershipGrantView> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM entitlement_grants WHERE id=${grantId}::uuid FOR UPDATE`;
      const existing = await tx.entitlementGrant.findUnique({
        where: { id: grantId },
      });
      if (!existing) throw new NotFoundException('Grant not found.');
      if (existing.sourceType !== ADMIN_GRANT_SOURCE) {
        throw new BadRequestException(
          'Only admin-issued grants can be revoked here; refund the order instead.',
        );
      }
      const [{ now }] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      const effectiveStatus = effectiveStatusAt(existing, now);
      if (
        effectiveStatus !== EntitlementGrantStatus.active &&
        effectiveStatus !== EntitlementGrantStatus.pending
      ) {
        throw new BadRequestException('Grant is not revocable.');
      }
      const result = await tx.entitlementGrant.updateMany({
        where: {
          id: grantId,
          status: existing.status,
          revokedAt: existing.revokedAt,
        },
        data: {
          status: EntitlementGrantStatus.revoked,
          revokedAt: now,
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'Grant changed while it was being revoked. Refresh and try again.',
        );
      }
      const updated: EntitlementGrant = {
        ...existing,
        status: EntitlementGrantStatus.revoked,
        revokedAt: now,
      };
      await enqueueEntitlementChanged(tx, updated, 'revoked');
      return toView(updated, now);
    });
  }

  private async assertGrantTarget(
    input: GrantMembershipInput,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (input.subjectType === BillingSubjectType.user) return;

    await tx.$queryRaw`SELECT id FROM workspaces WHERE id=${input.subjectId}::uuid FOR SHARE`;
    const workspace = await tx.workspace.findFirst({
      where: { id: input.subjectId, deletedAt: null },
      select: { status: true },
    });
    if (!workspace) {
      throw new NotFoundException({
        code: 'WORKSPACE_NOT_FOUND',
        msg: 'Workspace not found.',
      });
    }
    if (workspace.status !== WorkspaceStatus.active) {
      throw new ConflictException({
        code: 'WORKSPACE_NOT_ACTIVE',
        msg: 'Team plans can only be granted to active workspaces.',
      });
    }
  }
}
