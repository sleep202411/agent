/**
 * Crew invite links — "anyone with this link can join", the counterpart to the
 * named invitation flow in CrewInvitationsService.
 *
 * The link is a bearer secret: only `sha256(token)` is stored and the raw token
 * is returned exactly once, at creation. Access is fixed when the link is
 * minted, so a link can never widen someone's permissions later. One table and
 * one token route serve every access choice: member links redeem through
 * `joinCrewInTransaction`, while community links join only the public community conversation.
 *
 * Usability is decided under a row lock: expiry, revocation and the use cap are
 * all read inside the same transaction that grants access, so two people
 * redeeming the last use cannot both win. Reopening a redeemed link is a no-op,
 * not a consumed use — that is what the redemption row's unique (link, user)
 * pair buys.
 */
import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewInviteLinkKind,
  CrewMembershipStatus,
  Prisma,
  type CrewInviteLink,
  type Message,
} from '@prisma/client';
import type { AuthUser } from '../../auth';
import { ConversationsService } from '../../conversations/conversations.service';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification';
import { generateInviteToken } from '../../sharing/invite-token';
import { CrewCollaborationService } from '../collaboration/crew-collaboration.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import type { CreateCrewInviteLinkInput } from '../dto';
import { resolveCrewLogoUrl } from '../mappers';
import { joinCrewInTransaction } from './join-crew';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CrewInviteLinkState =
  | 'active'
  | 'revoked'
  | 'expired'
  | 'exhausted';

export interface CrewInviteLinkDTO {
  id: string;
  crewId: string;
  kind: 'member' | 'community';
  policyKeys: string[];
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
  createdByUserId: string;
  state: CrewInviteLinkState;
}

/** Effective state — derived, never trusted from a stored status column. */
export function crewInviteLinkState(
  link: Pick<
    CrewInviteLink,
    'revokedAt' | 'expiresAt' | 'maxUses' | 'useCount'
  >,
  now: Date = new Date(),
): CrewInviteLinkState {
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  if (link.maxUses !== null && link.useCount >= link.maxUses) {
    return 'exhausted';
  }
  return 'active';
}

function toDTO(link: CrewInviteLink): CrewInviteLinkDTO {
  return {
    id: link.id,
    crewId: link.crewId,
    kind: link.kind,
    policyKeys: link.policyKeys,
    maxUses: link.maxUses,
    useCount: link.useCount,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
    createdByUserId: link.createdByUserId,
    state: crewInviteLinkState(link),
  };
}

