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
 * Crew group chat: one crew = one Conversation (`crew:<crewId>`). It is
 * opened in the same transaction that creates the crew, and every
 * membership change made here syncs the matching ConversationParticipant
 * INSIDE that transaction — a failed sync must roll the membership
 * change back, never leave the roster and the chat disagreeing.
 * `conversation()` is the read side of that: the crew workspace's chat
 * panel resolves its thread there, and a crew that predates crew chat
 * gets one opened on the spot.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IpReportStatus,
  IpTargetType,
  IpUserBlockTargetType,
  Prisma,
  type Message as PrismaMessage,
} from '@prisma/client';
import type { ConversationDTO } from '@repo/shared/conversation';
import {
  ConversationsService,
  crewLookupKey,
} from '../conversations/conversations.service';
import { toConversationDTO } from '../conversations/mappers';
import { PrismaService } from '../infra/db/db.module';
import { CrewRoleService } from './crew-role.service';
import type {
  CreateCrewInput,
  CreateCrewReportInput,
  UpdateCrewInput,
  UpdateCrewListingInput,
} from './dto';
import { CrewCollaborationService } from './collaboration/crew-collaboration.service';
import { newCrewDomainId, newCrewId } from './id';
import { toCrewDTO } from './mappers';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class CrewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly crewRoles: CrewRoleService,
    private readonly collaboration: CrewCollaborationService,
  ) {}

  async create(founderId: string, input: CreateCrewInput) {
    const crew = await this.prisma.$transaction(async (tx) => {
      const c = await tx.crew.create({
        data: {
          id: newCrewId(),
          name: input.name,
          description: input.description,
          logo: input.logo,
          tagline: input.tagline ?? null,
          genres: input.genres,
          styles: input.styles,
          // Empty arrays come through as SQL NULL — Prisma's JsonB
          // column requires Prisma.DbNull for the null literal.
          ...(input.socialLinks.length > 0
            ? { socialLinks: input.socialLinks }
            : { socialLinks: Prisma.DbNull }),
          ...(input.showcaseWorks.length > 0
            ? { showcaseWorks: input.showcaseWorks }
            : { showcaseWorks: Prisma.DbNull }),
          founderId,
          // Product decision (2026-05-21): new crews are public by
          // default so they show up in the Crew Hall immediately —
          // founders can still toggle to `unlisted` later via
          // updateListing(). DB column default is still `unlisted`
          // (kept as the safer fallback if a future caller forgets
          // to pass listingStatus) — set it explicitly here.
          listingStatus: 'listed',
          listedAt: new Date(),
        },
      });
      // Founder is the first crew member with role "owner". Keeps
      // `crew_members` the single source of truth for "who's in this
      // crew" — no special-casing the founder elsewhere.
      await tx.crewMember.create({
        data: {
          id: newCrewDomainId(),
          crewId: c.id,
          userId: founderId,
          roleType: 'owner',
          via: 'founder',
        },
      });
      // One crew, one group chat — opened with the crew so there is
      // never a window where a member exists without a thread to talk
      // in. No `crew.member.joined` system message here on purpose:
      // the founder joining the crew they just created, into a chat
      // with no other reader, is not an event — the chat's existence
      // already says it. Every LATER join announces itself.
      await this.conversations.openCrewConversation(c.id, tx);
      await this.conversations.syncCrewParticipant(c.id, founderId, 'join', tx);
      return c;
    });
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
    const rows = await this.prisma.crew.findMany({
      where: {
        deletedAt: null,
        listingStatus: 'listed',
        ...(blockedIds.length ? { id: { notIn: blockedIds } } : {}),
      },
      orderBy: [{ listedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
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

  async detail(id: string, viewerId: string | null) {
    const crew = await this.prisma.crew.findFirst({
      where: { id, deletedAt: null },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    if (viewerId && (await this.isCrewBlockedBy(id, viewerId))) {
      throw new NotFoundException('Crew not found');
    }
    if (crew.listingStatus !== 'listed') {
      const canView =
        viewerId !== null &&
        (crew.founderId === viewerId ||
          (await this.isActiveCrewMember(id, viewerId)));
      if (!canView) throw new NotFoundException('Crew not found');
    }

    const counts = await this.countsFor([id]);
    const isOwner = viewerId !== null && crew.founderId === viewerId;
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
   * The crew's one group chat, resolved for a member.
   *
   * Doc §3.1: one crew, one conversation — so there is nothing to list
   * and nothing for the client to create. The caller hands us a crew id
   * and gets back the same `ConversationDTO` that
   * `GET /aurora/conversations/:id` serves, so every read and write
   * after this one goes through the shared conversations data layer.
   *
   * ### Gate
   *
   * {@link CrewRoleService.resolve} — the platform's one crew-role
   * predicate, founder short-circuit included: `founderId` grants
   * access before `crew_members` is ever read, so a founder whose
   * membership row an ownership transfer removed is not locked out of
   * their own crew's chat. It filters `deletedAt: null`, so a
   * soft-deleted crew is a 404 for everyone including its founder.
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
   * to is not that. `founderId` is unioned in explicitly for the same
   * reason the gate short-circuits on it.
   */
  async conversation(
    crewId: string,
    viewerId: string,
  ): Promise<ConversationDTO> {
    const role = await this.crewRoles.resolve(crewId, viewerId);
    if (role === 'outsider') throw new NotFoundException('Crew not found');

    const conversationId = await this.resolveCrewChat(crewId, viewerId);
    // Re-reads through the conversations service on purpose: it owns
    // the hydrate (unread count, last message) and re-runs its own crew
    // gate, so this route cannot serve a shape or a permission the
    // conversations surface would not.
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
        select: { founderId: true },
      });
      if (!crew) throw new NotFoundException('Crew not found');

      const conv = await this.conversations.openCrewConversation(crewId, tx);
      const roster = await tx.crewMember.findMany({
        where: { crewId, removedAt: null },
        select: { userId: true },
      });
      const userIds = new Set([crew.founderId, ...roster.map((m) => m.userId)]);
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
    await this.assertOwner(id, ownerId);

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
              input.socialLinks.length > 0 ? input.socialLinks : Prisma.DbNull,
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
      const r = await this.prisma.crew.updateMany({
        where: { id, version: input.expectedVersion, deletedAt: null },
        data: patch,
      });
      if (r.count === 0) {
        // Distinguish "row gone" from "version stale".
        const current = await this.prisma.crew.findUnique({
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
      await this.prisma.crew.update({ where: { id }, data: patch });
    }

    const updated = await this.prisma.crew.findUnique({ where: { id } });
    if (!updated) throw new NotFoundException('Crew not found');
    return toCrewDTO(updated);
  }

  async updateListing(
    id: string,
    ownerId: string,
    input: UpdateCrewListingInput,
  ) {
    await this.assertOwner(id, ownerId);

    const data: Prisma.CrewUpdateInput = {
      listingStatus: input.listingStatus,
      listedAt: input.listingStatus === 'listed' ? new Date() : null,
      version: { increment: 1 },
    };

    if (input.expectedVersion !== undefined) {
      const r = await this.prisma.crew.updateMany({
        where: { id, version: input.expectedVersion, deletedAt: null },
        data,
      });
      if (r.count === 0) {
        const current = await this.prisma.crew.findUnique({
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
      await this.prisma.crew.update({ where: { id }, data });
    }

    const updated = await this.prisma.crew.findUnique({ where: { id } });
    if (!updated) throw new NotFoundException('Crew not found');
    return toCrewDTO(updated);
  }

  /**
   * Transfer crew ownership to `toUserId`.
   *
   * `founderId` is the single source of truth for owner/admin authority
   * (see {@link CrewRoleService}), so the transfer swaps it and reconciles
   * the `crew_members` "owner" row so the member list stays truthful:
   *   - outgoing owner: demoted to a normal member (default) or removed
   *     from the crew (`opts.removeOldOwner`);
   *   - incoming owner: their active membership is promoted to `owner`, or
   *     a fresh `owner` member row is created if they weren't a member.
   *
   * Permission-agnostic by design — the caller decides who may invoke it:
   *   - the admin path passes no `requireCurrentFounderId` (act on any crew);
   *   - a future self-service path passes the acting user id so a non-owner
   *     can't transfer a crew they don't own.
   *
   * Group-chat projection of a transfer — only membership moves matter,
   * because ConversationParticipant.role is flat `member` for everyone in
   * a crew and never mirrors the crew role:
   *   - outgoing owner, `removeOldOwner` → their membership ends, so they
   *     LEAVE the chat (and a `crew.member.left` system message fires);
   *   - outgoing owner, demoted to `member` → still an active member, so
   *     NOTHING happens to the chat. Syncing a 'leave' here would lock the
   *     demoted founder out of the crew they still belong to;
   *   - incoming owner already an active member → already a participant,
   *     nothing to do;
   *   - incoming owner promoted from outside (admin path) → they JOIN.
   */
  async transferOwnership(
    crewId: string,
    toUserId: string,
    opts: {
      requireCurrentFounderId?: string;
      requireTargetActiveMember?: boolean;
      expectedVersion?: number;
      removeOldOwner?: boolean;
    } = {},
  ) {
    const target = toUserId.trim();
    if (!target) {
      throw new BadRequestException({ message: 'toUserId is required' });
    }

    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { founderId: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');

    if (
      opts.requireCurrentFounderId !== undefined &&
      crew.founderId !== opts.requireCurrentFounderId
    ) {
      throw new ForbiddenException({
        message: 'Only the crew owner can transfer ownership',
      });
    }
    if (crew.founderId === target) {
      throw new BadRequestException({
        message: 'Target user is already the crew owner',
      });
    }

    // Self-service transfers may only hand off to an existing member; the
    // admin path leaves this off so ops can transfer to any user.
    if (opts.requireTargetActiveMember) {
      const isMember = await this.prisma.crewMember.findFirst({
        where: { crewId, userId: target, removedAt: null },
        select: { id: true },
      });
      if (!isMember) {
        throw new BadRequestException({
          message: 'Target user must be an existing crew member',
        });
      }
    }

    const pendingMessages: PrismaMessage[] = [];
    await this.prisma.$transaction(async (tx) => {
      // Idempotent — returns the existing `crew:<crewId>` thread, and
      // opens one for a crew that predates crew chat.
      const conversation = await this.conversations.openCrewConversation(
        crewId,
        tx,
      );

      // 1) founder_id carries the authority — swap it (optimistic if asked).
      if (opts.expectedVersion !== undefined) {
        const r = await tx.crew.updateMany({
          where: { id: crewId, version: opts.expectedVersion, deletedAt: null },
          data: { founderId: target, version: { increment: 1 } },
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
        await tx.crew.update({
          where: { id: crewId },
          data: { founderId: target, version: { increment: 1 } },
        });
      }

      // 2) Reconcile the outgoing owner's membership row.
      const oldOwnerMember = await tx.crewMember.findFirst({
        where: { crewId, userId: crew.founderId, removedAt: null },
        select: { id: true },
      });
      if (oldOwnerMember) {
        await tx.crewMember.update({
          where: { id: oldOwnerMember.id },
          data: opts.removeOldOwner
            ? { removedAt: new Date() }
            : { roleType: 'member' },
        });
        // Only the `removedAt` branch ends the membership. The demote
        // branch keeps them in the crew — and in the chat.
        if (opts.removeOldOwner) {
          await this.conversations.syncCrewParticipant(
            crewId,
            crew.founderId,
            'leave',
            tx,
          );
          pendingMessages.push(
            await this.conversations.persistSystem(
              conversation.id,
              'crew.member.left',
              { userId: crew.founderId },
              tx,
            ),
          );
        }
      }

      // 3) Ensure the incoming owner has an active `owner` member row. The
      //    partial unique (crew_id, user_id) WHERE removed_at IS NULL means
      //    we promote an existing active row rather than insert a duplicate.
      const newOwnerMember = await tx.crewMember.findFirst({
        where: { crewId, userId: target, removedAt: null },
        select: { id: true },
      });
      if (newOwnerMember) {
        await tx.crewMember.update({
          where: { id: newOwnerMember.id },
          data: { roleType: 'owner' },
        });
      } else {
        await tx.crewMember.create({
          data: {
            id: newCrewDomainId(),
            crewId,
            userId: target,
            roleType: 'owner',
            via: 'ownership_transfer',
          },
        });
        // Brand-new membership (admin path can hand a crew to a
        // non-member) — they join the chat like anyone else.
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

      // 4) The crew roster and the Studio authorization graph are one
      //    ownership boundary. Move them in this same transaction so a
      //    successful hand-off can never leave the former owner in control of
      //    the production workspace, or the successor unable to open it.
      await this.collaboration.transferCrewOwnershipAccess(
        crewId,
        crew.founderId,
        target,
        opts.removeOldOwner === true,
        tx,
      );
    });
    // WS fan-out only after the transfer has actually committed.
    for (const m of pendingMessages) {
      await this.conversations.broadcastMessage(m);
    }

    const updated = await this.prisma.crew.findUnique({
      where: { id: crewId },
    });
    if (!updated) throw new NotFoundException('Crew not found');
    return toCrewDTO(updated);
  }

  async softDelete(id: string, ownerId: string): Promise<void> {
    await this.assertOwner(id, ownerId);
    await this.prisma.crew.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
  }

  /** Founded + joined crews for the current user — drives /profile?tab=crews. */
  async myCrews(userId: string) {
    const memberships = await this.prisma.crewMember.findMany({
      where: { userId, removedAt: null, crew: { deletedAt: null } },
      orderBy: { joinedAt: 'desc' },
      include: { crew: true },
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
        ...(m.via === 'founder'
          ? { pendingApplicationCount: pendingByCrew.get(m.crew.id) ?? 0 }
          : {}),
      });
      if (m.via === 'founder') founded.push(dto);
      else joined.push(dto);
    }
    return { founded, joined };
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
        removedAt: null,
        crew: { deletedAt: null, listingStatus: 'listed' },
      },
      orderBy: { joinedAt: 'desc' },
      include: { crew: true },
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

  private async assertOwner(crewId: string, userId: string) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { founderId: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    if (crew.founderId !== userId) {
      throw new ForbiddenException({
        message: 'Only the crew owner can do this',
      });
    }
  }

  private async isActiveCrewMember(
    crewId: string,
    viewerId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.crewMember.findFirst({
      where: { crewId, userId: viewerId, removedAt: null },
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
        where: { crewId: { in: ids }, removedAt: null },
        _count: { _all: true },
      }),
      this.prisma.crewPosition.groupBy({
        by: ['crewId'],
        where: { crewId: { in: ids }, status: 'open', deletedAt: null },
        _count: { _all: true },
      }),
      // Preview names for the plaza card — newest 3 open positions
      // per crew, ordered by createdAt desc. Cheap to fetch
      // alongside the counts: server-paginates to ≤3 × N rows.
      this.prisma.crewPosition.findMany({
        where: { crewId: { in: ids }, status: 'open', deletedAt: null },
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
