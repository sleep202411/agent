import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingSubjectType,
  EntitlementGrantStatus,
  type EntitlementGrant,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { EntitlementService } from '../entitlements';
import type { GrantMembershipInput } from './dto';

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
  planKey: string;
  status: EntitlementGrantStatus;
  sourceType: string;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
  note: string | null;
  /** Derived: counted by the entitlement resolver as of now. */
  activeNow: boolean;
};

function noteFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const note = (metadata as Record<string, unknown>).note;
  return typeof note === 'string' && note.length > 0 ? note : null;
}

function toView(grant: EntitlementGrant, now: Date): MembershipGrantView {
  return {
    id: grant.id,
    planKey: grant.planKey,
    status: grant.status,
    sourceType: grant.sourceType,
    startsAt: grant.startsAt,
    endsAt: grant.endsAt,
    revokedAt: grant.revokedAt,
    note: noteFromMetadata(grant.metadata),
    activeNow:
      grant.status === EntitlementGrantStatus.active &&
      grant.startsAt <= now &&
      (!grant.endsAt || grant.endsAt > now),
  };
}

@Injectable()
export class MembershipGrantAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  /** Every grant on the user (any source), newest first, for the admin dialog. */
  async listForUser(userId: string): Promise<MembershipGrantView[]> {
    const now = new Date();
    const grants = await this.prisma.entitlementGrant.findMany({
      where: { subjectType: BillingSubjectType.user, subjectId: userId },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    });
    return grants.map((grant) => toView(grant, now));
  }

  async grant(
    adminId: string,
    input: GrantMembershipInput,
  ): Promise<MembershipGrantView> {
    const grant = await this.entitlements.grantComplimentary({
      subjectType: BillingSubjectType.user,
      subjectId: input.userId,
      planKey: input.planKey,
      durationDays: input.durationDays,
      sourceType: ADMIN_GRANT_SOURCE,
      // Every admin grant is a distinct source — grantComplimentary's
      // idempotency is per sourceId, and "grant again" must stack, not no-op.
      sourceId: randomUUID(),
      metadata: { note: input.note, grantedBy: adminId },
    });
    return toView(grant, new Date());
  }

  /**
   * Early revoke. Restricted to admin-issued grants — purchased memberships
   * must go through the refund flow so money and entitlement stay consistent.
   */
  async revoke(grantId: string): Promise<MembershipGrantView> {
    const existing = await this.prisma.entitlementGrant.findUnique({
      where: { id: grantId },
    });
    if (!existing) throw new NotFoundException('Grant not found.');
    if (existing.sourceType !== ADMIN_GRANT_SOURCE) {
      throw new BadRequestException(
        'Only admin-issued grants can be revoked here; refund the order instead.',
      );
    }
    if (existing.status !== EntitlementGrantStatus.active) {
      throw new BadRequestException('Grant is not active.');
    }
    const updated = await this.prisma.entitlementGrant.update({
      where: { id: grantId },
      data: {
        status: EntitlementGrantStatus.revoked,
        revokedAt: new Date(),
      },
    });
    return toView(updated, new Date());
  }
}
