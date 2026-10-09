import { CrewStudioRevocationService } from './production/crew-studio-revocation.service';
import { joinCrewFanTx } from './fan-community';
/**
 * Crew CRUD — create / list / detail / update / soft delete.
 *
 * Update path uses **optimistic concurrency control** via the
 * `version` column. Callers either:
 *   - supply `expectedVersion` they got from a prior read (recommended
 *     for any owner-facing edit flow) → 409 on mismatch, or
 *   - omit it → straight overwrite (only for system / migration paths).
 *
 * Aggregates (memberCount, openPositionCount, pendingApplicationCount)
 * are joined here so list / detail responses are render-complete in
 * one round trip.
 *
 * The internal crew channel owns one Conversation (`crew:<crewId>`). It is
 * opened in the same transaction that creates the crew, and every
 * membership change made here syncs the matching ConversationParticipant
 * INSIDE that transaction — a failed sync must roll the membership
 * change back, never leave the roster and the chat disagreeing.
 * `conversation()` is the read side of that: the crew workspace's chat
 * panel resolves its team thread there, and a crew that predates crew chat
 * gets one opened on the spot.
 * The public community channel is a separate Conversation (`crew:<crewId>:community`)
 * whose participants are subscribers, not crew members.
 */
import { createCrewTx } from './create-crew';
import { releaseRecruitedPositions } from './recruitment-capacity';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewMembershipStatus,
  type CrewModerationStatus,
  IpReportStatus,
  IpTargetType,
  IpUserBlockTargetType,
  Prisma,
  type Message as PrismaMessage,
} from '@prisma/client';
import type { ConversationDTO } from '@repo/shared/conversation';
import type { AuthUser } from '../auth';
import {
  ConversationsService,
  crewCommunityLookupKey,
  crewLookupKey,
} from '../conversations/conversations.service';
import { toConversationDTO } from '../conversations/mappers';
import { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService } from '../workspaces/wallet-ledger.service';
import { WalletOwnerType } from '@prisma/client';
import { CrewAuthorizationService } from './crew-authorization.service';
import type {
  CreateCrewInput,
  CreateCrewReportInput,
  UpdateCrewInput,
  UpdateCrewListingInput,
} from './dto';
import { CrewCollaborationService } from './collaboration/crew-collaboration.service';
import { newCrewDomainId } from './id';
import { toAdminCrewDTO, toCrewDTO } from './mappers';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const CREW_OWNER_INCLUDE = {
  ownership: { include: { member: { select: { userId: true } } } },
} as const;

