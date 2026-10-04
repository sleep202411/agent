import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewInvitationStatus,
  Prisma,
  type CrewInvitation,
  type Message,
} from '@prisma/client';
import { parsePublicUserId } from '@repo/shared/user-id-codec';
import { isCrewPolicyKey } from '@repo/shared/crew';
import { ConversationsService } from '../../conversations/conversations.service';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification';
import { UsersService } from '../../users/users.service';
import { CrewCollaborationService } from '../collaboration/crew-collaboration.service';
import type {
  CreateCrewInvitationInput,
  ListCrewInvitationsQuery,
} from '../dto';
import { CrewAgreementsService } from '../agreements/agreements.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { joinCrewInTransaction } from './join-crew';

@Injectable()
export class CrewInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly notifications: NotificationService,
    private readonly conversations: ConversationsService,
    private readonly collaboration: CrewCollaborationService,
    private readonly agreements: CrewAgreementsService,
    private readonly authorization: CrewAuthorizationService,
  ) {}

  async listForCrew(
    crewId: string,
    userId: string,
    query: ListCrewInvitationsQuery,
  ) {
    await this.authorization.require(crewId, userId, 'members.invite');
    const now = new Date();
    await this.prisma.crewInvitation.updateMany({
      where: {
        crewId,
        status: CrewInvitationStatus.pending,
        expiresAt: { lte: now },
      },
      data: { status: CrewInvitationStatus.expired },
    });
    const where = {
      crewId,
      status: CrewInvitationStatus.pending,
      expiresAt: { gt: now },
    } satisfies Prisma.CrewInvitationWhereInput;
    const cursor = query.cursor
      ? await this.prisma.crewInvitation.findFirst({
          where: { ...where, id: query.cursor },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !cursor) {
      throw new BadRequestException({
        code: 'CREW_INVITATION_CURSOR_INVALID',
        message:
          'The invitations cursor is invalid for this crew. Restart from the first page.',
      });
    }
    const pageWhere = cursor
      ? {
          ...where,
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : where;
    const [rows, total] = await Promise.all([
      this.prisma.crewInvitation.findMany({
        where: pageWhere,
        include: {
          agreement: { select: { id: true, status: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.prisma.crewInvitation.count({ where }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(invitationDto),
      nextCursor:
        rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  async listMine(userId: string, query: ListCrewInvitationsQuery) {
    await this.expirePending(userId);
    const where = {
      inviteeUserId: userId,
      status: CrewInvitationStatus.pending,
    } satisfies Prisma.CrewInvitationWhereInput;
    const cursor = query.cursor
      ? await this.prisma.crewInvitation.findFirst({
          where: { ...where, id: query.cursor },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !cursor) {
      throw new BadRequestException({
        code: 'CREW_INVITATION_CURSOR_INVALID',
        message:
          'The invitations cursor is invalid for this account. Restart from the first page.',
      });
    }
    const pageWhere = cursor
      ? {
          ...where,
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : where;
    const [rows, total] = await Promise.all([
      this.prisma.crewInvitation.findMany({
        where: pageWhere,
        include: {
          crew: { select: { id: true, name: true, logo: true, tagline: true } },
          agreement: { select: { id: true, status: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.prisma.crewInvitation.count({ where }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((invitation) => ({
        ...invitationDto(invitation),
        crew: invitation.crew,
      })),
      nextCursor:
        rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  async getMine(invitationId: string, userId: string) {
    const invitation = await this.prisma.crewInvitation.findUnique({
      where: { id: invitationId },
      include: {
        crew: { select: { id: true, name: true, logo: true, tagline: true } },
        agreement: { select: { id: true, status: true } },
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.inviteeUserId !== userId) {
      throw new ForbiddenException({
        message: 'This invitation belongs to another account.',
      });
    }
    if (
      invitation.status === CrewInvitationStatus.pending &&
      invitation.expiresAt <= new Date()
    ) {
      await this.prisma.crewInvitation.updateMany({
        where: {
          id: invitation.id,
          status: CrewInvitationStatus.pending,
          expiresAt: { lte: new Date() },
        },
        data: { status: CrewInvitationStatus.expired },
      });
      const expired = await this.prisma.crewInvitation.findUnique({
        where: { id: invitation.id },
        include: {
          crew: { select: { id: true, name: true, logo: true, tagline: true } },
          agreement: { select: { id: true, status: true } },
        },
      });
      if (!expired) throw new NotFoundException('Invitation not found.');
      return { ...invitationDto(expired), crew: expired.crew };
    }
    return { ...invitationDto(invitation), crew: invitation.crew };
  }

  async create(
    crewId: string,
    userId: string,
    cookie: string,
    input: CreateCrewInvitationInput,
  ) {
    const crew = await this.requireCrew(crewId);
    const actor = await this.authorization.require(
      crewId,
      userId,
      'members.invite',
    );
    if (input.positionCategory) {
      await this.authorization.require(crewId, userId, 'members.manage');
    }
    if (input.policyKeys.length > 0) {
      await this.authorization.require(
        crewId,
        userId,
        'members.permissions.manage',
      );
    }
    if (input.agreement) this.agreements.requireDispatchConfigured();
    const rawId =
      input.lookupBy === 'userId' ? parsePublicUserId(input.account) : null;
    if (input.lookupBy === 'userId' && rawId === null) {
      throw new BadRequestException({
        message: 'Invalid User ID',
        field: 'account',
      });
    }
    const target =
      input.lookupBy === 'userId'
        ? await this.users.lookupByUserId(rawId!, cookie, crewId)
        : await this.users.lookupByContact({
            account: input.account,
            cookie,
            checkCrewId: crewId,
          });
    if (!target) {
      throw new NotFoundException({
        message: 'No user matches that input.',
        field: 'account',
      });
    }
    if (target.isCrewMember) {
      throw new BadRequestException({
        message: 'This user is already a crew member.',
      });
    }

    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:invite:${crewId}:${target.userId}`})::bigint)
      `;
      const current = await tx.crewInvitation.findFirst({
        where: {
          crewId,
          inviteeUserId: target.userId,
          status: CrewInvitationStatus.pending,
          expiresAt: { gt: new Date() },
        },
      });
      if (current) {
        throw new ConflictException({
          message: 'A pending invitation already exists for this user.',
        });
      }
      const created = await tx.crewInvitation.create({
        data: {
          crewId,
          inviteeUserId: target.userId,
          invitedByUserId: userId,
          policyKeys: input.policyKeys,
          positionCategory: input.positionCategory,
          agreementTitle: input.agreement?.title,
          agreementSignerName: input.agreement?.signerName,
          agreementSignerEmail: input.agreement?.signerEmail.toLowerCase(),
          expiresAt: new Date(
            Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
          ),
        },
      });
      await this.notifications.send(
        {
          userId: target.userId,
          type: 'crew.invitation.received',
          title: `Invitation to join "${crew.name}"`,
          body: input.agreement
            ? 'You were invited to join the crew. An optional agreement will be sent after you join.'
            : 'You were invited to join the crew.',
          meta: {
            crewId,
            crewName: crew.name,
            invitationId: created.id,
            policyKeys: input.policyKeys,
            agreementRequested: Boolean(input.agreement),
            deeplink: `/crew-invitations/${created.id}`,
          },
          idempotencyKey: `crew.invitation.received:${created.id}`,
        },
        tx,
      );
      await tx.crewAuthorizationEvent.create({
        data: {
          crewId,
          actorMemberId: actor.memberId,
          actorUserId: userId,
          action: 'invitation.created',
          after: {
            invitationId: created.id,
            inviteeUserId: target.userId,
            policyKeys: input.policyKeys,
          },
        },
      });
      return created;
    });
    return invitationDto(invitation);
  }

  async accept(invitationId: string, userId: string) {
    const pendingMessages: Message[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:invitation:${invitationId}`})::bigint)
      `;
      const invitation = await tx.crewInvitation.findUnique({
        where: { id: invitationId },
        include: { crew: true },
      });
      this.requirePendingInvitation(invitation, userId);
      if (invitation.expiresAt <= new Date()) {
        throw new ConflictException({
          message: 'This invitation has expired.',
        });
      }

      // Claim the pending row before granting access. The row lock is held
      // until commit, so decline, revoke and expiry cannot overwrite acceptance.
      const acceptedAt = new Date();
      const claimed = await tx.crewInvitation.updateMany({
        where: {
          id: invitation.id,
          status: CrewInvitationStatus.pending,
          expiresAt: { gt: acceptedAt },
        },
        data: { status: CrewInvitationStatus.accepted, acceptedAt },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          message: 'This invitation is no longer pending or has expired.',
        });
      }

      const joined = await joinCrewInTransaction(
        tx,
        {
          conversations: this.conversations,
          collaboration: this.collaboration,
        },
        {
          crewId: invitation.crewId,
          userId,
          policyKeys: invitation.policyKeys,
          grantedByUserId: invitation.invitedByUserId,
          action: 'member.joined.invitation',
          auditAfter: {
            invitationId: invitation.id,
            positionCategory: invitation.positionCategory ?? null,
          },
        },
      );
      if (invitation.positionCategory) {
        await tx.crewMemberPosition.create({
          data: {
            crewId: invitation.crewId,
            memberId: joined.memberId,
            categoryKey: invitation.positionCategory,
            isPrimary: true,
          },
        });
      }
      pendingMessages.push(joined.systemMessage);
      const agreement = await this.agreements.stageInvitationAgreement(
        invitation,
        tx,
      );
      await this.notifications.send(
        {
          userId: invitation.invitedByUserId,
          type: 'crew.invitation.accepted',
          title: `Invitation accepted`,
          body: `A new member joined "${invitation.crew.name}".`,
          meta: {
            crewId: invitation.crewId,
            crewName: invitation.crew.name,
            userId,
            agreementId: agreement?.id,
            deeplink: `/crews/${invitation.crewId}/workspace?tab=members`,
          },
          idempotencyKey: `crew.invitation.accepted:${invitation.id}`,
        },
        tx,
      );
      return {
        memberId: joined.memberId,
        crewId: invitation.crewId,
        agreement,
      };
    });
    for (const message of pendingMessages) {
      await this.conversations.broadcastMessage(message);
    }
    return {
      crewId: result.crewId,
      memberId: result.memberId,
      accepted: true,
      agreementId: result.agreement?.id ?? null,
      agreementQueued: Boolean(result.agreement),
      workspaceHref: `/crews/${result.crewId}/workspace`,
    };
  }

  async decline(invitationId: string, userId: string) {
    const invitation = await this.prisma.crewInvitation.findUnique({
      where: { id: invitationId },
    });
    this.requirePendingInvitation(invitation, userId);
    const changed = await this.prisma.crewInvitation.updateMany({
      where: { id: invitationId, status: CrewInvitationStatus.pending },
      data: {
        status: CrewInvitationStatus.declined,
        declinedAt: new Date(),
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException({
        message: 'This invitation is no longer pending.',
      });
    }
    return { declined: true };
  }

  async revoke(invitationId: string, userId: string) {
    const invitation = await this.prisma.crewInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    await this.authorization.require(
      invitation.crewId,
      userId,
      'members.invite',
    );
    if (invitation.status !== CrewInvitationStatus.pending) {
      throw new ConflictException({
        message: 'Only a pending invitation can be revoked.',
      });
    }
    const changed = await this.prisma.crewInvitation.updateMany({
      where: { id: invitationId, status: CrewInvitationStatus.pending },
      data: {
        status: CrewInvitationStatus.revoked,
        revokedAt: new Date(),
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException({
        message: 'This invitation is no longer pending.',
      });
    }
    return { revoked: true };
  }

  private async expirePending(userId: string) {
    await this.prisma.crewInvitation.updateMany({
      where: {
        inviteeUserId: userId,
        status: CrewInvitationStatus.pending,
        expiresAt: { lte: new Date() },
      },
      data: { status: CrewInvitationStatus.expired },
    });
  }

  private async requireCrew(crewId: string) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
    });
    if (!crew) throw new NotFoundException('Crew not found.');
    return crew;
  }

  private requirePendingInvitation(
    invitation: {
      inviteeUserId: string;
      status: CrewInvitationStatus;
    } | null,
    userId: string,
  ): asserts invitation is {
    inviteeUserId: string;
    status: CrewInvitationStatus;
  } {
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.inviteeUserId !== userId) {
      throw new ForbiddenException({
        message: 'This invitation belongs to another account.',
      });
    }
    if (invitation.status !== CrewInvitationStatus.pending) {
      throw new ConflictException({
        message: 'This invitation is no longer pending.',
      });
    }
  }
}

function invitationDto(
  invitation: CrewInvitation & {
    agreement?: {
      id: string;
      status: string;
    } | null;
  },
) {
  return {
    id: invitation.id,
    crewId: invitation.crewId,
    inviteeUserId: invitation.inviteeUserId,
    invitedByUserId: invitation.invitedByUserId,
    policyKeys: invitation.policyKeys.filter(isCrewPolicyKey),
    positionCategory: invitation.positionCategory ?? null,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    declinedAt: invitation.declinedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
    agreementRequest:
      invitation.agreementTitle &&
      invitation.agreementSignerName &&
      invitation.agreementSignerEmail
        ? {
            title: invitation.agreementTitle,
            signerName: invitation.agreementSignerName,
            signerEmail: invitation.agreementSignerEmail,
            agreementId: invitation.agreement?.id ?? null,
            status: invitation.agreement?.status ?? null,
          }
        : null,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
  };
}
