import { CrewStudioRevocationService } from './production/crew-studio-revocation.service';
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
import { releaseRecruitedPositions } from './recruitment-capacity';

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
    private readonly studioRevocation: CrewStudioRevocationService,
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
    let revokedWorkspaceId: string | null = null;
    let revokedUserId: string | null = null;
    const pendingMessages: PrismaMessage[] = [];
    await this.prisma.$transaction(async (tx) => {
      // Serialize with ownership transfer and member edits before checking the owner.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:ownership:${crewId}`})::bigint)
      `;
      const actor = await this.authorization.require(
        crewId,
        actorUserId,
        'members.manage',
        tx,
      );
      const crew = await this.requireCrew(crewId, tx);
      const member = await tx.crewMember.findFirst({
        where: { id: memberId, crewId, status: CrewMembershipStatus.active },
        include: {
          ownership: true,
          positions: { select: { sourcePositionId: true } },
        },
      });
      if (!member) throw new NotFoundException('Member not found');
      if (member.ownership) {
        throw new BadRequestException({
          message: 'Transfer ownership before removing the crew owner.',
        });
      }
      // Recruitment approvals lock the vacancy before opening the conversation.
      await releaseRecruitedPositions(
        tx,
        crewId,
        member.positions.map((p) => p.sourcePositionId),
      );
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
      revokedWorkspaceId = crew.studioWorkspaceId;
      revokedUserId = member.userId;
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
    if (revokedWorkspaceId && revokedUserId)
      await this.studioRevocation.revoke(
        crewId,
        revokedWorkspaceId,
        revokedUserId,
      );
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
    let revokeTarget: { workspaceId: string; userId: string } | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:ownership:${crewId}`})::bigint)
      `;
      const changesPositions = input.positions !== undefined;
      const changesAuthorization =
        input.policyKeys !== undefined ||
        input.permissionOverrides !== undefined;
      if (changesPositions) {
        await this.authorization.require(
          crewId,
          actorUserId,
          'members.manage',
          tx,
        );
      }
      const actor = changesAuthorization
        ? await this.authorization.require(
            crewId,
            actorUserId,
            'members.permissions.manage',
            tx,
          )
        : await this.authorization.requireMembership(crewId, actorUserId, tx);

      const before = await tx.crewMember.findFirst({
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

      if (input.positions !== undefined) {
        // Keep recruitment provenance when a title is edited or roles are reordered.
        const remaining = [...before.positions];
        const positions = input.positions.map((position, index) => {
          const match = remaining.findIndex(
            (existing) =>
              existing.categoryKey === (position.categoryKey ?? null) &&
              (existing.categoryKey !== null ||
                existing.title === (position.title ?? null)),
          );
          const existing =
            match >= 0 ? remaining.splice(match, 1)[0] : undefined;
          return {
            crewId,
            memberId,
            categoryKey: position.categoryKey ?? null,
            title: position.title ?? null,
            isPrimary: index === 0,
            sourcePositionId: existing?.sourcePositionId ?? null,
          };
        });
        const retained = new Set(
          positions.map((position) => position.sourcePositionId),
        );
        await releaseRecruitedPositions(
          tx,
          crewId,
          remaining
            .map((position) => position.sourcePositionId)
            .filter((id) => !retained.has(id)),
        );
        await tx.crewMemberPosition.deleteMany({ where: { memberId } });
        if (positions.length > 0) {
          await tx.crewMemberPosition.createMany({ data: positions });
        }
      }
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
        const linked = await tx.crew.findFirst({
          where: { id: crewId },
          select: { studioWorkspaceId: true },
        });
        if (linked?.studioWorkspaceId)
          revokeTarget = {
            workspaceId: linked.studioWorkspaceId,
            userId: before.userId,
          };
        await this.collaboration.addCrewMemberAccess(
          crewId,
          before.userId,
          actorUserId,
          tx,
        );
      }
    });

    if (revokeTarget) {
      const target = revokeTarget as { workspaceId: string; userId: string };
      await this.studioRevocation.revoke(
        crewId,
        target.workspaceId,
        target.userId,
      );
    }
    const updated = await this.prisma.crewMember.findUnique({
      where: { id: memberId },
      include: MEMBER_VIEW_INCLUDE,
    });
    if (!updated) throw new NotFoundException('Member not found');
    return toMemberDTO(updated);
  }

  private async requireCrew(
    crewId: string,
    db: Pick<Prisma.TransactionClient, 'crew'> = this.prisma,
  ) {
    const crew = await db.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true, name: true, studioWorkspaceId: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    return crew;
  }
}