@Injectable()
export class CrewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly authorization: CrewAuthorizationService,
    private readonly collaboration: CrewCollaborationService,
    private readonly wallets: WalletLedgerService,
    private readonly studioRevocation: CrewStudioRevocationService,
  ) {}

  creationEligibility(user: AuthUser) {
    return { eligible: Boolean(user.userId) };
  }

  async create(creator: AuthUser, input: CreateCrewInput) {
    const creatorUserId = creator.userId;
    const crew = await this.prisma.$transaction(async (tx) => {
      return createCrewTx(tx, this.conversations, creatorUserId, input);
    });
    if (crew.studioWorkspaceId) {
      await this.wallets.ensureDefaultAccounts(
        WalletOwnerType.workspace,
        crew.studioWorkspaceId,
      );
    }
    return toCrewDTO(crew, {
      memberCount: 1,
      openPositionCount: 0,
      pendingApplicationCount: 0,
    });
  }

  async list(
    opts: { limit?: number; cursor?: string } = {},
    viewerId: string | null = null,
  ) {
    const limit = clampPageSize(opts.limit);
    const blockedIds = await this.blockedCrewIds(viewerId);
    const where: Prisma.CrewWhereInput = {
      deletedAt: null,
      listingStatus: 'listed',
      moderationStatus: 'ok',
      ...(blockedIds.length ? { id: { notIn: blockedIds } } : {}),
    };
    await this.assertListCursor(opts.cursor, where);
    const rows = await this.prisma.crew.findMany({
      where,
      orderBy: [{ listedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: CREW_OWNER_INCLUDE,
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const counts = await this.countsFor(slice.map((c) => c.id));
    return {
      items: slice.map((c) =>
        toCrewDTO(c, {
          memberCount: counts.members.get(c.id) ?? 0,
          openPositionCount: counts.openPositions.get(c.id) ?? 0,
          openPositionPreview: counts.openPositionPreview.get(c.id) ?? [],
        }),
      ),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  }

  private async assertListCursor(
    cursor: string | undefined,
    where: Prisma.CrewWhereInput,
  ) {
    if (!cursor) return;
    const row = await this.prisma.crew.findFirst({
      where: { AND: [where, { id: cursor }] },
      select: { id: true },
    });
    if (!row)
      throw new BadRequestException({
        code: 'CREW_CURSOR_INVALID',
        message:
          'The Crew cursor is invalid for the current filters. Restart from the first page.',
      });
  }

  async detail(id: string, viewerId: string | null) {
    const crew = await this.prisma.crew.findFirst({
      where: { id, deletedAt: null },
      include: CREW_OWNER_INCLUDE,
    });
    if (!crew) throw new NotFoundException('Crew not found');
    // Admin takedown removes the crew from every public surface — even the
    // owner sees a plain 404 (the owner-facing "your crew was taken down"
    // notice is a separate, later concern).
    if (crew.moderationStatus === 'taken_down') {
      throw new NotFoundException('Crew not found');
    }
    if (viewerId && (await this.isCrewBlockedBy(id, viewerId))) {
      throw new NotFoundException('Crew not found');
    }
    if (crew.listingStatus !== 'listed') {
      const canView =
        viewerId !== null &&
        (crew.ownership?.member.userId === viewerId ||
          (await this.isActiveCrewMember(id, viewerId)));
      if (!canView) throw new NotFoundException('Crew not found');
    }

    const counts = await this.countsFor([id]);
    const isOwner =
      viewerId !== null && crew.ownership?.member.userId === viewerId;
    // Pending-application count is owner-only info (exposing it to
    // visitors leaks recruiting velocity).
    const pendingApplicationCount = isOwner
      ? await this.prisma.crewApplication.count({
          where: { crewId: id, status: 'pending' },
        })
      : undefined;
    return toCrewDTO(crew, {
      memberCount: counts.members.get(id) ?? 0,
      openPositionCount: counts.openPositions.get(id) ?? 0,
      openPositionPreview: counts.openPositionPreview.get(id) ?? [],
      pendingApplicationCount,
    });
  }

  /**
   * Admin patrol list — every crew (listed or not, taken down or not), newest
   * first, so a moderator can browse and act. Bypasses all viewer-visibility
   * gates by design; the controller enforces AdminAuthGuard + CrewManage.
   */
  async adminList(opts: {
    q?: string;
    moderationStatus?: CrewModerationStatus;
    limit?: number;
    cursor?: string;
  }) {
    const limit = clampPageSize(opts.limit);
    const q = opts.q?.trim();
    const where: Prisma.CrewWhereInput = {
      deletedAt: null,
      ...(opts.moderationStatus
        ? { moderationStatus: opts.moderationStatus }
        : {}),
      ...(q
        ? { OR: [{ id: q }, { name: { contains: q, mode: 'insensitive' } }] }
        : {}),
    };
    await this.assertListCursor(opts.cursor, where);
    const rows = await this.prisma.crew.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: CREW_OWNER_INCLUDE,
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const counts = await this.countsFor(slice.map((c) => c.id));
    return {
      items: slice.map((c) => toAdminCrewDTO(c, counts.members.get(c.id) ?? 0)),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  }

  /**
   * Set a crew's platform moderation state (takedown / restore). Post-hoc: the
   * crew was live; this pulls it from — or returns it to — every public
   * surface. Stamps the acting admin + reason for the audit trail.
   */
  async setModeration(
    crewId: string,
    status: CrewModerationStatus,
    opts: { adminId: string; reason?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM crews WHERE id=${crewId} FOR UPDATE`;
      const crew = await tx.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: { id: true, moderationStatus: true },
      });
      if (!crew) throw new NotFoundException('Crew not found');
      const isTakedown = status === 'taken_down';
      const reason = opts.reason?.trim() || null;
      const updated = await tx.crew.update({
        where: { id: crewId },
        data: {
          moderationStatus: status,
          moderatedAt: new Date(),
          moderatedByAdminId: opts.adminId,
          moderationReason: isTakedown ? reason : null,
        },
        include: CREW_OWNER_INCLUDE,
      });
      const memberCount = await tx.crewMember.count({
        where: { crewId, status: CrewMembershipStatus.active },
      });
      return toAdminCrewDTO(updated, memberCount);
    });
  }

  /**
   * The crew's internal team chat, resolved for a member.
   *
   * The team channel is fixed — so there is nothing to list or create from
   * the client. The caller hands us a crew id
   * and gets back the same `ConversationDTO` that
   * `GET /aurora/conversations/:id` serves, so every read and write
   * after this one goes through the shared conversations data layer.
   *
   * ### Gate
   *
   * {@link CrewAuthorizationService.resolve} is the single membership and
   * capability predicate. It filters deleted crews and inactive memberships.
   *
   * An outsider gets **404, not 403**. `assertParticipant` and the crew
   * gate inside ConversationsService are deliberately non-probeable —
   * they refuse to confirm that a thread exists — and this endpoint is
   * the front door to exactly those threads. Answering 403 here would
   * hand back the existence bit that every other path withholds.
   *
   * ### Get-or-create, deliberately, on a GET
   *
   * A crew founded before crew chat shipped has members and history but
   * no `crew:<crewId>` row and no participant projection, and nothing in
   * the membership lifecycle will ever create one for a crew whose
   * roster does not change again. Requiring the row to pre-exist would
   * mean 404 forever for those crews — a dead chat tab for the exact
   * users who have the most to talk about. So this resolves the thread
   * the way every other crew-chat entry point already does
   * (`members.service.ts`, `applications.service.ts`,
   * `transferOwnership`): open it if it is missing.
   *
   * `openCrewConversation` is idempotent under an advisory lock, so
   * concurrent opens converge on one row and a repeat call is a single
   * indexed read. The write path only runs when the caller is not
   * already an active participant, which after the first open is never.
   *
   * When it does run it projects the WHOLE active roster, not just the
   * caller: the crews module's contract is that every active member is
   * a participant (see `openCrewConversation`'s docstring), and a chat
   * where only the one member who happened to open it can be broadcast
   * to is not that.
   */
  async conversation(
    crewId: string,
    viewerId: string,
  ): Promise<ConversationDTO> {
    const membership = await this.authorization.resolve(crewId, viewerId);
    if (!membership) throw new NotFoundException('Crew not found');

    const conversationId = await this.resolveCrewChat(crewId, viewerId);
    // Re-reads through the conversations service on purpose: it owns
    // the hydrate (unread count, last message) and re-runs its own crew
    // gate, so this route cannot serve a shape or a permission the
    // conversations surface would not.
    const detail = await this.conversations.detail(conversationId, viewerId);
    return toConversationDTO(detail, viewerId);
  }

  /**
   * Explicitly join a listed Crew's public fan community. This creates only a
   * community participant, never a production-team membership.
   */
  async joinFanCommunity(crewId: string, viewerId: string, recordLike = false) {
    const conversation = await this.prisma.$transaction(async (tx) => {
      const joined = await joinCrewFanTx(
        tx,
        this.conversations,
        crewId,
        viewerId,
      );
      if (recordLike) {
        const origin = await tx.ipCrewOrigin.findFirst({
          where: { crewId },
          select: { ipId: true },
        });
        if (!origin)
          throw new NotFoundException('Link an IP before following this Crew.');
        await tx.$executeRaw`
          INSERT INTO crew_likes (crew_id, user_id) VALUES (${crewId}, ${viewerId})
          ON CONFLICT (crew_id, user_id) DO NOTHING
        `;
      }
      return joined;
    });
    return { conversationId: conversation.id };
  }

  /** Existing members, invitation recipients and public fan participants may read the community. */
  async communityConversation(
    crewId: string,
    viewerId: string,
  ): Promise<ConversationDTO> {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');

    const existing = await this.prisma.conversation.findUnique({
      where: { lookupKey: crewCommunityLookupKey(crewId) },
      select: {
        id: true,
        participants: {
          where: { userId: viewerId, leftAt: null },
          select: { userId: true },
        },
      },
    });

    let conversationId =
      existing?.participants.length === 1 ? existing.id : null;
    if (!conversationId) {
      const membership = await this.authorization.resolve(crewId, viewerId);
      if (!membership)
        throw new NotFoundException('Community channel not found');
      conversationId = (
        await this.conversations.joinCrewCommunityConversation(crewId, viewerId)
      ).id;
    }

    const detail = await this.conversations.detail(conversationId, viewerId);
    return toConversationDTO(detail, viewerId);
  }

  /**
   * Conversation id for a crew's chat, healing the projection if the
   * caller is not in it. See {@link conversation} for why this creates.
   */
  private async resolveCrewChat(
    crewId: string,
    viewerId: string,
  ): Promise<string> {
    const existing = await this.prisma.conversation.findUnique({
      where: { lookupKey: crewLookupKey(crewId) },
      select: {
        id: true,
        participants: {
          where: { userId: viewerId, leftAt: null },
          select: { userId: true },
        },
      },
    });
    if (existing && existing.participants.length > 0) return existing.id;

    return await this.prisma.$transaction(async (tx) => {
      // Re-read the crew first: soft-deleted between the gate and here
      // means the same 404 the gate gives, and finding that out before
      // the advisory lock keeps the failure path from taking one.
      const crew = await tx.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: {
          ownership: { select: { member: { select: { userId: true } } } },
        },
      });
      if (!crew?.ownership) throw new NotFoundException('Crew not found');

      const conv = await this.conversations.openCrewConversation(crewId, tx);
      const roster = await tx.crewMember.findMany({
        where: { crewId, status: CrewMembershipStatus.active },
        select: { userId: true },
      });
      const userIds = new Set([
        crew.ownership.member.userId,
        ...roster.map((m) => m.userId),
      ]);
      for (const userId of userIds) {
        await this.conversations.syncCrewParticipant(
          crewId,
          userId,
          'join',
          tx,
        );
      }
      return conv.id;
    });
  }

  /**
   * Update with optimistic concurrency.
   *
   * `expectedVersion`:
   *   - supplied: write only if the row's current version matches
   *     (Prisma `updateMany` returns count=0 if not). Throws 409.
   *   - omitted: overwrite without check (admin / migration path).
   *
   * On success `version` increments by 1.
   */
  async update(
    id: string,
    ownerId: string,
    input: UpdateCrewInput & { expectedVersion?: number },
  ) {
    await this.authorization.require(id, ownerId, 'crew.settings.manage');

    return this.settingsWrite(id, ownerId, async (tx) => {
      const patch: Prisma.CrewUpdateInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.logo !== undefined ? { logo: input.logo } : {}),
        ...(input.tagline !== undefined ? { tagline: input.tagline } : {}),
        ...(input.genres !== undefined ? { genres: input.genres } : {}),
        ...(input.styles !== undefined ? { styles: input.styles } : {}),
        ...(input.socialLinks !== undefined
          ? {
              socialLinks:
                input.socialLinks.length > 0
                  ? input.socialLinks
                  : Prisma.DbNull,
            }
          : {}),
        ...(input.showcaseWorks !== undefined
          ? {
              showcaseWorks:
                input.showcaseWorks.length > 0
                  ? input.showcaseWorks
                  : Prisma.DbNull,
            }
          : {}),
        version: { increment: 1 },
      };

      if (input.expectedVersion !== undefined) {
        const r = await tx.crew.updateMany({
          where: { id, version: input.expectedVersion, deletedAt: null },
          data: patch,
        });
        if (r.count === 0) {
          // Distinguish "row gone" from "version stale".
          const current = await tx.crew.findUnique({
            where: { id },
            select: { version: true, deletedAt: true },
          });
          if (!current || current.deletedAt)
            throw new NotFoundException('Crew not found');
          throw new ConflictException({
            message: 'Crew was modified by someone else; refresh and retry',
            expectedVersion: input.expectedVersion,
            actualVersion: current.version,
          });
        }
      } else {
        await tx.crew.update({ where: { id }, data: patch });
      }

      const updated = await tx.crew.findUnique({
        where: { id },
        include: CREW_OWNER_INCLUDE,
      });
      if (!updated) throw new NotFoundException('Crew not found');
      return toCrewDTO(updated);
    });
  }

  async updateListing(
    id: string,
    ownerId: string,
    input: UpdateCrewListingInput,
  ) {
    await this.authorization.require(id, ownerId, 'crew.settings.manage');

    return this.settingsWrite(id, ownerId, async (tx) => {
      const data: Prisma.CrewUpdateInput = {
        listingStatus: input.listingStatus,
        listedAt: input.listingStatus === 'listed' ? new Date() : null,
        version: { increment: 1 },
      };

      if (input.expectedVersion !== undefined) {
        const r = await tx.crew.updateMany({
          where: { id, version: input.expectedVersion, deletedAt: null },
          data,
        });
        if (r.count === 0) {
          const current = await tx.crew.findUnique({
            where: { id },
            select: { version: true, deletedAt: true },
          });
          if (!current || current.deletedAt)
            throw new NotFoundException('Crew not found');
          throw new ConflictException({
            message: 'Crew was modified by someone else; refresh and retry',
            expectedVersion: input.expectedVersion,
            actualVersion: current.version,
          });
        }
      } else {
        await tx.crew.update({ where: { id }, data });
      }

      const updated = await tx.crew.findUnique({
        where: { id },
        include: CREW_OWNER_INCLUDE,
      });
      if (!updated) throw new NotFoundException('Crew not found');
      return toCrewDTO(updated);
    });
  }

  private async settingsWrite<T>(
    crewId: string,
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM crews WHERE id=${crewId} FOR UPDATE`;
      await this.authorization.require(
        crewId,
        userId,
        'crew.settings.manage',
        tx,
      );
      const result = await work(tx);
      await this.authorization.require(
        crewId,
        userId,
        'crew.settings.manage',
        tx,
      );
      return result;
    });
  }

  /** Atomically moves the unique CrewOwnership relation and its projections. */
  async transferOwnership(
    crewId: string,
    toUserId: string,
    opts: {
      actor:
        | { type: 'member'; userId: string }
        | { type: 'platform_admin'; actorId: string };
      requireTargetActiveMember?: boolean;
      expectedVersion?: number;
      removeOldOwner?: boolean;
    },
  ) {
    const target = toUserId.trim();
    if (!target) {
      throw new BadRequestException({ message: 'toUserId is required' });
    }

    const actorContext =
      opts.actor.type === 'member'
        ? await this.authorization.require(
            crewId,
            opts.actor.userId,
            'ownership.transfer',
          )
        : null;
    const currentOwner = await this.authorization.owner(crewId);
    if (currentOwner.userId === target) {
      throw new BadRequestException({
        message: 'Target user is already the crew owner',
      });
    }

    let revokedWorkspaceId: string | null = null;
    const pendingMessages: PrismaMessage[] = [];
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:ownership:${crewId}`})::bigint)
      `;
      const currentCrew = await tx.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: { id: true, studioWorkspaceId: true },
      });
      if (!currentCrew) throw new NotFoundException('Crew not found');
      revokedWorkspaceId = currentCrew.studioWorkspaceId;
      const lockedOwner = await tx.crewOwnership.findUnique({
        where: { crewId },
        include: {
          member: {
            include: { positions: { select: { sourcePositionId: true } } },
          },
        },
      });
      if (!lockedOwner) throw new NotFoundException('Crew owner not found');
      if (
        opts.actor.type === 'member' &&
        lockedOwner.member.userId !== opts.actor.userId
      ) {
        throw new ForbiddenException(
          'Crew ownership changed; only the current owner can transfer it.',
        );
      }
      if (lockedOwner.member.userId === target) {
        throw new ConflictException('Target user is already the crew owner.');
      }

      let targetMember = await tx.crewMember.findFirst({
        where: {
          crewId,
          userId: target,
          status: CrewMembershipStatus.active,
        },
      });
      let targetWasCreated = false;
      if (!targetMember) {
        const nonRemoved = await tx.crewMember.findFirst({
          where: {
            crewId,
            userId: target,
            status: { not: CrewMembershipStatus.removed },
          },
          select: { status: true },
        });
        if (nonRemoved) {
          throw new BadRequestException({
            message:
              'Target membership must be active before ownership transfer',
          });
        }
        if (opts.requireTargetActiveMember) {
          throw new BadRequestException({
            message: 'Target user must be an existing active crew member',
          });
        }
        targetMember = await tx.crewMember.create({
          data: {
            id: newCrewDomainId(),
            crewId,
            userId: target,
            status: CrewMembershipStatus.active,
            joinedVia: 'ownership_transfer',
          },
        });
        targetWasCreated = true;
      }

      if (opts.removeOldOwner) {
        await releaseRecruitedPositions(
          tx,
          crewId,
          lockedOwner.member.positions.map((p) => p.sourcePositionId),
        );
      }
      const conversation = await this.conversations.openCrewConversation(
        crewId,
        tx,
      );
      if (opts.expectedVersion !== undefined) {
        const r = await tx.crew.updateMany({
          where: { id: crewId, version: opts.expectedVersion, deletedAt: null },
          data: { version: { increment: 1 } },
        });
        if (r.count === 0) {
          const current = await tx.crew.findUnique({
            where: { id: crewId },
            select: { version: true, deletedAt: true },
          });
          if (!current || current.deletedAt)
            throw new NotFoundException('Crew not found');
          throw new ConflictException({
            message: 'Crew was modified by someone else; refresh and retry',
            expectedVersion: opts.expectedVersion,
            actualVersion: current.version,
          });
        }
      } else {
        const changed = await tx.crew.updateMany({
          where: { id: crewId, deletedAt: null },
          data: { version: { increment: 1 } },
        });
        if (!changed.count) throw new NotFoundException('Crew not found');
      }

      await tx.crewOwnership.update({
        where: { crewId },
        data: { memberId: targetMember.id, acquiredAt: new Date() },
      });

      await tx.crewAuthorizationEvent.create({
        data: {
          crewId,
          memberId: targetMember.id,
          actorMemberId: actorContext?.memberId,
          actorUserId:
            opts.actor.type === 'member'
              ? opts.actor.userId
              : `platform-admin:${opts.actor.actorId}`,
          action: 'ownership.transferred',
          before: {
            memberId: lockedOwner.memberId,
            userId: lockedOwner.member.userId,
          },
          after: { memberId: targetMember.id, userId: target },
        },
      });

      if (opts.removeOldOwner) {
        await tx.crewMember.update({
          where: { id: lockedOwner.memberId },
          data: {
            status: CrewMembershipStatus.removed,
            removedAt: new Date(),
            suspendedAt: null,
            version: { increment: 1 },
          },
        });
        await this.conversations.syncCrewParticipant(
          crewId,
          lockedOwner.member.userId,
          'leave',
          tx,
        );
        pendingMessages.push(
          await this.conversations.persistSystem(
            conversation.id,
            'crew.member.left',
            { userId: lockedOwner.member.userId },
            tx,
          ),
        );
      }

      if (targetWasCreated) {
        await this.conversations.syncCrewParticipant(
          crewId,
          target,
          'join',
          tx,
        );
        pendingMessages.push(
          await this.conversations.persistSystem(
            conversation.id,
            'crew.member.joined',
            { userId: target },
            tx,
          ),
        );
      }

      await this.collaboration.transferCrewOwnershipAccess(
        crewId,
        lockedOwner.member.userId,
        target,
        opts.removeOldOwner === true,
        tx,
      );
    });
    if (revokedWorkspaceId)
      await this.studioRevocation.revoke(
        crewId,
        revokedWorkspaceId,
        currentOwner.userId,
      );
    // WS fan-out only after the transfer has actually committed.
    for (const m of pendingMessages) {
      await this.conversations.broadcastMessage(m);
    }

    const updated = await this.prisma.crew.findUnique({
      where: { id: crewId },
      include: CREW_OWNER_INCLUDE,
    });
    if (!updated) throw new NotFoundException('Crew not found');
    return toCrewDTO(updated);
  }

  async softDelete(id: string, ownerId: string): Promise<void> {
    await this.authorization.require(id, ownerId, 'crew.delete');
    const crew = await this.prisma.crew.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (crew.studioWorkspaceId)
      await this.studioRevocation.revoke(id, crew.studioWorkspaceId);
  }

  /** Production memberships and separate fan subscriptions for the current user. */
  async myCrews(userId: string) {
    const memberships = await this.prisma.crewMember.findMany({
      where: {
        userId,
        status: CrewMembershipStatus.active,
        crew: { deletedAt: null },
      },
      orderBy: { joinedAt: 'desc' },
      include: {
        ownership: true,
        crew: { include: CREW_OWNER_INCLUDE },
      },
    });
    const crews = memberships.map((m) => m.crew);
    const counts = await this.countsFor(crews.map((c) => c.id));
    const pending = await this.prisma.crewApplication.groupBy({
      by: ['crewId'],
      where: { status: 'pending', crewId: { in: crews.map((c) => c.id) } },
      _count: { _all: true },
    });
    const pendingByCrew = new Map<string, number>();
    for (const p of pending) pendingByCrew.set(p.crewId, p._count._all);

    const founded: ReturnType<typeof toCrewDTO>[] = [];
    const joined: ReturnType<typeof toCrewDTO>[] = [];
    for (const m of memberships) {
      const dto = toCrewDTO(m.crew, {
        memberCount: counts.members.get(m.crew.id) ?? 0,
        openPositionCount: counts.openPositions.get(m.crew.id) ?? 0,
        openPositionPreview: counts.openPositionPreview.get(m.crew.id) ?? [],
        ...(m.ownership
          ? { pendingApplicationCount: pendingByCrew.get(m.crew.id) ?? 0 }
          : {}),
      });
      if (m.ownership) founded.push(dto);
      else joined.push(dto);
    }
    // A community subscription is discoverable here, but is not a production
    // membership. Keep it separate so clients cannot infer team permissions.
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        leftAt: null,
        conversation: { contextType: 'crew', crewChannel: 'community' },
      },
      select: { conversation: { select: { contextId: true } } },
      orderBy: [{ joinedAt: 'desc' }, { conversationId: 'asc' }],
    });
    const excluded = new Set([
      ...crews.map((crew) => crew.id),
      ...(await this.blockedCrewIds(userId)),
    ]);
    const communityIds = [
      ...new Set(participants.map((p) => p.conversation.contextId)),
    ].filter((id) => !excluded.has(id));
    const communityRows = communityIds.length
      ? await this.prisma.crew.findMany({
          where: {
            id: { in: communityIds },
            deletedAt: null,
            moderationStatus: 'ok',
          },
          include: CREW_OWNER_INCLUDE,
        })
      : [];
    const communityById = new Map(communityRows.map((crew) => [crew.id, crew]));
    const community = communityIds.flatMap((id) => {
      const crew = communityById.get(id);
      return crew ? [toCrewDTO(crew)] : [];
    });
    return { founded, joined, community };
  }

  /**
   * Public crews a given user founded or belongs to — drives the *visitor*
   * view of a creator profile's Crews tab. Only `listed` (publicly visible)
   * crews are returned; the owner's own tab uses myCrews() for the full set
   * (including unlisted). Newest-membership-first.
   */
  async listPublicCreatorCrews(userId: string, viewerId: string | null = null) {
    const memberships = await this.prisma.crewMember.findMany({
      where: {
        userId,
        status: CrewMembershipStatus.active,
        crew: {
          deletedAt: null,
          listingStatus: 'listed',
          moderationStatus: 'ok',
        },
      },
      orderBy: { joinedAt: 'desc' },
      include: { crew: { include: CREW_OWNER_INCLUDE } },
    });
    const blockedIds = new Set(await this.blockedCrewIds(viewerId));
    const crews = memberships
      .map((m) => m.crew)
      .filter((c) => !blockedIds.has(c.id));
    const counts = await this.countsFor(crews.map((c) => c.id));
    return {
      items: crews.map((c) =>
        toCrewDTO(c, {
          memberCount: counts.members.get(c.id) ?? 0,
          openPositionCount: counts.openPositions.get(c.id) ?? 0,
          openPositionPreview: counts.openPositionPreview.get(c.id) ?? [],
        }),
      ),
    };
  }

  // ─── Viewer moderation — report / block (shared ip_* moderation tables,
  //     targetType 'crew'; admin triages crew reports in the same queue) ───

  async report(
    crewId: string,
    reporterId: string,
    input: CreateCrewReportInput,
  ) {
    await this.assertCrewExists(crewId);
    const report = await this.prisma.ipContentReport.create({
      data: {
        targetType: IpTargetType.crew,
        targetId: crewId,
        reporterUserId: reporterId,
        reason: input.reason,
        status: IpReportStatus.submitted,
        description: input.description,
        metadata: {},
      },
    });
    return {
      report: {
        id: report.id,
        status: report.status,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        createdAt: report.createdAt.toISOString(),
      },
    };
  }

  async block(crewId: string, viewerId: string) {
    await this.assertCrewExists(crewId);
    const block = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:block:${viewerId}:${crewId}`})::bigint)
      `;
      const existing = await tx.ipUserContentBlock.findFirst({
        where: {
          userId: viewerId,
          targetType: IpUserBlockTargetType.crew,
          targetId: crewId,
          unblockedAt: null,
        },
      });
      if (existing) return existing;
      return tx.ipUserContentBlock.create({
        data: {
          userId: viewerId,
          targetType: IpUserBlockTargetType.crew,
          targetId: crewId,
        },
      });
    });
    return { block: crewBlockDto(block) };
  }

  async unblock(crewId: string, viewerId: string) {
    const existing = await this.prisma.ipUserContentBlock.findFirst({
      where: {
        userId: viewerId,
        targetType: IpUserBlockTargetType.crew,
        targetId: crewId,
        unblockedAt: null,
      },
    });
    if (!existing) return { block: null };
    const updated = await this.prisma.ipUserContentBlock.update({
      where: { id: existing.id },
      data: { unblockedAt: new Date() },
    });
    return { block: crewBlockDto(updated) };
  }

  private async assertCrewExists(crewId: string) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
  }

  private async isCrewBlockedBy(crewId: string, viewerId: string) {
    const block = await this.prisma.ipUserContentBlock.findFirst({
      where: {
        userId: viewerId,
        targetType: IpUserBlockTargetType.crew,
        targetId: crewId,
        unblockedAt: null,
      },
      select: { id: true },
    });
    return block !== null;
  }

  private async blockedCrewIds(viewerId: string | null): Promise<string[]> {
    if (!viewerId) return [];
    const blocks = await this.prisma.ipUserContentBlock.findMany({
      where: {
        userId: viewerId,
        targetType: IpUserBlockTargetType.crew,
        unblockedAt: null,
      },
      select: { targetId: true },
    });
    return blocks.map((b) => b.targetId);
  }

  private async isActiveCrewMember(
    crewId: string,
    viewerId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.crewMember.findFirst({
      where: {
        crewId,
        userId: viewerId,
        status: CrewMembershipStatus.active,
      },
      select: { id: true },
    });
    return membership !== null;
  }

  /** Aggregate members + open positions for a batch of crew ids. */
  private async countsFor(ids: string[]) {
    if (ids.length === 0) {
      return {
        members: new Map<string, number>(),
        openPositions: new Map<string, number>(),
        openPositionPreview: new Map<string, string[]>(),
      };
    }
    const [memberRows, positionRows, recentOpenRows] = await Promise.all([
      this.prisma.crewMember.groupBy({
        by: ['crewId'],
        where: {
          crewId: { in: ids },
          status: CrewMembershipStatus.active,
        },
        _count: { _all: true },
      }),
      this.prisma.crewPosition.groupBy({
        by: ['crewId'],
        where: {
          crewId: { in: ids },
          status: 'open',
          deletedAt: null,
          recruitmentVisibility: 'public',
          moderationStatus: 'ok',
        },
        _count: { _all: true },
      }),
      // Preview names for the plaza card — newest 3 open positions
      // per crew, ordered by createdAt desc. Cheap to fetch
      // alongside the counts: server-paginates to ≤3 × N rows.
      this.prisma.crewPosition.findMany({
        where: {
          crewId: { in: ids },
          status: 'open',
          deletedAt: null,
          recruitmentVisibility: 'public',
          moderationStatus: 'ok',
        },
        orderBy: { createdAt: 'desc' },
        select: { crewId: true, positionType: true, createdAt: true },
      }),
    ]);
    const members = new Map<string, number>();
    for (const r of memberRows) members.set(r.crewId, r._count._all);
    const openPositions = new Map<string, number>();
    for (const r of positionRows) openPositions.set(r.crewId, r._count._all);
    const openPositionPreview = new Map<string, string[]>();
    for (const r of recentOpenRows) {
      const cur = openPositionPreview.get(r.crewId);
      if (cur && cur.length >= 3) continue;
      openPositionPreview.set(
        r.crewId,
        cur ? [...cur, r.positionType] : [r.positionType],
      );
    }
    return { members, openPositions, openPositionPreview };
  }
}

function crewBlockDto(block: {
  id: string;
  targetType: IpUserBlockTargetType;
  targetId: string;
  createdAt: Date;
  unblockedAt: Date | null;
}) {
  return {
    id: block.id,
    targetType: block.targetType,
    targetId: block.targetId,
    createdAt: block.createdAt.toISOString(),
    unblockedAt: block.unblockedAt?.toISOString() ?? null,
  };
}

function clampPageSize(n?: number): number {
  if (!n || n <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}
