/**
 * Assignment + activity-log service — 6 assignment endpoints + activity feed.
 *
 * Every mutation:
 *   1. Resolves the episode + asserts the requester's role.
 *   2. Asserts episode.status !== 'approved' (423 freeze) when applicable.
 *   3. Asserts current assignment status against allowed transitions.
 *   4. Inside a transaction: mutates, writes activity, sends notification
 *      (with deterministic idempotency key), and posts the crew group-chat
 *      system message for the status change.
 *
 * Group-chat projection (doc §6.1 "任务状态系统消息"): the four assignment
 * transitions — assigned / submitted / approved / rejected — each post a
 * `crew.episode.*` system message into the crew thread. Two deliberate
 * omissions:
 *   - `setRevenue` posts NOTHING. Doc §5.3 step 7: the chat shows status
 *     changes and must never publish earnings figures. No status kind
 *     carries an amount either.
 *   - a rejection's `reason` stays out of the params. It is private
 *     feedback to the assignee (it already rides the notification); the
 *     whole crew does not need to read the critique.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Message as PrismaMessage } from '@prisma/client';
import type { SystemMessageKind } from '@repo/shared/conversation';
import { crewChatWritesEnabled } from '../../conversations/crew-chat-rollout';
import { ConversationsService } from '../../conversations/conversations.service';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification';
import { CrewRoleService } from '../crew-role.service';
import {
  assertAllowedCurrency,
  defaultCurrency,
  type CurrencyCode,
} from '../../common/currency';
import { newCrewDomainId } from '../id';
import { toActivityDTO, toAssignmentDTO } from '../mappers';
import { CURRENCY_SYMBOLS, ZERO_DECIMAL_CURRENCIES } from '@repo/shared/crew';
import { writeActivity } from './activity-writer';
import { workspaceDeeplink } from './deeplink';
import type {
  AddAssignmentInput,
  RejectAssignmentInput,
  RevenueInput,
  SubmitAssignmentInput,
} from './dto';

const EPISODE_FROZEN_STATUS = 423;

class EpisodeFrozenException extends HttpException {
  constructor() {
    super(
      { message: 'Episode is approved (frozen)', episodeStatus: 'approved' },
      EPISODE_FROZEN_STATUS,
    );
  }
}

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: CrewRoleService,
    private readonly notifications: NotificationService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Post an assignment status change into the crew group chat, inside
   * the caller's transaction. Returns the persisted message so the
   * caller can broadcast it once the outer tx commits.
   *
   * Params are ids + the episode number only — enough for the client to
   * render a localized line and deeplink to the task. Never an amount.
   */
  private async postAssignmentStatus(
    tx: Prisma.TransactionClient,
    kind: SystemMessageKind,
    ctx: {
      crewId: string;
      episodeId: string;
      episodeNumber: number;
      assignmentId: string;
      userId: string;
    },
  ): Promise<PrismaMessage | null> {
    if (!crewChatWritesEnabled()) return null;
    const conversation = await this.conversations.openCrewConversation(
      ctx.crewId,
      tx,
    );
    return this.conversations.persistSystem(
      conversation.id,
      kind,
      {
        episodeId: ctx.episodeId,
        episodeNumber: ctx.episodeNumber,
        assignmentId: ctx.assignmentId,
        userId: ctx.userId,
      },
      tx,
    );
  }

  /**
   * Every assignment mutation locks in the same order: episode first,
   * assignment second. Episode approval takes the episode lock too, so
   * "freeze" and an in-flight submit/review become a real serial order
   * rather than two stale preflight reads that both succeed.
   */
  private async lockAssignment(
    tx: Prisma.TransactionClient,
    assignmentId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT a.id
      FROM episodes AS e
      JOIN episode_assignments AS a ON a.episode_id = e.id
      WHERE a.id = ${assignmentId}
      FOR UPDATE OF e, a
    `);
    if (rows.length === 0) throw new NotFoundException('Assignment not found');
    return this.requireAssignment(assignmentId, tx);
  }

  /** Episode-only half of the lock order, used while assigning a new row. */
  private async lockEpisode(tx: Prisma.TransactionClient, episodeId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM episodes
      WHERE id = ${episodeId}
      FOR UPDATE
    `);
    if (rows.length === 0) throw new NotFoundException('Episode not found');
    return this.requireEpisode(episodeId, tx);
  }

  async list(episodeId: string, viewerId: string) {
    const episode = await this.requireEpisode(episodeId);
    await this.roles.require(episode.crewId, viewerId, [
      'admin',
      'finance',
      'member',
    ]);
    const rows = await this.prisma.episodeAssignment.findMany({
      where: { episodeId },
      orderBy: { id: 'asc' },
    });
    return rows.map(toAssignmentDTO);
  }

  /** One compact query powers the workspace's "My tasks" filter. */
  async listMine(crewId: string, viewerId: string) {
    await this.roles.require(crewId, viewerId, ['admin', 'finance', 'member']);
    const rows = await this.prisma.episodeAssignment.findMany({
      where: { crewId, userId: viewerId },
      orderBy: [{ episode: { number: 'asc' } }, { id: 'asc' }],
    });
    return rows.map(toAssignmentDTO);
  }

  async listActivity(
    episodeId: string,
    viewerId: string,
    page = 1,
    pageSize = 50,
  ) {
    const episode = await this.requireEpisode(episodeId);
    await this.roles.require(episode.crewId, viewerId, [
      'admin',
      'finance',
      'member',
    ]);
    const safePage = Math.max(1, page);
    const safeSize = Math.min(Math.max(1, pageSize), 100);
    const [items, total] = await Promise.all([
      this.prisma.episodeActivity.findMany({
        where: { episodeId },
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.episodeActivity.count({ where: { episodeId } }),
    ]);
    return {
      items: items.map(toActivityDTO),
      page: safePage,
      pageSize: safeSize,
      total,
    };
  }

  // ─── Mutations ────────────────────────────────────────────

  async add(
    episodeId: string,
    actorId: string,
    actorName: string,
    input: AddAssignmentInput,
  ) {
    const episode = await this.requireEpisode(episodeId);
    await this.roles.require(episode.crewId, actorId, ['admin']);
    if (episode.status === 'approved') throw new EpisodeFrozenException();

    const assigneeIsMember = await this.prisma.crewMember.findFirst({
      where: { crewId: episode.crewId, userId: input.userId, removedAt: null },
      select: { id: true },
    });
    if (!assigneeIsMember) {
      throw new BadRequestException({
        message: 'User is not a member of this crew',
        field: 'userId',
      });
    }

    const dup = await this.prisma.episodeAssignment.findUnique({
      where: { uniq_episode_user: { episodeId, userId: input.userId } },
    });
    if (dup) {
      throw new ConflictException({
        message: 'User is already assigned to this episode',
        existingAssignmentId: dup.id,
      });
    }

    const pendingMessages: PrismaMessage[] = [];
    const created = await this.prisma
      .$transaction(async (tx) => {
        const lockedEpisode = await this.lockEpisode(tx, episodeId);
        await this.roles.require(lockedEpisode.crewId, actorId, ['admin'], tx);
        if (lockedEpisode.status === 'approved') {
          throw new EpisodeFrozenException();
        }

        const memberStillActive = await tx.crewMember.findFirst({
          where: {
            crewId: lockedEpisode.crewId,
            userId: input.userId,
            removedAt: null,
          },
          select: { id: true },
        });
        if (!memberStillActive) {
          throw new BadRequestException({
            message: 'User is not a member of this crew',
            field: 'userId',
          });
        }

        const assignment = await tx.episodeAssignment.create({
          data: {
            id: newCrewDomainId(),
            crewId: lockedEpisode.crewId,
            episodeId,
            userId: input.userId,
            positionId: input.positionId ?? null,
            roleName: input.roleName ?? null,
          },
        });

        if (lockedEpisode.status === 'not_started') {
          await tx.episode.update({
            where: { id: episodeId },
            data: { status: 'in_production' },
          });
        }

        await writeActivity(tx, {
          crewId: lockedEpisode.crewId,
          episodeId,
          type: 'member_assigned',
          actorUserId: actorId,
          actorName,
          payload: {
            targetUserId: input.userId,
            roleName: input.roleName ?? null,
          },
        });
        await this.notifications.send(
          {
            userId: input.userId,
            type: 'crew.episode.assigned',
            title: `Assigned to episode ${lockedEpisode.number}`,
            body: input.roleName
              ? `You're now the ${input.roleName} for this episode.`
              : 'You have a new episode assignment.',
            meta: {
              deeplink: workspaceDeeplink({
                crewId: lockedEpisode.crewId,
                episodeId,
                assignmentId: assignment.id,
              }),
              crewId: lockedEpisode.crewId,
              episodeId,
              assignmentId: assignment.id,
            },
            idempotencyKey: `crew.episode.assigned:${assignment.id}`,
          },
          tx,
        );
        const statusMessage = await this.postAssignmentStatus(
          tx,
          'crew.episode.assigned',
          {
            crewId: lockedEpisode.crewId,
            episodeId,
            episodeNumber: lockedEpisode.number,
            assignmentId: assignment.id,
            userId: input.userId,
          },
        );
        if (statusMessage) pendingMessages.push(statusMessage);
        return assignment;
      })
      .catch(async (err: unknown) => {
        if (!isUniqueViolation(err)) throw err;
        const winner = await this.prisma.episodeAssignment.findUnique({
          where: { uniq_episode_user: { episodeId, userId: input.userId } },
          select: { id: true },
        });
        throw new ConflictException({
          message: 'User is already assigned to this episode',
          ...(winner ? { existingAssignmentId: winner.id } : {}),
        });
      });
    for (const msg of pendingMessages) {
      await this.conversations.broadcastMessage(msg);
    }
    return toAssignmentDTO(created);
  }

  async remove(assignmentId: string, actorId: string, actorName: string) {
    const a = await this.requireAssignment(assignmentId);
    await this.roles.require(a.crewId, actorId, ['admin']);
    if (a.episode.status === 'approved') throw new EpisodeFrozenException();
    if (a.status !== 'in_progress' && a.status !== 'rejected') {
      throw new BadRequestException({
        message: 'Assignment is not removable in its current state',
        currentStatus: a.status,
        expectedStatuses: ['in_progress', 'rejected'],
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockAssignment(tx, assignmentId);
      await this.roles.require(current.crewId, actorId, ['admin'], tx);
      if (current.episode.status === 'approved')
        throw new EpisodeFrozenException();
      if (current.status !== 'in_progress' && current.status !== 'rejected') {
        throw new BadRequestException({
          message: 'Assignment is not removable in its current state',
          currentStatus: current.status,
          expectedStatuses: ['in_progress', 'rejected'],
        });
      }
      await tx.episodeAssignment.delete({ where: { id: assignmentId } });
      await writeActivity(tx, {
        crewId: current.crewId,
        episodeId: current.episodeId,
        type: 'member_unassigned',
        actorUserId: actorId,
        actorName,
        payload: {
          targetUserId: current.userId,
          roleName: current.roleName ?? null,
        },
      });
      await this.notifications.send(
        {
          userId: current.userId,
          type: 'crew.episode.unassigned',
          title: `Removed from episode ${current.episode.number}`,
          body: 'You no longer have this episode assignment.',
          meta: {
            // No `assignment` param: the row was deleted a few lines up,
            // so deeplinking to it would land on a 404.
            deeplink: workspaceDeeplink({
              crewId: current.crewId,
              episodeId: current.episodeId,
            }),
            crewId: current.crewId,
            episodeId: current.episodeId,
          },
          idempotencyKey: `crew.episode.unassigned:${assignmentId}`,
        },
        tx,
      );
      return {
        removedId: assignmentId,
        episodeStatus: current.episode.status,
      };
    });
  }

  async submit(
    assignmentId: string,
    actorId: string,
    actorName: string,
    input: SubmitAssignmentInput,
  ) {
    const a = await this.requireAssignment(assignmentId);
    // Membership first, self second. An assignment row outlives the
    // membership that created it, so a removed member could still submit
    // against their old row. Ordering also matters for disclosure: an
    // outsider gets a flat 'Insufficient role' instead of a self-check
    // message that confirms the assignment exists.
    await this.roles.require(a.crewId, actorId, ['admin', 'finance', 'member']);
    if (a.userId !== actorId) {
      throw new ForbiddenException({
        message: 'Only the assignee can submit',
        requiredRole: 'self',
      });
    }
    if (a.episode.status === 'approved') throw new EpisodeFrozenException();
    if (a.status !== 'in_progress' && a.status !== 'rejected') {
      throw new BadRequestException({
        message: 'Assignment is not submittable in its current state',
        currentStatus: a.status,
        expectedStatuses: ['in_progress', 'rejected'],
      });
    }

    const now = new Date();
    const pendingMessages: PrismaMessage[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAssignment(tx, assignmentId);
      await this.roles.require(
        current.crewId,
        actorId,
        ['admin', 'finance', 'member'],
        tx,
      );
      if (current.userId !== actorId) {
        throw new ForbiddenException({
          message: 'Only the assignee can submit',
          requiredRole: 'self',
        });
      }
      if (current.episode.status === 'approved')
        throw new EpisodeFrozenException();
      if (current.status !== 'in_progress' && current.status !== 'rejected') {
        throw new BadRequestException({
          message: 'Assignment is not submittable in its current state',
          currentStatus: current.status,
          expectedStatuses: ['in_progress', 'rejected'],
        });
      }

      const u = await tx.episodeAssignment.update({
        where: { id: assignmentId },
        data: {
          status: 'submitted',
          submissionUrl: input.url ?? null,
          submissionNote: input.note ?? null,
          submittedAt: now,
          // Clear prior review note on re-submission.
          rejectReason: null,
          rejectSuggestion: null,
          rejectedAt: null,
        },
      });
      await writeActivity(tx, {
        crewId: current.crewId,
        episodeId: current.episodeId,
        type: 'submission_made',
        actorUserId: actorId,
        actorName,
        payload: {
          targetUserId: current.userId,
          roleName: current.roleName ?? null,
        },
      });
      // Close the loop: the founder is the only one who can approve or
      // reject, and until now nothing told them a submission was waiting.
      // A founder submitting their own assignment is skipped — telling
      // someone about their own click is noise.
      if (current.episode.crew.founderId !== actorId) {
        await this.notifications.send(
          {
            userId: current.episode.crew.founderId,
            type: 'crew.episode.submitted',
            title: `New submission on episode ${current.episode.number}`,
            body: `${actorName} submitted work in "${current.episode.crew.name}" for review.`,
            meta: {
              deeplink: workspaceDeeplink({
                crewId: current.crewId,
                episodeId: current.episodeId,
                assignmentId,
              }),
              crewId: current.crewId,
              episodeId: current.episodeId,
              assignmentId,
            },
            // Keyed on this submission's timestamp so a resubmission after
            // a rejection notifies again instead of deduping into silence
            // — same convention as the approve/reject keys below.
            idempotencyKey: `crew.episode.submitted:${assignmentId}:${now.toISOString()}`,
          },
          tx,
        );
      }
      // Unlike the notification above, the chat line is NOT skipped for
      // a self-submitting founder: the group chat is the crew's shared
      // timeline, not a personal inbox — everyone else still needs the
      // event.
      const statusMessage = await this.postAssignmentStatus(
        tx,
        'crew.episode.submitted',
        {
          crewId: current.crewId,
          episodeId: current.episodeId,
          episodeNumber: current.episode.number,
          assignmentId,
          userId: current.userId,
        },
      );
      if (statusMessage) pendingMessages.push(statusMessage);
      return u;
    });
    for (const msg of pendingMessages) {
      await this.conversations.broadcastMessage(msg);
    }
    return toAssignmentDTO(updated);
  }

  async approve(assignmentId: string, actorId: string, actorName: string) {
    return this.reviewAssignment(assignmentId, actorId, actorName, 'approved');
  }

  async reject(
    assignmentId: string,
    actorId: string,
    actorName: string,
    input: RejectAssignmentInput,
  ) {
    return this.reviewAssignment(
      assignmentId,
      actorId,
      actorName,
      'rejected',
      input,
    );
  }

  private async reviewAssignment(
    assignmentId: string,
    actorId: string,
    actorName: string,
    next: 'approved' | 'rejected',
    rejectInput?: RejectAssignmentInput,
  ) {
    const a = await this.requireAssignment(assignmentId);
    await this.roles.require(a.crewId, actorId, ['admin']);
    if (a.episode.status === 'approved') throw new EpisodeFrozenException();
    if (a.status !== 'submitted') {
      throw new BadRequestException({
        message: `Assignment is not in submitted state`,
        currentStatus: a.status,
        expectedStatuses: ['submitted'],
      });
    }

    const pendingMessages: PrismaMessage[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAssignment(tx, assignmentId);
      await this.roles.require(current.crewId, actorId, ['admin'], tx);
      if (current.episode.status === 'approved')
        throw new EpisodeFrozenException();
      if (current.status !== 'submitted') {
        throw new BadRequestException({
          message: 'Assignment is not in submitted state',
          currentStatus: current.status,
          expectedStatuses: ['submitted'],
        });
      }

      const u = await tx.episodeAssignment.update({
        where: { id: assignmentId },
        data:
          next === 'approved'
            ? {
                status: 'approved',
                rejectReason: null,
                rejectSuggestion: null,
                rejectedAt: null,
              }
            : {
                status: 'rejected',
                rejectReason: rejectInput?.reason ?? '',
                rejectSuggestion: rejectInput?.suggestion ?? null,
                rejectedAt: new Date(),
              },
      });

      const isApprove = next === 'approved';
      await writeActivity(tx, {
        crewId: current.crewId,
        episodeId: current.episodeId,
        type: isApprove ? 'submission_approved' : 'submission_rejected',
        actorUserId: actorId,
        actorName,
        payload: isApprove
          ? {
              targetUserId: current.userId,
              roleName: current.roleName ?? null,
            }
          : {
              targetUserId: current.userId,
              roleName: current.roleName ?? null,
              reason: rejectInput?.reason ?? '',
            },
      });
      await this.notifications.send(
        {
          userId: current.userId,
          type: isApprove
            ? 'crew.episode.submission_approved'
            : 'crew.episode.submission_rejected',
          title: isApprove ? 'Submission approved' : 'Submission rejected',
          body: isApprove
            ? `Your work on episode ${current.episode.number} was approved.`
            : `Your submission for episode ${current.episode.number} needs revision.`,
          meta: {
            deeplink: workspaceDeeplink({
              crewId: current.crewId,
              episodeId: current.episodeId,
              assignmentId,
            }),
            crewId: current.crewId,
            episodeId: current.episodeId,
            assignmentId,
            ...(rejectInput?.reason ? { reason: rejectInput.reason } : {}),
          },
          // Include submittedAt timestamp so successive submit/review
          // cycles each get a fresh notification (don't dedup across
          // resubmissions of the same assignment).
          idempotencyKey: `crew.episode.${
            isApprove ? 'submission_approved' : 'submission_rejected'
          }:${assignmentId}:${current.submittedAt?.toISOString() ?? Date.now()}`,
        },
        tx,
      );
      const statusMessage = await this.postAssignmentStatus(
        tx,
        isApprove ? 'crew.episode.approved' : 'crew.episode.rejected',
        {
          crewId: current.crewId,
          episodeId: current.episodeId,
          episodeNumber: current.episode.number,
          assignmentId,
          userId: current.userId,
        },
      );
      if (statusMessage) pendingMessages.push(statusMessage);
      return u;
    });
    for (const msg of pendingMessages) {
      await this.conversations.broadcastMessage(msg);
    }
    return toAssignmentDTO(updated);
  }

  async setRevenue(
    assignmentId: string,
    actorId: string,
    actorName: string,
    input: RevenueInput,
  ) {
    const a = await this.requireAssignment(assignmentId);
    // Admins too, not finance alone: CrewRoleService.resolve short-circuits
    // the founder to 'admin' and never reads isFinance, so a crew with no
    // finance-flagged member otherwise has nobody who can record revenue —
    // and the founder cannot grant the flag to themselves.
    await this.roles.require(a.crewId, actorId, ['admin', 'finance']);
    if (a.episode.status === 'approved') throw new EpisodeFrozenException();

    // Cell-aware currency policy: cn → CNY only, com → 9-currency
    // whitelist. Default to the cell default when not specified so
    // simple "set yuan amount" callers don't have to plumb currency.
    const currency = input.currency ?? defaultCurrency();
    assertAllowedCurrency(currency, 'currency');

    // Notification body needs a human-readable amount with the right
    // unit (JPY has no fractional part).
    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency as CurrencyCode);
    const displayAmount = isZeroDecimal
      ? input.amount.toString()
      : (input.amount / 100).toFixed(2);
    const displaySymbol = CURRENCY_SYMBOLS[currency as CurrencyCode] ?? '';

    const setAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAssignment(tx, assignmentId);
      await this.roles.require(
        current.crewId,
        actorId,
        ['admin', 'finance'],
        tx,
      );
      if (current.episode.status === 'approved')
        throw new EpisodeFrozenException();

      const u = await tx.episodeAssignment.update({
        where: { id: assignmentId },
        data: {
          revenueAmount: BigInt(input.amount),
          revenueCurrency: currency,
          revenueSetAt: setAt,
          revenueSetById: actorId,
        },
      });
      await writeActivity(tx, {
        crewId: current.crewId,
        episodeId: current.episodeId,
        type: 'revenue_set',
        actorUserId: actorId,
        actorName,
        payload: {
          targetUserId: current.userId,
          amount: input.amount,
          currency,
        },
      });
      await this.notifications.send(
        {
          userId: current.userId,
          type: 'crew.episode.revenue_set',
          title: `Revenue set for episode ${current.episode.number}`,
          body: `Your share: ${displaySymbol}${displayAmount}`,
          meta: {
            deeplink: workspaceDeeplink({
              crewId: current.crewId,
              episodeId: current.episodeId,
              assignmentId,
            }),
            crewId: current.crewId,
            episodeId: current.episodeId,
            assignmentId,
            amount: input.amount,
            currency,
          },
          // Include amount + currency + setAt so finance can revise
          // the number / switch currency and the user gets a fresh
          // notification each time.
          idempotencyKey: `crew.episode.revenue_set:${assignmentId}:${currency}:${input.amount}:${setAt.toISOString()}`,
        },
        tx,
      );
      return u;
    });
    return toAssignmentDTO(updated);
  }

  // ─── Helpers ──────────────────────────────────────────────

  private async requireEpisode(
    episodeId: string,
    db: Pick<Prisma.TransactionClient, 'episode'> = this.prisma,
  ) {
    const e = await db.episode.findUnique({
      where: { id: episodeId },
      include: { crew: { select: { deletedAt: true } } },
    });
    if (!e || e.crew.deletedAt)
      throw new NotFoundException('Episode not found');
    return e;
  }

  private async requireAssignment(
    assignmentId: string,
    db: Pick<Prisma.TransactionClient, 'episodeAssignment'> = this.prisma,
  ) {
    const a = await db.episodeAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        episode: {
          select: {
            id: true,
            number: true,
            status: true,
            crewId: true,
            // Only Episode carries the crew relation; the founder is the
            // notification target for submissions.
            crew: { select: { founderId: true, name: true } },
          },
        },
      },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
