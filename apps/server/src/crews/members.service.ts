import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewMembershipStatus,
  Prisma,
  type Message as PrismaMessage,
} from '@prisma/client';
import type { CrewMemberPageDTO, CrewMembershipDTO } from '@repo/shared/crew';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import { CrewCollaborationService } from './collaboration/crew-collaboration.service';
import { CrewAuthorizationService } from './crew-authorization.service';
import type { ListCrewMembersQuery, UpdateMemberInput } from './dto';
import { toMemberDTO } from './mappers';

const MEMBER_VIEW_INCLUDE = {
  ownership: true,
  positions: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  policies: { orderBy: { policyKey: 'asc' } },
} satisfies Prisma.CrewMemberInclude;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly conversations: ConversationsService,
    private readonly collaboration: CrewCollaborationService,
    private readonly authorization: CrewAuthorizationService,
  ) {}

  async list(
    crewId: string,
    viewerId: string,
    query: ListCrewMembersQuery,
  ): Promise<CrewMemberPageDTO> {
    await this.authorization.require(crewId, viewerId, 'members.view');
    const baseWhere = {
      crewId,
      status: CrewMembershipStatus.active,
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
    const [rows, total] = await Promise.all([
      this.prisma.crewMember.findMany({
        where: pageWhere,
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        include: MEMBER_VIEW_INCLUDE,
      }),
      this.prisma.crewMember.count({ where: baseWhere }),
    ]);
    const page = rows.slice(0, query.limit);
    const nextCursor =
      rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null;
    const items = page.map(toMemberDTO);
    if (!query.cursor) {
      items.sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
    }
    return { items, nextCursor, total };
  }

  async membership(crewId: string, userId: string): Promise<CrewMembershipDTO> {
    const context = await this.authorization.requireMembership(crewId, userId);
    const member = await this.prisma.crewMember.findUnique({
      where: { id: context.memberId },
      include: MEMBER_VIEW_INCLUDE,
    });
    if (!member || member.status !== CrewMembershipStatus.active) {
      throw new NotFoundException('Active crew member not found');
    }
    return {
      userId,
      member: toMemberDTO(member),
      permissions: context.permissions,
    };
  }

  async remove(
    crewId: string,
    memberId: string,
    actorUserId: string,
  ): Promise<void> {
    const actor = await this.authorization.require(
      crewId,
      actorUserId,
      'members.manage',
    );
    const [crew, member] = await Promise.all([
      this.requireCrew(crewId),
      this.prisma.crewMember.findFirst({
        where: { id: memberId, crewId, status: CrewMembershipStatus.active },
        include: {
          ownership: true,
          positions: { select: { sourcePositionId: true } },
        },
      }),
    ]);
    if (!member) throw new NotFoundException('Member not found');
    if (member.ownership) {
      throw new BadRequestException({
        message: 'Transfer ownership before removing the crew owner.',
      });
    }

    const pendingMessages: PrismaMessage[] = [];
    await this.prisma.$transaction(async (tx) => {
      const conversation = await this.conversations.openCrewConversation(
        crewId,
        tx,
      );
      const removed = await tx.crewMember.updateMany({
        where: {
          id: memberId,
          crewId,
          status: CrewMembershipStatus.active,
        },
        data: {
          status: CrewMembershipStatus.removed,
          removedAt: new Date(),
          suspendedAt: null,
          version: { increment: 1 },
        },
      });
      if (removed.count !== 1) {
        throw new ConflictException({ message: 'Member was already removed' });
      }
      await tx.crewAuthorizationEvent.create({
        data: {
          crewId,
          memberId,
          actorMemberId: actor.memberId,
          actorUserId,
          action: 'member.removed',
          before: { status: CrewMembershipStatus.active },
          after: { status: CrewMembershipStatus.removed },
        },
      });
      await this.collaboration.removeCrewMemberAccess(
        crewId,
        member.userId,
        tx,
      );
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

      const sourcePositionIds = [
        ...new Set(
          member.positions
            .map((position) => position.sourcePositionId)
            .filter((id): id is string => id !== null),
        ),
      ];
      for (const positionId of sourcePositionIds) {
        const position = await tx.crewPosition.findUnique({
          where: { id: positionId },
          select: { recruitedCount: true, targetCount: true, status: true },
        });
        if (!position) continue;
        const recruitedCount = Math.max(0, position.recruitedCount - 1);
        await tx.crewPosition.update({
          where: { id: positionId },
          data: {
            recruitedCount,
            ...(position.status === 'full' &&
            recruitedCount < position.targetCount
              ? { status: 'open' as const }
              : {}),
          },
        });
      }
      await this.notifications.send(
        {
          userId: member.userId,
          type: 'crew.member.removed',
          title: `Removed from "${crew.name}"`,
          body: 'You are no longer a member of this crew.',
          meta: {
            deeplink: '/crews',
            crewId,
            crewName: crew.name,
          },
          idempotencyKey: `crew.member.removed:${memberId}`,
        },
        tx,
      );
    });
    for (const message of pendingMessages) {
      await this.conversations.broadcastMessage(message);
    }
  }

  async update(
    crewId: string,
    memberId: string,
    actorUserId: string,
    input: UpdateMemberInput,
  ) {
    const changesPositions = input.positions !== undefined;
    const changesAuthorization =
      input.policyKeys !== undefined || input.permissionOverrides !== undefined;
    if (changesPositions) {
      await this.authorization.require(crewId, actorUserId, 'members.manage');
    }
    const actor = changesAuthorization
      ? await this.authorization.require(
          crewId,
          actorUserId,
          'members.permissions.manage',
        )
      : await this.authorization.requireMembership(crewId, actorUserId);

    const before = await this.prisma.crewMember.findFirst({
      where: { id: memberId, crewId, status: CrewMembershipStatus.active },
      include: {
        ...MEMBER_VIEW_INCLUDE,
        permissionOverrides: {
          orderBy: { permissionKey: 'asc' },
          select: { permissionKey: true, effect: true },
        },
      },
    });
    if (!before) throw new NotFoundException('Member not found');
    if (
      before.ownership &&
      (input.policyKeys !== undefined ||
        input.permissionOverrides !== undefined)
    ) {
      throw new BadRequestException({
        message: 'The owner already has every crew permission.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.crewMember.updateMany({
        where: {
          id: memberId,
          crewId,
          status: CrewMembershipStatus.active,
          version: input.expectedVersion,
        },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) {
        throw new ConflictException({
          message: 'Member permissions changed; refresh and retry.',
          expectedVersion: input.expectedVersion,
          actualVersion: before.version,
        });
      }

      if (input.positions !== undefined) {
        await tx.crewMemberPosition.deleteMany({ where: { memberId } });
        if (input.positions.length > 0) {
          await tx.crewMemberPosition.createMany({
            data: input.positions.map((position, index) => ({
              crewId,
              memberId,
              categoryKey: position.categoryKey ?? null,
              title: position.title ?? null,
              isPrimary: index === 0,
            })),
          });
        }
      }
      if (input.policyKeys !== undefined) {
        await tx.crewMemberPolicy.deleteMany({ where: { memberId } });
        if (input.policyKeys.length > 0) {
          await tx.crewMemberPolicy.createMany({
            data: input.policyKeys.map((policyKey) => ({
              memberId,
              policyKey,
              assignedByUserId: actorUserId,
            })),
          });
        }
      }
      if (input.permissionOverrides !== undefined) {
        await tx.crewMemberPermissionOverride.deleteMany({
          where: { memberId },
        });
        if (input.permissionOverrides.length > 0) {
          await tx.crewMemberPermissionOverride.createMany({
            data: input.permissionOverrides.map((override) => ({
              memberId,
              permissionKey: override.permissionKey,
              effect: override.effect,
              changedByUserId: actorUserId,
            })),
          });
        }
      }
      await tx.crewAuthorizationEvent.create({
        data: {
          crewId,
          memberId,
          actorMemberId: actor.memberId,
          actorUserId,
          action: changesAuthorization
            ? 'member.authorization.updated'
            : 'member.positions.updated',
          before: {
            positions: before.positions.map((position) => ({
              categoryKey: position.categoryKey,
              title: position.title,
            })),
            policyKeys: before.policies.map((policy) => policy.policyKey),
            permissionOverrides: before.permissionOverrides,
          },
          after: {
            positions: input.positions ?? undefined,
            policyKeys: input.policyKeys ?? undefined,
            permissionOverrides: input.permissionOverrides ?? undefined,
          },
        },
      });
      if (changesAuthorization) {
        await this.collaboration.addCrewMemberAccess(
          crewId,
          before.userId,
          actorUserId,
          tx,
        );
      }
    });

    const updated = await this.prisma.crewMember.findUnique({
      where: { id: memberId },
      include: MEMBER_VIEW_INCLUDE,
    });
    if (!updated) throw new NotFoundException('Member not found');
    return toMemberDTO(updated);
  }

  private async requireCrew(crewId: string) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    return crew;
  }
}
