/**
 * Member management — list, manual add, remove, finance toggle.
 *
 * - List is open to any active member (outsiders can read the public
 *   crew detail but not the member roster).
 * - Add: owner-only, must give a userId + roleType (preset position
 *   vocab). Direct INSERT — partial-unique on (crewId, userId) WHERE
 *   removed_at IS NULL permits multiple historical rows.
 * - Remove: owner-only. Owner can't remove themselves (would orphan
 *   the crew — delete the crew instead).
 * - Finance toggle: owner-only; flips the `isFinance` flag.
 *
 * Every state change publishes a notification via the outbox with a
 * deterministic idempotency key so retries don't double-notify.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import type { AddMemberInput, UpdateMemberInput } from './dto';
import { toMemberDTO } from './mappers';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async list(crewId: string, viewerId: string) {
    await this.requireMembership(crewId, viewerId);
    const rows = await this.prisma.crewMember.findMany({
      where: { crewId, removedAt: null },
      orderBy: [{ via: 'asc' }, { joinedAt: 'asc' }],
    });
    return rows.map(toMemberDTO);
  }

  async add(crewId: string, ownerId: string, input: AddMemberInput) {
    const crew = await this.requireCrew(crewId);
    if (crew.founderId !== ownerId) {
      throw new ForbiddenException({
        message: 'Only the crew owner can add members',
      });
    }
    if (input.userId === ownerId) {
      throw new BadRequestException({ message: 'Owner is already a member' });
    }
    const existing = await this.prisma.crewMember.findFirst({
      where: { crewId, userId: input.userId, removedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException({
        message: 'User is already a member of this crew',
      });
    }

    try {
      const member = await this.prisma.$transaction(async (tx) => {
        const m = await tx.crewMember.create({
          data: {
            crewId,
            userId: input.userId,
            roleType: input.roleType,
            via: 'manual',
          },
        });
        await this.notifications.send(
          {
            userId: input.userId,
            type: 'crew.member.added',
            title: `You were added to "${crew.name}"`,
            body: `You're now a ${input.roleType} in this crew.`,
            meta: {
              deeplink: `/crews/${crewId}`,
              crewId,
            },
            idempotencyKey: `crew.member.added:${m.id}`,
          },
          tx,
        );
        return m;
      });
      return toMemberDTO(member);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Raced with another owner-add request; surface as conflict.
        throw new ConflictException({
          message: 'User is already a member of this crew',
        });
      }
      throw err;
    }
  }

  async remove(
    crewId: string,
    memberId: string,
    ownerId: string,
  ): Promise<void> {
    const crew = await this.requireCrew(crewId);
    if (crew.founderId !== ownerId) {
      throw new ForbiddenException({
        message: 'Only the crew owner can remove members',
      });
    }
    const member = await this.prisma.crewMember.findFirst({
      where: { id: memberId, crewId, removedAt: null },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.userId === crew.founderId) {
      throw new BadRequestException({
        message: 'Cannot remove the crew owner — delete the crew instead',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.crewMember.update({
        where: { id: memberId },
        data: { removedAt: new Date() },
      });
      // If the member came through a position, decrement and re-open
      // the slot. Manual adds don't affect any position count.
      if (member.via === 'application' && member.positionId) {
        const pos = await tx.crewPosition.findUnique({
          where: { id: member.positionId },
          select: { recruitedCount: true, targetCount: true, status: true },
        });
        if (pos) {
          const nextCount = Math.max(0, pos.recruitedCount - 1);
          await tx.crewPosition.update({
            where: { id: member.positionId },
            data: {
              recruitedCount: nextCount,
              ...(pos.status === 'full' && nextCount < pos.targetCount
                ? { status: 'open' as const }
                : {}),
            },
          });
        }
      }
      await this.notifications.send(
        {
          userId: member.userId,
          type: 'crew.member.removed',
          title: `Removed from "${crew.name}"`,
          body: 'You are no longer a member of this crew.',
          meta: {
            deeplink: `/crews`,
            crewId,
          },
          idempotencyKey: `crew.member.removed:${memberId}`,
        },
        tx,
      );
    });
  }

  async update(
    crewId: string,
    memberId: string,
    ownerId: string,
    input: UpdateMemberInput,
  ) {
    const crew = await this.requireCrew(crewId);
    if (crew.founderId !== ownerId) {
      throw new ForbiddenException({
        message: 'Only the crew owner can edit members',
      });
    }
    const member = await this.prisma.crewMember.findFirst({
      where: { id: memberId, crewId, removedAt: null },
    });
    if (!member) throw new NotFoundException('Member not found');

    const updated = await this.prisma.crewMember.update({
      where: { id: memberId },
      data: {
        ...(input.isFinance !== undefined
          ? { isFinance: input.isFinance }
          : {}),
      },
    });
    return toMemberDTO(updated);
  }

  private async requireCrew(crewId: string) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true, founderId: true, name: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    return crew;
  }

  private async requireMembership(crewId: string, userId: string) {
    const crew = await this.requireCrew(crewId);
    if (crew.founderId === userId) return;
    const m = await this.prisma.crewMember.findFirst({
      where: { crewId, userId, removedAt: null },
      select: { id: true },
    });
    if (!m)
      throw new ForbiddenException({
        message: 'You must be a member to view this',
      });
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string };
  return e.code === 'P2002';
}
