import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CrewMembershipStatus, type Prisma } from '@prisma/client';
import {
  CREW_MEMBER_PERMISSIONS,
  CREW_OWNER_ONLY_PERMISSIONS,
  CREW_PERMISSION_KEYS,
  CREW_POLICY_PERMISSIONS,
  isCrewPermissionKey,
  isCrewPolicyKey,
  type CrewPermissionKey,
  type CrewPolicyKey,
} from '@repo/shared/crew';
import { PrismaService } from '../infra/db/db.module';

type CrewAuthorizationDb = Pick<
  Prisma.TransactionClient,
  'crew' | 'crewMember' | 'crewOwnership'
>;

export interface CrewAuthorizationContext {
  crewId: string;
  memberId: string;
  userId: string;
  isOwner: boolean;
  policyKeys: CrewPolicyKey[];
  permissions: CrewPermissionKey[];
}

const OWNER_ONLY = new Set<CrewPermissionKey>(CREW_OWNER_ONLY_PERMISSIONS);

/**
 * The one authorization boundary for the crew domain.
 *
 * Membership grants the baseline, additive policies grant capability bundles,
 * and explicit overrides are applied last. Ownership is a separate relation
 * and always receives every registered permission. No caller is allowed to
 * infer authorization from production positions, join source or UI badges.
 */
@Injectable()
export class CrewAuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    crewId: string,
    userId: string,
    db: CrewAuthorizationDb = this.prisma,
  ): Promise<CrewAuthorizationContext | null> {
    const crew = await db.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');

    const member = await db.crewMember.findFirst({
      where: {
        crewId,
        userId,
        status: CrewMembershipStatus.active,
      },
      select: {
        id: true,
        ownership: { select: { crewId: true } },
        policies: { select: { policyKey: true } },
        permissionOverrides: {
          select: { permissionKey: true, effect: true },
        },
      },
    });
    if (!member) return null;

    return crewAuthorizationFromMember(crewId, userId, member);
  }

  async requireMembership(
    crewId: string,
    userId: string,
    db: CrewAuthorizationDb = this.prisma,
  ): Promise<CrewAuthorizationContext> {
    const context = await this.resolve(crewId, userId, db);
    if (!context) {
      throw new ForbiddenException({
        code: 'CREW_MEMBERSHIP_REQUIRED',
        message: 'Active crew membership is required.',
      });
    }
    return context;
  }

  async require(
    crewId: string,
    userId: string,
    permission: CrewPermissionKey,
    db: CrewAuthorizationDb = this.prisma,
  ): Promise<CrewAuthorizationContext> {
    const context = await this.requireMembership(crewId, userId, db);
    if (!context.permissions.includes(permission)) {
      throw new ForbiddenException({
        code: 'CREW_PERMISSION_DENIED',
        message: 'You do not have permission to perform this crew action.',
        permission,
      });
    }
    return context;
  }

  async can(
    crewId: string,
    userId: string,
    permission: CrewPermissionKey,
    db: CrewAuthorizationDb = this.prisma,
  ): Promise<boolean> {
    const context = await this.resolve(crewId, userId, db);
    return context?.permissions.includes(permission) ?? false;
  }

  async owner(
    crewId: string,
    db: CrewAuthorizationDb = this.prisma,
  ): Promise<{ memberId: string; userId: string }> {
    const ownership = await db.crewOwnership.findUnique({
      where: { crewId },
      select: {
        memberId: true,
        member: { select: { userId: true, status: true } },
      },
    });
    if (!ownership || ownership.member.status !== CrewMembershipStatus.active) {
      throw new NotFoundException('Crew owner not found');
    }
    return {
      memberId: ownership.memberId,
      userId: ownership.member.userId,
    };
  }
}

/** Evaluate the same policy/override rules for projected Studio access. */
export function crewAuthorizationFromMember(
  crewId: string,
  userId: string,
  member: {
    id: string;
    ownership: { crewId: string } | null;
    policies: Array<{ policyKey: string }>;
    permissionOverrides: Array<{ permissionKey: string; effect: string }>;
  },
): CrewAuthorizationContext {
  const isOwner = member.ownership?.crewId === crewId;
  const policyKeys = member.policies
    .map((row) => row.policyKey)
    .filter(isCrewPolicyKey);
  const permissions = new Set<CrewPermissionKey>();

  if (isOwner) {
    for (const permission of CREW_PERMISSION_KEYS) {
      permissions.add(permission);
    }
  } else {
    for (const permission of CREW_MEMBER_PERMISSIONS) {
      permissions.add(permission);
    }
    for (const policyKey of policyKeys) {
      for (const permission of CREW_POLICY_PERMISSIONS[policyKey]) {
        permissions.add(permission);
      }
    }
    for (const override of member.permissionOverrides) {
      if (!isCrewPermissionKey(override.permissionKey)) continue;
      if (OWNER_ONLY.has(override.permissionKey)) continue;
      if (override.effect === 'allow') {
        permissions.add(override.permissionKey);
      } else {
        permissions.delete(override.permissionKey);
      }
    }
  }

  return {
    crewId,
    memberId: member.id,
    userId,
    isOwner,
    policyKeys,
    permissions: CREW_PERMISSION_KEYS.filter((permission) =>
      permissions.has(permission),
    ),
  };
}
