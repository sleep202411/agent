/**
 * Assignment + activity-log service — 6 assignment endpoints + activity feed.
 *
 * Every mutation:
 *   1. Resolves the episode + asserts the requester's role.
 *   2. Asserts episode.status !== 'approved' (423 freeze) when applicable.
 *   3. Asserts current assignment status against allowed transitions.
 *   4. Inside a transaction: mutates, writes activity, sends notification
 *      (with deterministic idempotency key).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  ) {}

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

    const created = await this.prisma.$transaction(async (tx) => {
      const a = await tx.episodeAssignment.create({
        data: {
          id: newCrewDomainId(),
          crewId: episode.crewId,
          episodeId,
          userId: input.userId,
          positionId: input.positionId ?? null,
          roleName: input.roleName ?? null,
        },
      });

      if (episode.status === 'not_started') {
        await tx.episode.update({
          where: { id: episodeId },
          data: { status: 'in_production' },
        });
      }

      await writeActivity(tx, {
        crewId: episode.crewId,
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
          title: `Assigned to episode ${episode.number}`,
          body: input.roleName
            ? `You're now the ${input.roleName} for this episode.`
            : 'You have a new episode assignment.',
          meta: {
            deeplink: `/crews/${episode.crewId}/workspace`,
            crewId: episode.crewId,
            episodeId,
            assignmentId: a.id,
          },
          idempotencyKey: `crew.episode.assigned:${a.id}`,
        },
        tx,
      );
      return a;
    });
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
      await tx.episodeAssignment.delete({ where: { id: assignmentId } });
      await writeActivity(tx, {
        crewId: a.crewId,
        episodeId: a.episodeId,
        type: 'member_unassigned',
        actorUserId: actorId,
        actorName,
        payload: { targetUserId: a.userId, roleName: a.roleName ?? null },
      });
      await this.notifications.send(
        {
          userId: a.userId,
          type: 'crew.episode.unassigned',
          title: `Removed from episode ${a.episode.number}`,
          body: 'You no longer have this episode assignment.',
          meta: {
            deeplink: `/crews/${a.crewId}/workspace`,
            crewId: a.crewId,
            episodeId: a.episodeId,
          },
          idempotencyKey: `crew.episode.unassigned:${assignmentId}`,
        },
        tx,
      );
      return { removedId: assignmentId, episodeStatus: a.episode.status };
    });
  }

  async submit(
    assignmentId: string,
    actorId: string,
    actorName: string,
    input: SubmitAssignmentInput,
  ) {
    const a = await this.requireAssignment(assignmentId);
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
    const updated = await this.prisma.$transaction(async (tx) => {
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
        crewId: a.crewId,
        episodeId: a.episodeId,
        type: 'submission_made',
        actorUserId: actorId,
        actorName,
        payload: { targetUserId: a.userId, roleName: a.roleName ?? null },
      });
      return u;
    });
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

    const updated = await this.prisma.$transaction(async (tx) => {
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
        crewId: a.crewId,
        episodeId: a.episodeId,
        type: isApprove ? 'submission_approved' : 'submission_rejected',
        actorUserId: actorId,
        actorName,
        payload: isApprove
          ? { targetUserId: a.userId, roleName: a.roleName ?? null }
          : {
              targetUserId: a.userId,
              roleName: a.roleName ?? null,
              reason: rejectInput?.reason ?? '',
            },
      });
      await this.notifications.send(
        {
          userId: a.userId,
          type: isApprove
            ? 'crew.episode.submission_approved'
            : 'crew.episode.submission_rejected',
          title: isApprove ? 'Submission approved' : 'Submission rejected',
          body: isApprove
            ? `Your work on episode ${a.episode.number} was approved.`
            : `Your submission for episode ${a.episode.number} needs revision.`,
          meta: {
            deeplink: `/crews/${a.crewId}/workspace`,
            crewId: a.crewId,
            episodeId: a.episodeId,
            assignmentId,
            ...(rejectInput?.reason ? { reason: rejectInput.reason } : {}),
          },
          // Include submittedAt timestamp so successive submit/review
          // cycles each get a fresh notification (don't dedup across
          // resubmissions of the same assignment).
          idempotencyKey: `crew.episode.${
            isApprove ? 'submission_approved' : 'submission_rejected'
          }:${assignmentId}:${a.submittedAt?.toISOString() ?? Date.now()}`,
        },
        tx,
      );
      return u;
    });
    return toAssignmentDTO(updated);
  }

  async setRevenue(
    assignmentId: string,
    actorId: string,
    actorName: string,
    input: RevenueInput,
  ) {
    const a = await this.requireAssignment(assignmentId);
    await this.roles.require(a.crewId, actorId, ['finance']);
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
        crewId: a.crewId,
        episodeId: a.episodeId,
        type: 'revenue_set',
        actorUserId: actorId,
        actorName,
        payload: {
          targetUserId: a.userId,
          amount: input.amount,
          currency,
        },
      });
      await this.notifications.send(
        {
          userId: a.userId,
          type: 'crew.episode.revenue_set',
          title: `Revenue set for episode ${a.episode.number}`,
          body: `Your share: ${displaySymbol}${displayAmount}`,
          meta: {
            deeplink: `/crews/${a.crewId}/workspace`,
            crewId: a.crewId,
            episodeId: a.episodeId,
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

  private async requireEpisode(episodeId: string) {
    const e = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: { crew: { select: { deletedAt: true } } },
    });
    if (!e || e.crew.deletedAt)
      throw new NotFoundException('Episode not found');
    return e;
  }

  private async requireAssignment(assignmentId: string) {
    const a = await this.prisma.episodeAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        episode: {
          select: { id: true, number: true, status: true, crewId: true },
        },
      },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }
}
