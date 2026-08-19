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
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
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
import {
  ConversationsService,
  crewLookupKey,
} from '../conversations/conversations.service';
import { toConversationDTO } from '../conversations/mappers';
import { PrismaService } from '../infra/db/db.module';
import { CrewAuthorizationService } from './crew-authorization.service';
import type {
  CreateCrewInput,
  CreateCrewReportInput,
  UpdateCrewInput,
  UpdateCrewListingInput,
} from './dto';
import { CrewCollaborationService } from './collaboration/crew-collaboration.service';
import { newCrewDomainId, newCrewId } from './id';
import { toAdminCrewDTO, toCrewDTO } from './mappers';
import {
  CREW_PRODUCTION_TEMPLATE_VERSION,
  createDefaultProductionDocument,
  createDefaultProductionPlan,
} from './production/production-document';
import {
  DEFAULT_CREW_TASK_WORKFLOW_STATES,
  defaultCrewTaskView,
} from './tasks/task-defaults';

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
  ) {}

  async create(creatorUserId: string, input: CreateCrewInput) {
    const crew = await this.prisma.$transaction(async (tx) => {
      const productionPlan = createDefaultProductionPlan(
        input.productionTemplateLocale,
      );
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
          createdByUserId: creatorUserId,
          // Product decision (2026-05-21): new crews are public by
          // default so they show up in the Crew Hall immediately —
          // founders can still toggle to `unlisted` later via
          // updateListing(). DB column default is still `unlisted`
          // (kept as the safer fallback if a future caller forgets
          // to pass listingStatus) — set it explicitly here.
          listingStatus: 'listed',
          listedAt: new Date(),
          productionPage: {
            create: {
              document: createDefaultProductionDocument(
                input.productionTemplateLocale,
              ),
              createdByUserId: creatorUserId,
              updatedByUserId: creatorUserId,
            },
          },
          productionActivity: {
            create: {
              kind: 'project_created',
              createdByUserId: creatorUserId,
              payload: {
                productionTemplateVersion: CREW_PRODUCTION_TEMPLATE_VERSION,
                productionTemplateLocale: input.productionTemplateLocale,
              },
            },
          },
        },
      });
      const ownerMember = await tx.crewMember.create({
        data: {
          id: newCrewDomainId(),
          crewId: c.id,
          userId: creatorUserId,
          status: CrewMembershipStatus.active,
          joinedVia: 'creation',
        },
      });
      await tx.crewOwnership.create({
        data: { crewId: c.id, memberId: ownerMember.id },
      });
      const workflowStateIds = new Map(
        DEFAULT_CREW_TASK_WORKFLOW_STATES.map((state) => [
          state.systemKey,
          randomUUID(),
        ]),
      );
      await tx.crewTaskWorkflowState.createMany({
        data: DEFAULT_CREW_TASK_WORKFLOW_STATES.map((state) => ({
          id: workflowStateIds.get(state.systemKey)!,
          crewId: c.id,
          name: state.name,
          color: state.color,
          semantic: state.semantic,
          systemKey: state.systemKey,
          position: state.position,
          createdByUserId: creatorUserId,
        })),
      });
      await tx.crewTaskView.create({
        data: defaultCrewTaskView(c.id, creatorUserId),
      });

      const episodeId = randomUUID();
      await tx.crewEpisode.create({
        data: {
          id: episodeId,
          crewId: c.id,
          number: 1,
          title: productionPlan.episode.title,
          synopsis: productionPlan.episode.synopsis,
          status: 'planned',
          rank: 1024,
          createdByUserId: creatorUserId,
        },
      });

      const initialTasks = productionPlan.tasks.map((task, index) => ({
        id: randomUUID(),
        crewId: c.id,
        number: index + 1,
        title: task.title,
        description: task.description,
        workflowStateId: workflowStateIds.get('open')!,
        priority: 'normal' as const,
        episodeId,
        rank: (index + 1) * 1024,
        createdByUserId: creatorUserId,
      }));
      await tx.crewTask.createMany({ data: initialTasks });
      await tx.crewTaskDependency.createMany({
        data: initialTasks.slice(1).map((task, index) => ({
          crewId: c.id,
          blockingTaskId: initialTasks[index].id,
          blockedTaskId: task.id,
          createdByUserId: creatorUserId,
        })),
      });
      await tx.crewTaskTimelineItem.createMany({
        data: initialTasks.map((task) => ({
          taskId: task.id,
          kind: 'task.created',
          actorUserId: creatorUserId,
          payload: { title: task.title, template: true },
        })),
      });
      // One crew, one group chat — opened with the crew so there is
      // never a window where a member exists without a thread to talk
      // in. No `crew.member.joined` system message here on purpose:
      // the founder joining the crew they just created, into a chat
      // with no other reader, is not an event — the chat's existence
      // already says it. Every LATER join announces itself.
      await this.conversations.openCrewConversation(c.id, tx);
      await this.conversations.syncCrewParticipant(
        c.id,
        creatorUserId,
        'join',
        tx,
      );
      return tx.crew.findUniqueOrThrow({
        where: { id: c.id },
        include: CREW_OWNER_INCLUDE,
      });
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
        moderationStatus: 'ok',
        ...(blockedIds.length ? { id: { notIn: blockedIds } } : {}),
      },
      orderBy: [{ listedAt: 'desc' }, { createdAt: 'desc' }],
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
    const rows = await this.prisma.crew.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
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
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true, moderationStatus: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    const isTakedown = status === 'taken_down';
    const reason = opts.reason?.trim() || null;
    const updated = await this.prisma.crew.update({
      where: { id: crewId },
      data: {
        moderationStatus: status,
        moderatedAt: new Date(),
        moderatedByAdminId: opts.adminId,
        moderationReason: isTakedown ? reason : null,
      },
      include: CREW_OWNER_INCLUDE,
    });
    const counts = await this.countsFor([crewId]);
    return toAdminCrewDTO(updated, counts.members.get(crewId) ?? 0);
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

    const updated = await this.prisma.crew.findUnique({
      where: { id },
      include: CREW_OWNER_INCLUDE,
    });
    if (!updated) throw new NotFoundException('Crew not found');
    return toCrewDTO(updated);
  }

  async updateListing(
    id: string,
    ownerId: string,
    input: UpdateCrewListingInput,
  ) {
    await this.authorization.require(id, ownerId, 'crew.settings.manage');

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

    const updated = await this.prisma.crew.findUnique({
      where: { id },
      include: CREW_OWNER_INCLUDE,
    });
    if (!updated) throw new NotFoundException('Crew not found');
    return toCrewDTO(updated);
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

    const pendingMessages: PrismaMessage[] = [];
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:ownership:${crewId}`})::bigint)
      `;
      const lockedOwner = await tx.crewOwnership.findUnique({
        where: { crewId },
        include: { member: true },
      });
      if (!lockedOwner) throw new NotFoundException('Crew owner not found');

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
        await tx.crew.update({
          where: { id: crewId },
          data: { version: { increment: 1 } },
        });
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
    await this.prisma.crew.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
  }

  /** Founded + joined crews for the current user — drives /profile?tab=crews. */
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