@Injectable()
export class CrewInviteLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly conversations: ConversationsService,
    private readonly collaboration: CrewCollaborationService,
    private readonly notifications: NotificationService,
  ) {}

  /** Mint a link. The raw token is returned here and nowhere else, ever. */
  async create(
    crewId: string,
    userId: string,
    input: CreateCrewInviteLinkInput,
  ): Promise<CrewInviteLinkDTO & { token: string }> {
    await this.requireCrew(crewId);
    const actor = await this.authorization.require(
      crewId,
      userId,
      'members.invite',
    );
    const kind =
      input.kind === 'community'
        ? CrewInviteLinkKind.community
        : CrewInviteLinkKind.member;
    const policyKeys =
      kind === CrewInviteLinkKind.community ? [] : input.policyKeys;
    // Granting access you do not administer yourself would let an inviter
    // escalate through a link; the named-invitation path guards the same way.
    if (policyKeys.length > 0) {
      await this.authorization.require(
        crewId,
        userId,
        'members.permissions.manage',
      );
    }

    const { token, tokenHash } = generateInviteToken();
    const link = await this.prisma.crewInviteLink.create({
      data: {
        crewId,
        kind,
        tokenHash,
        policyKeys,
        createdByUserId: userId,
        maxUses: input.maxUses ?? null,
        expiresAt:
          input.expiresInDays == null
            ? null
            : new Date(Date.now() + input.expiresInDays * MS_PER_DAY),
      },
    });
    await this.prisma.crewAuthorizationEvent.create({
      data: {
        crewId,
        actorMemberId: actor.memberId,
        actorUserId: userId,
        action: 'invite_link.created',
        after: {
          linkId: link.id,
          kind,
          policyKeys,
          maxUses: link.maxUses,
          expiresAt: link.expiresAt?.toISOString() ?? null,
        },
      },
    });
    return { ...toDTO(link), token };
  }

  /** Crew-side management view. Never returns a token or a hash. */
  async list(crewId: string, userId: string): Promise<CrewInviteLinkDTO[]> {
    await this.authorization.require(crewId, userId, 'members.invite');
    const links = await this.prisma.crewInviteLink.findMany({
      where: {
        crewId,
        kind: CrewInviteLinkKind.member,
        revokedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return links.map(toDTO);
  }

  async revoke(crewId: string, userId: string, linkId: string): Promise<void> {
    const actor = await this.authorization.require(
      crewId,
      userId,
      'members.invite',
    );
    const link = await this.prisma.crewInviteLink.findFirst({
      where: { id: linkId, crewId, revokedAt: null },
    });
    if (!link) {
      throw new NotFoundException({
        message: 'Invite link not found or already revoked.',
      });
    }
    await this.prisma.crewInviteLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date(), revokedByUserId: userId },
    });
    await this.prisma.crewAuthorizationEvent.create({
      data: {
        crewId,
        actorMemberId: actor.memberId,
        actorUserId: userId,
        action: 'invite_link.revoked',
        after: { linkId, kind: link.kind, useCount: link.useCount },
      },
    });
  }

  /** Scope-agnostic resolver for InvitesController. Any state. */
  findByHash(tokenHash: string) {
    return this.prisma.crewInviteLink.findUnique({ where: { tokenHash } });
  }

  /** What a visitor may see before signing in — crew identity and nothing else. */
  async preview(link: CrewInviteLink) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: link.crewId, deletedAt: null },
      select: { id: true, name: true, logo: true, tagline: true },
    });
    const memberCount = crew
      ? await this.prisma.crewMember.count({
          where: {
            crewId: link.crewId,
            status: CrewMembershipStatus.active,
          },
        })
      : 0;
    return {
      scope:
        link.kind === CrewInviteLinkKind.community
          ? ('crew_community' as const)
          : ('crew' as const),
      crewId: link.crewId,
      targetName: crew?.name ?? 'a crew',
      logo: crew?.logo ? resolveCrewLogoUrl(crew.logo) : null,
      tagline: crew?.tagline ?? null,
      memberCount,
      // A crew that was deleted after the link went out reads as expired
      // rather than leaking that the id ever existed.
      status: crew ? crewInviteLinkState(link) : 'expired',
      expiresAt: link.expiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Join through the link. Redemption is idempotent per account, so reopening
   * the same link never consumes another use.
   */
  async accept(
    link: CrewInviteLink,
    user: AuthUser,
  ): Promise<
    | {
        scope: 'crew';
        crewId: string;
        memberId: string;
        targetName: string;
        workspaceHref: string;
      }
    | {
        scope: 'crew_community';
        crewId: string;
        conversationId: string;
        targetName: string;
        channelHref: string;
      }
  > {
    if (link.kind === CrewInviteLinkKind.community) {
      return this.acceptCommunity(link, user);
    }
    const crew = await this.requireCrew(link.crewId);
    const pendingMessages: Message[] = [];

    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize redemptions of THIS link so the use cap is honest under
      // concurrency; the row lock also fences a revoke landing mid-join.
      const locked = await tx.$queryRaw<
        {
          revoked_at: Date | null;
          expires_at: Date | null;
          max_uses: number | null;
          use_count: number;
        }[]
      >`SELECT revoked_at, expires_at, max_uses, use_count
          FROM crew_invite_links WHERE id = ${link.id}::uuid FOR UPDATE`;
      const row = locked[0];
      if (!row) {
        throw new NotFoundException({
          message: 'This invite link is invalid.',
        });
      }

      const already = await tx.crewInviteLinkRedemption.findUnique({
        where: { linkId_userId: { linkId: link.id, userId: user.userId } },
      });
      if (already?.memberId) {
        const member = await tx.crewMember.findFirst({
          where: {
            id: already.memberId,
            status: {
              in: [CrewMembershipStatus.active, CrewMembershipStatus.suspended],
            },
          },
          select: { id: true },
        });
        if (member) return { memberId: member.id, rejoined: false };
      }

      const state = crewInviteLinkState({
        revokedAt: row.revoked_at,
        expiresAt: row.expires_at,
        maxUses: row.max_uses,
        useCount: row.use_count,
      });
      if (state !== 'active') {
        throw new GoneException({
          code: 'CREW_INVITE_LINK_NOT_ACTIVE',
          message:
            state === 'revoked'
              ? 'This invite link has been revoked.'
              : state === 'expired'
                ? 'This invite link has expired.'
                : 'This invite link has reached its limit.',
        });
      }

      // Someone removed from the crew must not walk back in through an open
      // link; re-admission is an explicit act by someone who can invite.
      const removed = await tx.crewMember.findFirst({
        where: {
          crewId: link.crewId,
          userId: user.userId,
          status: CrewMembershipStatus.removed,
        },
        select: { id: true },
      });
      if (removed) {
        throw new ForbiddenException({
          code: 'CREW_REMOVED_CANNOT_REJOIN',
          message:
            'You were removed from this crew. Ask an owner to invite you again.',
        });
      }

      const joined = await joinCrewInTransaction(
        tx,
        {
          conversations: this.conversations,
          collaboration: this.collaboration,
        },
        {
          crewId: link.crewId,
          userId: user.userId,
          policyKeys: link.policyKeys,
          grantedByUserId: link.createdByUserId,
          action: 'member.joined.invite_link',
          auditAfter: { linkId: link.id },
        },
      );
      pendingMessages.push(joined.systemMessage);

      await tx.crewInviteLinkRedemption.upsert({
        where: { linkId_userId: { linkId: link.id, userId: user.userId } },
        create: {
          linkId: link.id,
          userId: user.userId,
          memberId: joined.memberId,
        },
        update: { memberId: joined.memberId },
      });
      await tx.crewInviteLink.update({
        where: { id: link.id },
        data: { useCount: { increment: 1 } },
      });
      return { memberId: joined.memberId, rejoined: true };
    });

    for (const message of pendingMessages) {
      await this.conversations.broadcastMessage(message);
    }
    if (result.rejoined) {
      await this.notifications.send({
        userId: link.createdByUserId,
        type: 'crew.invitation.accepted',
        title: 'Someone joined through your link',
        body: `A new member joined "${crew.name}".`,
        meta: {
          crewId: link.crewId,
          crewName: crew.name,
          userId: user.userId,
          inviteLinkId: link.id,
          deeplink: `/crews/${link.crewId}/workspace?tab=members`,
        },
        idempotencyKey: `crew.invite_link.accepted:${link.id}:${user.userId}`,
      });
    }
    return {
      scope: 'crew',
      crewId: link.crewId,
      memberId: result.memberId,
      targetName: crew.name,
      workspaceHref: `/crews/${link.crewId}/workspace`,
    };
  }

  /** Redeem a community link without creating or mutating a crew membership. */
  private async acceptCommunity(
    link: CrewInviteLink,
    user: AuthUser,
  ): Promise<{
    scope: 'crew_community';
    crewId: string;
    conversationId: string;
    targetName: string;
    channelHref: string;
  }> {
    const crew = await this.requireCrew(link.crewId);
    const conversationId = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        {
          kind: CrewInviteLinkKind;
          revoked_at: Date | null;
          expires_at: Date | null;
          max_uses: number | null;
          use_count: number;
        }[]
      >`SELECT kind, revoked_at, expires_at, max_uses, use_count
          FROM crew_invite_links WHERE id = ${link.id}::uuid FOR UPDATE`;
      const row = locked[0];
      if (!row || row.kind !== CrewInviteLinkKind.community) {
        throw new NotFoundException({
          message: 'This community invitation link is invalid.',
        });
      }

      const already = await tx.crewInviteLinkRedemption.findUnique({
        where: { linkId_userId: { linkId: link.id, userId: user.userId } },
      });
      if (already) {
        return (
          await this.conversations.joinCrewCommunityConversation(
            link.crewId,
            user.userId,
            tx,
          )
        ).id;
      }

      const state = crewInviteLinkState({
        revokedAt: row.revoked_at,
        expiresAt: row.expires_at,
        maxUses: row.max_uses,
        useCount: row.use_count,
      });
      if (state !== 'active') {
        throw new GoneException({
          code: 'CREW_COMMUNITY_INVITE_LINK_NOT_ACTIVE',
          message:
            state === 'revoked'
              ? 'This community invitation link has been revoked.'
              : state === 'expired'
                ? 'This community invitation link has expired.'
                : 'This community invitation link has reached its limit.',
        });
      }

      const conversation =
        await this.conversations.joinCrewCommunityConversation(
          link.crewId,
          user.userId,
          tx,
        );
      await tx.crewInviteLinkRedemption.create({
        data: {
          linkId: link.id,
          userId: user.userId,
          memberId: null,
        },
      });
      await tx.crewInviteLink.update({
        where: { id: link.id },
        data: { useCount: { increment: 1 } },
      });
      return conversation.id;
    });

    return {
      scope: 'crew_community',
      crewId: link.crewId,
      conversationId,
      targetName: crew.name,
      channelHref: `/crews/${link.crewId}/workspace?tab=chat&channel=community`,
    };
  }

  private async requireCrew(crewId: string) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
    });
    if (!crew) throw new NotFoundException('Crew not found.');
    return crew;
  }
}

export type { Prisma };
