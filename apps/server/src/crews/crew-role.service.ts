/**
 * Centralized role resolution for crew authorization.
 *
 * Every guarded endpoint asks: "what is this user's role in this crew?"
 *   - admin   = the founder
 *   - finance = a non-founder member with isFinance = true
 *   - member  = any other active member
 *   - outsider = not a member, not the founder
 *
 * The roles are mutually exclusive: the founder short-circuits to 'admin'
 * before isFinance is ever read, so a founder never resolves to 'finance'.
 * Callers that mean "may touch money" must therefore allow BOTH, i.e.
 * `require(crewId, userId, ['admin', 'finance'])`.
 */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';

export type CrewRole = 'admin' | 'finance' | 'member' | 'outsider';
type CrewRoleDb = Pick<Prisma.TransactionClient, 'crew' | 'crewMember'>;

@Injectable()
export class CrewRoleService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    crewId: string,
    userId: string,
    db: CrewRoleDb = this.prisma,
  ): Promise<CrewRole> {
    const crew = await db.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { founderId: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');

    if (crew.founderId === userId) return 'admin';

    // Active membership only (partial unique on removed_at IS NULL).
    const member = await db.crewMember.findFirst({
      where: { crewId, userId, removedAt: null },
      select: { isFinance: true },
    });
    if (!member) return 'outsider';
    if (member.isFinance) return 'finance';
    return 'member';
  }

  /** Throws ForbiddenException if the resolved role isn't in `allowed`. */
  async require(
    crewId: string,
    userId: string,
    allowed: CrewRole[],
    db: CrewRoleDb = this.prisma,
  ): Promise<CrewRole> {
    const role = await this.resolve(crewId, userId, db);
    if (!allowed.includes(role)) {
      throw new ForbiddenException({
        message: 'Insufficient role',
        requiredRoles: allowed,
        actualRole: role,
      });
    }
    return role;
  }
}
