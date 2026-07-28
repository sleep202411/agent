/**
 * Member management — list, manual add, remove, finance toggle.
 *
 * - List is open to any active member (outsiders can read the public
 *   crew detail but not the member roster).
 * - Add: owner-only, resolves email/phone server-side before insert.
 *   Direct INSERT — partial-unique on (crewId, userId) WHERE removed_at
 *   IS NULL permits multiple historical rows.
 * - Remove: owner-only. Owner can't remove themselves (would orphan
 *   the crew — delete the crew instead).
 * - Finance toggle: owner-only; flips the `isFinance` flag.
 *
 * Every state change publishes a notification via the outbox with a
 * deterministic idempotency key so retries don't double-notify.
 *
 * Add / remove also move the member in and out of the crew group chat.
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
import type { Message as PrismaMessage } from '@prisma/client';
import { crewChatWritesEnabled } from '../conversations/crew-chat-rollout';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import { UsersService } from '../users/users.service';
import type { AddMemberInput, UpdateMemberInput } from './dto';
import { newCrewDomainId } from './id';
import { toMemberDTO } from './mappers';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly users: UsersService,
    private readonly conversations: ConversationsService,
  ) {}

  async list(crewId: string, viewerId: string) {
    await this.requireMembership(crewId, viewerId);
    const rows = await this.prisma.crewMember.findMany({
      where: { crewId, removedAt: null },
      orderBy: [{ via: 'asc' }, { joinedAt: 'asc' }],
    });
    return rows.map(toMemberDTO);
  }

  async add(
    crewId: string,
    ownerId: string,
    cookie: string,
    input: AddMemberInput,
  ) {
    const crew = await this.requireCrew(crewId);
    if (crew.founderId !== ownerId) {
      throw new ForbiddenException({
        message: 'Only the crew owner can add members',
      });
    }
    const target = await this.users.lookupByContact({
      account: input.account,
      cookie,
      checkCrewId: crewId,
    });
    if (!target) {
      throw new NotFoundException({
        message: 'No user matches that input',
        field: 'account',
      });
    }

    if (target.userId === ownerId || target.isCrewFounder) {
      throw new BadRequestException({ message: 'Owner is already a member' });
    }
    if (target.isCrewMember) {
      throw new BadRequestException({
        message: 'User is already a member of this crew',
      });
    }
    const existing = await this.prisma.crewMember.findFirst({
      where: { crewId, userId: target.userId, removedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException({
        message: 'User is already a member of this crew',
      });
    }

    const chatEnabled = crewChatWritesEnabled();
    const pendingMessages: PrismaMessage[] = [];
    try {
      const member = await this.prisma.$transaction(async (tx) => {
        // Lock order for every legacy-crew membership mutation:
        // conversation advisory lock first, membership row second.
        // Ownership transfer uses the same order; reversing it here
        // can deadlock when the crew has no conversation yet.
        const conversation = chatEnabled
          ? await this.conversations.openCrewConversation(crewId, tx)
          : null;
        const m = await tx.crewMember.create({
          data: {
            id: newCrewDomainId(),
            crewId,
            userId: target.userId,
            roleType: input.roleType,
            via: 'manual',
          },
        });
        if (conversation) {
          await this.conversations.syncCrewParticipant(
            crewId,
            target.userId,
            'join',
            tx,
          );
          pendingMessages.push(
            await this.conversations.persistSystem(
              conversation.id,
              'crew.member.joined',
              { userId: target.userId },
              tx,
            ),
          );
        }
        await this.notifications.send(
          {
            userId: target.userId,
            type: 'crew.member.added',
            title: `You were added to "${crew.name}"`,
            body: `You're now a ${input.roleType} in this crew.`,
            meta: {
              // Owner manually added them; they're already a member,
              // so drop them straight into the workspace where they
              // can act. The crew hall page is more useful for
              // outside visitors deciding whether to apply.
              deeplink: `/crews/${crewId}/workspace`,
              crewId,
            },
            idempotencyKey: `crew.member.added:${m.id}`,
          },
          tx,
        );
        return m;
      });
      for (const msg of pendingMessages) {
        await this.conversations.broadcastMessage(msg);
      }
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

    const chatEnabled = crewChatWritesEnabled();
    const pendingMessages: PrismaMessage[] = [];
    await this.prisma.$transaction(async (tx) => {
      const conversation = chatEnabled
        ? await this.conversations.openCrewConversation(crewId, tx)
        : null;
      const removed = await tx.crewMember.updateMany({
        where: { id: memberId, crewId, removedAt: null },
        data: { removedAt: new Date() },
      });
      if (removed.count !== 1) {
        throw new ConflictException({
          message: 'Member was already removed',
        });
      }
      // `syncCrewParticipant('leave')` deliberately won't conjure a
      // thread, but this crew demonstrably has members, so it is
      // entitled to one — opening here self-heals a crew that predates
      // crew chat and gives the departure notice somewhere to land.
      // Order matters: the participant is marked gone BEFORE the
      // message is written, so the removed member is not a recipient of
      // the announcement of their own removal (doc §6.1 — a removed
      // member must not keep reading or receiving).
      if (conversation) {
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
      }
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

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string };
  return e.code === 'P2002';
}
