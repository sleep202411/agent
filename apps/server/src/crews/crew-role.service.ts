/**
 * Centralized role resolution for crew authorization.
 *
 * Every guarded endpoint asks: "what is this user's role in this crew?"
 *   - admin   = the founder
 *   - finance = a member with isFinance = true (can also be admin)
 *   - member  = any active member
 *   - outsider = not a member, not the founder
 */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';

export type CrewRole = 'admin' | 'finance' | 'member' | 'outsider';

@Injectable()
export class CrewRoleService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(crewId: string, userId: string): Promise<CrewRole> {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { founderId: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');

    if (crew.founderId === userId) return 'admin';

    // Active membership only (partial unique on removed_at IS NULL).
    const member = await this.prisma.crewMember.findFirst({
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
  ): Promise<CrewRole> {
    const role = await this.resolve(crewId, userId);
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
