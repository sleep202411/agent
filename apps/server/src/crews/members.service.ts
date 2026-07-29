/**
 * Member management — list, remove, finance toggle.
 *
 * - List is open to any active member (outsiders can read the public
 *   crew detail but not the member roster).
 * - Joining is invitation-only. This service deliberately has no
 *   direct-add path.
 * - Remove: owner-only. Owner can't remove themselves (would orphan
 *   the crew — delete the crew instead).
 * - Finance toggle: owner-only; flips the `isFinance` flag.
 *
 * Every state change publishes a notification via the outbox with a
 * deterministic idempotency key so retries don't double-notify.
 *
 * Accepting an invitation / removing a member also moves the member in
 * and out of the crew group chat.
 * The participant sync and its `crew.member.joined` / `crew.member.left`
 * system message run INSIDE the same transaction as the membership
 * write, so a chat failure rolls the roster change back rather than
 * leaving someone who can post in a crew they were never added to (or,
 * worse, a removed member still receiving broadcasts). The WS fan-out
 * is deliberately outside — it only runs once the row is committed.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Message as PrismaMessage } from '@prisma/client';
import type { CrewMemberPageDTO, CrewMembershipDTO } from '@repo/shared/crew';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import type { ListCrewMembersQuery, UpdateMemberInput } from './dto';
import { toMemberDTO } from './mappers';
import { CrewCollaborationService } from './collaboration/crew-collaboration.service';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly conversations: ConversationsService,
    private readonly collaboration: CrewCollaborationService,
  ) {}

  async list(
    crewId: string,
    viewerId: string,
    query: ListCrewMembersQuery,
  ): Promise<CrewMemberPageDTO> {
    await this.requireMembership(crewId, viewerId);
    const baseWhere = {
      crewId,
      removedAt: null,
      roleType: { not: 'owner' },
    } satisfies Prisma.CrewMemberWhereInput;
    const cursor = query.cursor
      ? await this.prisma.crewMember.findFirst({
          where: { ...baseWhere, id: query.cursor },
          select: { id: true, joinedAt: true },
        })
      : null;
    if (query.cursor && !cursor) {
      throw new BadRequestException({
        message:
          'The member cursor is invalid for this crew. Restart from the first page.',
      });
    }
    const pageWhere = cursor
      ? {
          ...baseWhere,
          OR: [
            { joinedAt: { gt: cursor.joinedAt } },
            { joinedAt: cursor.joinedAt, id: { gt: cursor.id } },
          ],
        }
      : baseWhere;
    const [owner, total] = await Promise.all([
      query.cursor
        ? null
        : this.prisma.crewMember.findFirst({
            where: { crewId, removedAt: null, roleType: 'owner' },
          }),
      this.prisma.crewMember.count({
        where: { crewId, removedAt: null },
      }),
    ]);
    const capacity = query.limit - (owner ? 1 : 0);
    const rows = await this.prisma.crewMember.findMany({
      where: pageWhere,
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      take: capacity + 1,
    });
    const page = rows.slice(0, capacity);
    return {
      items: [...(owner ? [toMemberDTO(owner)] : []), ...page.map(toMemberDTO)],
      nextCursor:
        rows.length > capacity ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  async membership(crewId: string, userId: string): Promise<CrewMembershipDTO> {
    const crew = await this.requireCrew(crewId);
    const member = await this.prisma.crewMember.findFirst({
      where: { crewId, userId, removedAt: null },
    });
    if (!member) {
      throw new ForbiddenException({
        message: 'You must be a member to view this',
      });
    }
    return {
      role:
        crew.founderId === userId
          ? 'admin'
          : member.isFinance
            ? 'finance'
            : 'member',
      userId,
      member: toMemberDTO(member),
    };
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

    const pendingMessages: PrismaMessage[] = [];
    await this.prisma.$transaction(async (tx) => {
      const conversation = await this.conversations.openCrewConversation(
        crewId,
        tx,
      );
      const removed = await tx.crewMember.updateMany({
        where: { id: memberId, crewId, removedAt: null },
        data: { removedAt: new Date() },
      });
      if (removed.count !== 1) {
        throw new ConflictException({
          message: 'Member was already removed',
        });
      }
      await this.collaboration.removeCrewMemberAccess(
        crewId,
        member.userId,
        tx,
      );
      // `syncCrewParticipant('leave')` deliberately won't conjure a
      // thread, but this crew demonstrably has members, so it is
      // entitled to one — opening here self-heals a crew that predates
      // crew chat and gives the departure notice somewhere to land.
      // Order matters: the participant is marked gone BEFORE the
      // message is written, so the removed member is not a recipient of
      // the announcement of their own removal (doc §6.1 — a removed
      // member must not keep reading or receiving).
      await this.conversations.syncCrewParticipant(
        crewId,
        member.userId,
        'leave',
        tx,
      );
      pendingMessages.push(
        await this.conversations.persistSystem(
          conversation.id,
          'crew.member.left',
          { userId: member.userId },
          tx,
        ),
      );
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
            crewName: crew.name,
          },
          idempotencyKey: `crew.member.removed:${memberId}`,
        },
        tx,
      );
    });
    for (const msg of pendingMessages) {
      await this.conversations.broadcastMessage(msg);
    }
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
