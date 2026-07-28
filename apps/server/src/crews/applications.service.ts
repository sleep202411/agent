/**
 * Application apply + approve/reject flow.
 *
 * Every state transition is a single transaction with the matching
 * side-effects (member creation on approve, recruitedCount bump, status
 * flip to FULL when capacity is hit) + the notification publish via
 * the outbox (idempotent per-event).
 *
 * Idempotency keys are derived deterministically from the source event
 * so a duplicate approve / re-tried apply produces exactly one
 * notification + one outbox push.
 *
 * Member rows on approve are INSERTed (not upserted) — the partial
 * unique index `crew_members_active_unique WHERE removed_at IS NULL`
 * permits historical removed rows to coexist with a new active row,
 * preserving the audit trail.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CrewApplication, Message as PrismaMessage } from '@prisma/client';
import { crewChatWritesEnabled } from '../conversations/crew-chat-rollout';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import {
  assertAllowedCurrency,
  defaultCurrency,
  toSmallestUnit,
  type CurrencyCode,
} from '../common/currency';
import type { ApplyInput } from './dto';
import { newCrewDomainId } from './id';
import { toApplicationDTO } from './mappers';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly conversations: ConversationsService,
  ) {}

  async listForOwner(crewId: string, ownerId: string) {
    await this.assertOwner(crewId, ownerId);
    const rows = await this.prisma.crewApplication.findMany({
      where: { crewId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map(toApplicationDTO);
  }

  async apply(
    crewId: string,
    positionId: string,
    applicantId: string,
    input: ApplyInput,
  ) {
    const [crew, position, existingMembership] = await Promise.all([
      this.prisma.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: { id: true, founderId: true, name: true },
      }),
      this.prisma.crewPosition.findFirst({
        where: { id: positionId, crewId, deletedAt: null },
        select: { id: true, status: true, positionType: true },
      }),
      this.prisma.crewMember.findFirst({
        where: { crewId, userId: applicantId, removedAt: null },
        select: { id: true },
      }),
    ]);

    if (!crew) throw new NotFoundException('Crew not found');
    if (!position) throw new NotFoundException('Position not found');
    if (position.status !== 'open') {
      throw new BadRequestException({
        message: 'Position is not accepting applications',
        positionStatus: position.status,
      });
    }
    if (existingMembership) {
      throw new ConflictException({
        message: 'You are already a member of this crew',
      });
    }
    if (applicantId === crew.founderId) {
      throw new BadRequestException({
        message: 'The crew owner cannot apply to their own crew',
      });
    }

    const expected = normalizeExpectedCompensation(input);
    assertAllowedCurrency(expected?.currency, 'expectedCompensation.currency');

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const app = await tx.crewApplication.create({
          data: {
            id: newCrewDomainId(),
            crewId,
            positionId,
            applicantId,
            message: input.message ?? null,
            portfolioUrl: input.portfolioUrl ?? null,
            expectedCompensationAmount: expected
              ? toSmallestUnit(expected.amount, expected.currency)
              : null,
            expectedCompensationCurrency: expected?.currency ?? null,
            expectedCompensationPeriod: expected?.period ?? null,
            availableStartDate: input.availableStartDate
              ? new Date(`${input.availableStartDate}T00:00:00Z`)
              : null,
            yearsExperience: input.yearsExperience ?? null,
          },
        });
        await this.notifications.send(
          {
            userId: crew.founderId,
            type: 'crew.application.submitted',
            title: `New application for ${position.positionType}`,
            body: `Someone applied to your crew "${crew.name}".`,
            meta: {
              // Deeplink lands the owner on the workspace with the
              // applicationId in a query param; the workspace page
              // auto-opens ApplicationReviewDialog so the owner can
              // decide without any further navigation. The public
              // crew page used to handle this but it lacked the
              // approval surface entirely.
              deeplink: `/crews/${crewId}/workspace?application=${app.id}`,
              crewId,
              positionId,
              applicationId: app.id,
              applicantId,
            },
            // Same applicant + same position → same key. The DB partial
            // unique on (positionId, applicantId) WHERE status='pending'
            // is the primary defense; this seals it on the notification
            // side so a button-spam race produces 1 notif at most.
            idempotencyKey: `crew.application.submitted:${positionId}:${applicantId}`,
          },
          tx,
        );
        return app;
      });
      return toApplicationDTO(created);
    } catch (err) {
      // 23505 = unique_violation. Triggered by the partial-unique
      // index when two parallel requests both pass the "no pending row"
      // check above and try to insert at the same moment.
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'You already have a pending application for this position',
        });
      }
      throw err;
    }
  }

  async approve(applicationId: string, reviewerId: string) {
    return this.transitionApplication(applicationId, reviewerId, 'approved');
  }

  async reject(applicationId: string, reviewerId: string) {
    return this.transitionApplication(applicationId, reviewerId, 'rejected');
  }

  private async transitionApplication(
    applicationId: string,
    reviewerId: string,
    next: 'approved' | 'rejected',
  ) {
    const app = await this.prisma.crewApplication.findUnique({
      where: { id: applicationId },
      include: {
        crew: {
          select: { id: true, founderId: true, name: true, deletedAt: true },
        },
        position: {
          select: {
            id: true,
            status: true,
            positionType: true,
            targetCount: true,
            recruitedCount: true,
          },
        },
      },
    });
    if (!app || app.crew.deletedAt)
      throw new NotFoundException('Application not found');
    if (app.crew.founderId !== reviewerId) {
      throw new ForbiddenException({
        message: 'Only the crew owner can review applications',
      });
    }
    if (app.status !== 'pending') {
      throw new BadRequestException({
        message: 'Application is not pending',
        currentStatus: app.status,
      });
    }

    const reviewedAt = new Date();
    const chatEnabled = crewChatWritesEnabled();
    const pendingMessages: PrismaMessage[] = [];
    let updated: CrewApplication;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const appTransition = await tx.crewApplication.updateMany({
          where: { id: applicationId, status: 'pending' },
          data: { status: next, reviewedAt, reviewerId },
        });
        if (appTransition.count === 0) {
          throw new ConflictException({
            message: 'Application was already reviewed',
          });
        }

        const updatedApp = await tx.crewApplication.findUniqueOrThrow({
          where: { id: applicationId },
        });

        if (next === 'approved') {
          const bumped = await tx.$queryRaw<Array<{ id: string }>>`
            UPDATE "crew_positions"
            SET
              "recruited_count" = "recruited_count" + 1,
              "status" = CASE
                WHEN "recruited_count" + 1 >= "target_count" THEN 'full'
                ELSE "status"
              END
            WHERE
              "id" = ${app.position.id}
              AND "crew_id" = ${app.crewId}
              AND "deleted_at" IS NULL
              AND "status" <> 'frozen'
              AND "recruited_count" < "target_count"
            RETURNING "id"
          `;
          if (bumped.length === 0) {
            throw new ConflictException({
              message: 'Position is no longer accepting approvals',
            });
          }

          // Conversation lock before membership insert — the same
          // order as ownership transfer and manual member changes.
          // This matters only for a pre-chat crew, but that is exactly
          // where opposite lock orders can deadlock.
          const conversation = chatEnabled
            ? await this.conversations.openCrewConversation(app.crewId, tx)
            : null;

          // Plain insert — partial unique on (crewId, userId) WHERE
          // removed_at IS NULL means a previously removed member becomes
          // a new active row, preserving the history.
          await tx.crewMember.create({
            data: {
              id: newCrewDomainId(),
              crewId: app.crewId,
              userId: app.applicantId,
              roleType: app.position.positionType,
              positionId: app.position.id,
              via: 'application',
            },
          });
          // Approval is the moment they become a member, so it is also
          // the moment they enter the group chat — same transaction, so
          // the two can never disagree. A rejection changes no
          // membership and therefore touches no chat.
          if (conversation) {
            await this.conversations.syncCrewParticipant(
              app.crewId,
              app.applicantId,
              'join',
              tx,
            );
            pendingMessages.push(
              await this.conversations.persistSystem(
                conversation.id,
                'crew.member.joined',
                { userId: app.applicantId },
                tx,
              ),
            );
          }
        }

        const isApprove = next === 'approved';
        await this.notifications.send(
          {
            userId: app.applicantId,
            type: isApprove
              ? 'crew.application.approved'
              : 'crew.application.rejected',
            title: isApprove ? 'Application approved' : 'Application rejected',
            body: isApprove
              ? `You're now a ${app.position.positionType} in "${app.crew.name}".`
              : `Your application to "${app.crew.name}" was not accepted.`,
            meta: {
              // Approved → land in the workspace they can now act on.
              // Rejected → leave them on the crew hall page (their
              // chance to read the body without confusion about "why
              // am I being sent into a workspace I can't use").
              deeplink: isApprove
                ? `/crews/${app.crewId}/workspace`
                : `/crews/${app.crewId}`,
              crewId: app.crewId,
              positionId: app.position.id,
              applicationId,
            },
            idempotencyKey: `crew.application.${next}:${applicationId}`,
          },
          tx,
        );

        return updatedApp;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'Applicant is already a member of this crew',
        });
      }
      throw err;
    }
    for (const msg of pendingMessages) {
      await this.conversations.broadcastMessage(msg);
    }
    return toApplicationDTO(updated);
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
}

function normalizeExpectedCompensation(input: ApplyInput): {
  amount: number;
  currency: CurrencyCode;
  period: 'month' | 'episode' | 'project' | null;
} | null {
  const next = input.expectedCompensation;
  if (next?.amount != null) {
    return {
      amount: next.amount,
      currency: next.currency ?? defaultCurrency(),
      period: next.period ?? null,
    };
  }

  if (input.expectedSalary != null) {
    return {
      amount: input.expectedSalary,
      currency: 'CNY',
      period: null,
    };
  }

  return null;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string };
  return e.code === 'P2002';
}
