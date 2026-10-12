import { assertNewCrewCurrency } from './earnings/ledger-currency';
import { assertInterviewResolved } from './application-interviews';
import { assertRecruitableTask } from './task-recruitment';
import { assertApplicationTermsConfirmed } from './application-terms';
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
 * New member rows on approve are INSERTed (not upserted); active members
 * receive another position on their existing membership. The partial
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
import {
  CrewApplicationStatus,
  CrewMembershipStatus,
  Prisma,
  type CrewApplication,
  type Message as PrismaMessage,
} from '@prisma/client';
import type {
  CrewApplicationListSummary,
  CrewApplicationStatusCounts,
} from '@repo/shared/crew';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import { toSmallestUnit, type CurrencyCode } from '../common/currency';
import type { ApplyInput, ListCrewApplicationsQuery } from './dto';
import { newCrewDomainId } from './id';
import { toApplicationDTO } from './mappers';
import { CrewCollaborationService } from './collaboration/crew-collaboration.service';
import { CrewAuthorizationService } from './crew-authorization.service';
import {
  CrewQualificationsService,
  qualificationRequirementsKey,
} from './crew-qualifications.service';

const INTERVIEW_PROGRESS = {
  interviewEvents: {
    orderBy: { version: 'desc' as const },
    take: 1,
    select: { state: true, version: true, scheduledAt: true },
  },
} satisfies Prisma.CrewApplicationInclude;

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly conversations: ConversationsService,
    private readonly collaboration: CrewCollaborationService,
    private readonly authorization: CrewAuthorizationService,
    private readonly qualifications: CrewQualificationsService = new CrewQualificationsService(),
  ) {}

  async listForOwner(
    crewId: string,
    ownerId: string,
    query: ListCrewApplicationsQuery,
  ) {
    await this.authorization.require(crewId, ownerId, 'applications.review');
    const where = {
      crewId,
      ...(query.positionId ? { positionId: query.positionId } : {}),
      ...(query.status ? { status: query.status } : {}),
    } satisfies Prisma.CrewApplicationWhereInput;

    if (query.cursor) {
      const cursor = await this.prisma.crewApplication.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) {
        throw new BadRequestException({
          code: 'CREW_APPLICATION_CURSOR_INVALID',
          message:
            'The applications cursor is invalid for the current filters. Restart from the first page.',
        });
      }
    }

    const summaryWhere = {
      crewId,
      ...(query.positionId ? { positionId: query.positionId } : {}),
    } satisfies Prisma.CrewApplicationWhereInput;
    const [rows, grouped] = await Promise.all([
      this.prisma.crewApplication.findMany({
        where,
        include: INTERVIEW_PROGRESS,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.crewApplication.groupBy({
        by: ['positionId', 'status'],
        where: summaryWhere,
        _count: { _all: true },
      }),
    ]);

    const page = rows.slice(0, query.limit);
    const summary = buildApplicationSummary(grouped);
    return {
      items: page.map(toApplicationDTO),
      nextCursor:
        rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
      total: query.status ? summary[query.status] : summary.total,
      summary,
    };
  }

  /** Applicant-owned history remains accessible after rejection or leaving a Crew. */
  async listMine(userId: string, query: ListCrewApplicationsQuery) {
    const where: Prisma.CrewApplicationWhereInput = {
      ...(query.scope === 'received'
        ? {
            crew: {
              deletedAt: null,
              ownership: {
                member: { userId, status: 'active', removedAt: null },
              },
            },
          }
        : { applicantId: userId }),
      ...(query.positionId ? { positionId: query.positionId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    if (query.cursor) {
      const cursor = await this.prisma.crewApplication.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor)
        throw new BadRequestException(
          'Invalid application cursor for this applicant and filter.',
        );
    }
    const [rows, total] = await Promise.all([
      this.prisma.crewApplication.findMany({
        where,
        include: {
          ...INTERVIEW_PROGRESS,
          crew: {
            select: {
              name: true,
              ownership: { select: { member: { select: { userId: true } } } },
            },
          },
          position: {
            select: {
              positionType: true,
              taskId: true,
              groupedTasks: { select: { id: true } },
              task: { select: { title: true, dueAt: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.crewApplication.count({ where }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        ...toApplicationDTO(row),
        crewName: row.crew.name,
        positionType: row.position.positionType,
        taskId: row.position.taskId,
        ownerUserId: row.crew.ownership?.member.userId ?? null,
        taskTitle: row.position.task?.title ?? null,
        dueAt: row.position.task?.dueAt?.toISOString() ?? null,
      })),
      total,
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  /** Exact private thread lookup for either participant; independent of inbox pagination. */
  async getThread(applicationId: string, userId: string) {
    const row = await this.prisma.crewApplication.findUnique({
      where: { id: applicationId },
      include: {
        ...INTERVIEW_PROGRESS,
        crew: {
          select: {
            name: true,
            deletedAt: true,
            ownership: { select: { member: { select: { userId: true } } } },
          },
        },
        position: {
          select: {
            positionType: true,
            taskId: true,
            groupedTasks: { select: { id: true } },
            task: { select: { title: true, dueAt: true } },
          },
        },
      },
    });
    if (!row || row.crew.deletedAt)
      throw new NotFoundException('Application not found');
    if (row.applicantId !== userId)
      await this.authorization.require(
        row.crewId,
        userId,
        'applications.review',
      );
    return {
      ...toApplicationDTO(row),
      crewName: row.crew.name,
      positionType: row.position.positionType,
      taskId: row.position.taskId,
      ownerUserId: row.crew.ownership?.member.userId ?? null,
      taskTitle: row.position.task?.title ?? null,
      dueAt: row.position.task?.dueAt?.toISOString() ?? null,
    };
  }

  async getForOwner(crewId: string, applicationId: string, ownerId: string) {
    await this.authorization.require(crewId, ownerId, 'applications.review');
    const row = await this.prisma.crewApplication.findFirst({
      where: { id: applicationId, crewId },
      include: INTERVIEW_PROGRESS,
    });
    if (!row) throw new NotFoundException('Application not found');
    return toApplicationDTO(row);
  }

  async apply(
    crewId: string,
    positionId: string,
    applicantId: string,
    input: ApplyInput,
    cookie?: string,
    invitationId?: string,
  ) {
    if (invitationId) {
      const invitation = await this.requirePositionInvitation(
        this.prisma,
        invitationId,
        positionId,
        applicantId,
      );
      if (invitation.applicationId)
        return toApplicationDTO(
          await this.prisma.crewApplication.findUniqueOrThrow({
            where: { id: invitation.applicationId },
          }),
        );
    }
    const admitted = await this.applicationEligibility(
      crewId,
      positionId,
      applicantId,
      this.prisma,
      Boolean(invitationId),
    );
    await this.qualifications.assertEligible(
      applicantId,
      cookie,
      admitted.position,
    );

    const expected = normalizeExpectedCompensation(input);
    assertNewCrewCurrency(expected?.currency, 'expectedCompensation.currency');

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (admitted.position.taskId || admitted.position.groupedTasks?.length)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
        await tx.$queryRaw`SELECT id FROM crew_positions WHERE id=${positionId} AND crew_id=${crewId} FOR UPDATE`;
        if (invitationId) {
          await tx.$queryRaw`SELECT id FROM crew_position_invitations WHERE id=${invitationId}::uuid FOR UPDATE`;
          const invitation = await this.requirePositionInvitation(
            tx,
            invitationId,
            positionId,
            applicantId,
          );
          if (invitation.applicationId)
            return tx.crewApplication.findUniqueOrThrow({
              where: { id: invitation.applicationId },
            });
        }
        const { crew, position, ownerUserId } =
          await this.applicationEligibility(
            crewId,
            positionId,
            applicantId,
            tx,
            Boolean(invitationId),
          );
        if (
          qualificationRequirementsKey(position) !==
          qualificationRequirementsKey(admitted.position)
        )
          throw new ConflictException(
            'Position qualifications changed. Please review and retry.',
          );
        const pending = await tx.crewApplication.findFirst({
          where: { positionId, applicantId, status: 'pending' },
        });
        if (pending && invitationId) {
          await tx.crewPositionInvitation.update({
            where: { id: invitationId },
            data: {
              status: 'accepted',
              applicationId: pending.id,
              respondedAt: new Date(),
            },
          });
          return pending;
        }
        if (pending)
          throw new ConflictException({
            message: 'You already have a pending application for this position',
          });
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
        if (invitationId)
          await tx.crewPositionInvitation.update({
            where: { id: invitationId },
            data: {
              status: 'accepted',
              applicationId: app.id,
              respondedAt: new Date(),
            },
          });
        await this.notifications.send(
          {
            userId: ownerUserId,
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
              deeplink: `/crews/${crewId}/workspace?tab=roles&application=${app.id}`,
              crewId,
              crewName: crew.name,
              positionId,
              positionType: position.positionType,
              applicationId: app.id,
              applicantId,
            },
            // Each application is a distinct event, including reapplications
            // after rejection. Pending-row uniqueness already blocks spam;
            // notification deduplication must not suppress a later application.
            idempotencyKey: `crew.application.submitted:${app.id}`,
          },
          tx,
        );
        await this.applicationEligibility(
          crewId,
          positionId,
          applicantId,
          tx,
          Boolean(invitationId),
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

  private async requirePositionInvitation(
    db: Prisma.TransactionClient,
    id: string,
    positionId: string,
    applicantId: string,
  ) {
    const row = await db.crewPositionInvitation.findUnique({
      where: { id },
      include: { position: { select: { crewId: true } } },
    });
    if (
      !row ||
      row.positionId !== positionId ||
      row.inviteeUserId !== applicantId
    )
      throw new NotFoundException('Invitation not found.');
    if (row.status === 'accepted' && row.applicationId) return row;
    if (row.status !== 'pending' || row.expiresAt <= new Date())
      throw new ConflictException(
        'Invitation is no longer pending or has expired.',
      );
    await this.authorization.require(
      row.position.crewId,
      row.invitedByUserId,
      'openings.manage',
      db,
    );
    return row;
  }

  private async applicationEligibility(
    crewId: string,
    positionId: string,
    applicantId: string,
    db: Prisma.TransactionClient,
    invited = false,
  ) {
    const [crew, position, existingMembership] = await Promise.all([
      db.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: {
          id: true,
          name: true,
          moderationStatus: true,
          ownership: { select: { member: { select: { userId: true } } } },
        },
      }),
      db.crewPosition.findFirst({
        where: { id: positionId, crewId, deletedAt: null },
        select: {
          id: true,
          status: true,
          closeDate: true,
          recruitedCount: true,
          targetCount: true,
          recruitmentVisibility: true,
          taskId: true,
          groupedTasks: { select: { id: true } },
          positionType: true,
          moderationStatus: true,
          experienceLevel: true,
          requiredSkills: true,
        },
      }),
      db.crewMember.findFirst({
        where: {
          crewId,
          userId: applicantId,
          status: {
            in: [CrewMembershipStatus.active, CrewMembershipStatus.suspended],
          },
        },
        select: {
          id: true,
          status: true,
          positions: {
            where: { sourcePositionId: positionId },
            select: { id: true },
          },
        },
      }),
    ]);

    if (!crew || crew.moderationStatus === 'taken_down')
      throw new NotFoundException('Crew not found');
    if (!crew.ownership) throw new NotFoundException('Crew owner not found');
    const ownerUserId = crew.ownership.member.userId;
    if (!position || position.moderationStatus === 'taken_down')
      throw new NotFoundException('Position not found');
    for (const id of [
      position.taskId,
      ...(position.groupedTasks ?? []).map((t) => t.id),
    ].filter((v): v is string => Boolean(v)))
      await assertRecruitableTask(db, crewId, id);
    if (position.recruitmentVisibility === 'private' && !invited)
      throw new NotFoundException('Position not found');
    if (
      position.closeDate &&
      position.closeDate < new Date(new Date().toISOString().slice(0, 10))
    )
      throw new ConflictException('Position recruitment has expired.');
    if (position.recruitedCount >= position.targetCount)
      throw new ConflictException('Position has no remaining vacancies.');
    if (position.status !== 'open') {
      throw new BadRequestException({
        message: 'Position is not accepting applications',
        positionStatus: position.status,
      });
    }
    if (existingMembership?.status === CrewMembershipStatus.suspended) {
      throw new ConflictException({
        message: 'Suspended members cannot apply for additional roles.',
      });
    }
    if (existingMembership?.positions.length) {
      throw new ConflictException({
        message: 'You already hold this position.',
      });
    }
    if (applicantId === ownerUserId) {
      throw new BadRequestException({
        message: 'The crew owner cannot apply to their own crew',
      });
    }

    return { crew, position, ownerUserId };
  }

  async acceptOffer(
    applicationId: string,
    applicantId: string,
    version: number,
    cookie?: string,
  ) {
    const app = await this.prisma.crewApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.applicantId !== applicantId)
      throw new ForbiddenException('Only the applicant can accept this offer.');
    if (app.termsVersion !== version)
      throw new ConflictException('Terms changed. Review the latest offer.');
    const offer = await this.prisma.crewApplicationTerms.findUnique({
      where: { applicationId_version: { applicationId, version } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    return this.transitionApplication(
      applicationId,
      offer.proposedByUserId,
      'approved',
      cookie,
      { applicantId, version },
    );
  }

  async approve(applicationId: string, reviewerId: string, cookie?: string) {
    return this.transitionApplication(
      applicationId,
      reviewerId,
      'approved',
      cookie,
    );
  }

  async reject(applicationId: string, reviewerId: string) {
    return this.transitionApplication(applicationId, reviewerId, 'rejected');
  }

  private async transitionApplication(
    applicationId: string,
    reviewerId: string,
    next: 'approved' | 'rejected',
    cookie?: string,
    acceptance?: { applicantId: string; version: number },
  ) {
    const app = await this.prisma.crewApplication.findUnique({
      where: { id: applicationId },
      include: {
        crew: {
          select: { id: true, name: true, deletedAt: true },
        },
        position: {
          select: {
            id: true,
            status: true,
            taskId: true,
            groupedTasks: { select: { id: true } },
            positionType: true,
            targetCount: true,
            recruitedCount: true,
            experienceLevel: true,
            requiredSkills: true,
          },
        },
      },
    });
    if (!app || app.crew.deletedAt)
      throw new NotFoundException('Application not found');
    await this.authorization.require(
      app.crewId,
      reviewerId,
      'applications.review',
    );
    if (
      acceptance &&
      app.status === 'approved' &&
      app.applicantId === acceptance.applicantId &&
      app.termsVersion === acceptance.version
    ) {
      const offer = await this.prisma.crewApplicationTerms.findUnique({
        where: {
          applicationId_version: { applicationId, version: acceptance.version },
        },
      });
      if (offer?.confirmedAt) return toApplicationDTO(app);
    }
    if (app.status !== 'pending') {
      throw new BadRequestException({
        message: 'Application is not pending',
        currentStatus: app.status,
      });
    }
    if (next === 'approved' && app.applicantId === reviewerId)
      throw new ForbiddenException(
        'Applicants cannot approve their own applications.',
      );
    if (next === 'approved')
      await this.qualifications.assertEligible(
        app.applicantId,
        cookie,
        app.position,
      );

    const reviewedAt = new Date();
    const pendingMessages: PrismaMessage[] = [];
    let updated: CrewApplication;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        // Match member removal/ownership writes before locking a vacancy or chat.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:ownership:${app.crewId}`})::bigint)`;
        if (app.position.taskId || app.position.groupedTasks?.length)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${app.crewId}`}, 0))`;
        const appTransition = await tx.crewApplication.updateMany({
          where: { id: applicationId, status: 'pending' },
          data: { status: next, reviewedAt, reviewerId },
        });
        if (appTransition.count === 0) {
          if (acceptance) {
            const current = await tx.crewApplication.findUniqueOrThrow({
              where: { id: applicationId },
            });
            const offer = await tx.crewApplicationTerms.findUnique({
              where: {
                applicationId_version: {
                  applicationId,
                  version: acceptance.version,
                },
              },
            });
            if (
              current.status === 'approved' &&
              current.applicantId === acceptance.applicantId &&
              current.termsVersion === acceptance.version &&
              offer?.confirmedAt
            )
              return current;
          }
          throw new ConflictException({
            message: 'Application was already reviewed',
          });
        }

        // The conditional update may wait for another transaction. Recheck
        // access after acquiring that row before applying the review effects.
        const reviewer = await this.authorization.require(
          app.crewId,
          reviewerId,
          'applications.review',
          tx,
        );

        const updatedApp = await tx.crewApplication.findUniqueOrThrow({
          where: { id: applicationId },
        });

        if (next === 'approved') {
          if (acceptance) {
            if (
              updatedApp.applicantId !== acceptance.applicantId ||
              updatedApp.termsVersion !== acceptance.version
            )
              throw new ConflictException(
                'Terms changed. Review the latest offer.',
              );
            const offer = await tx.crewApplicationTerms.findUnique({
              where: {
                applicationId_version: {
                  applicationId,
                  version: acceptance.version,
                },
              },
            });
            if (!offer || offer.proposedByUserId !== reviewerId)
              throw new ConflictException('The offer is no longer available.');
            await tx.crewApplicationTerms.update({
              where: { id: offer.id },
              data: { confirmedAt: offer.confirmedAt ?? reviewedAt },
            });
          }
          await assertInterviewResolved(tx, applicationId);
          if (app.position.taskId || app.position.groupedTasks?.length) {
            for (const id of [
              app.position.taskId,
              ...(app.position.groupedTasks ?? []).map((t) => t.id),
            ].filter((v): v is string => Boolean(v)))
              await assertRecruitableTask(tx, app.crewId, id);
            if (!updatedApp.termsVersion)
              throw new ConflictException(
                'Task recruitment requires confirmed final terms before approval.',
              );
          }
          if (!updatedApp.termsVersion)
            throw new ConflictException(
              'Recruitment requires an accepted final offer before joining the Crew.',
            );
          await assertApplicationTermsConfirmed(
            tx,
            applicationId,
            updatedApp.termsVersion,
          );
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
          const currentRequirements = await tx.crewPosition.findUniqueOrThrow({
            where: { id: app.position.id },
            select: { experienceLevel: true, requiredSkills: true },
          });
          if (
            qualificationRequirementsKey(currentRequirements) !==
            qualificationRequirementsKey(app.position)
          )
            throw new ConflictException(
              'Position qualifications changed. Please review and retry.',
            );

          // Conversation lock before membership insert — the same
          // order as ownership transfer and manual member changes.
          // This matters only for a pre-chat crew, but that is exactly
          // where opposite lock orders can deadlock.
          const conversation = await this.conversations.openCrewConversation(
            app.crewId,
            tx,
          );

          // Reuse active membership for additional work. A previously removed
          // member receives a new row, preserving historical membership.
          const existingMember = await tx.crewMember.findFirst({
            where: {
              crewId: app.crewId,
              userId: app.applicantId,
              removedAt: null,
            },
            include: {
              positions: { where: { sourcePositionId: app.position.id } },
            },
          });
          if (
            existingMember &&
            existingMember.status !== CrewMembershipStatus.active
          )
            throw new ConflictException(
              'The applicant does not have active membership.',
            );
          if (existingMember?.positions.length)
            throw new ConflictException(
              'The applicant already holds this position.',
            );
          const member =
            existingMember ??
            (await tx.crewMember.create({
              data: {
                id: newCrewDomainId(),
                crewId: app.crewId,
                userId: app.applicantId,
                status: CrewMembershipStatus.active,
                joinedVia: 'application',
              },
            }));
          await tx.crewMemberPosition.create({
            data: {
              crewId: app.crewId,
              memberId: member.id,
              categoryKey: app.position.positionType,
              isPrimary: !existingMember,
              sourcePositionId: app.position.id,
            },
          });
          await tx.crewAuthorizationEvent.create({
            data: {
              crewId: app.crewId,
              memberId: member.id,
              actorMemberId: reviewer.memberId,
              actorUserId: reviewerId,
              action: existingMember
                ? 'member.position.assigned.application'
                : 'member.joined.application',
              after: {
                applicationId,
                positionCategoryKey: app.position.positionType,
                sourcePositionId: app.position.id,
              },
            },
          });
          // Joining through a public job must grant the exact same Studio
          // workspace access as accepting a direct invitation. Without this,
          // the member appears in the crew and chat but cannot open the shared
          // production canvas or a task canvas.
          if (!existingMember) {
            await this.collaboration.addCrewMemberAccess(
              app.crewId,
              app.applicantId,
              reviewerId,
              tx,
            );
            // Approval is the moment they become a member, so it is also
            // the moment they enter the group chat — same transaction, so
            // the two can never disagree. A rejection changes no
            // membership and therefore touches no chat.
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
              crewName: app.crew.name,
              positionId: app.position.id,
              positionType: app.position.positionType,
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
}

type ApplicationGroup = {
  positionId: string;
  status: CrewApplicationStatus;
  _count: { _all: number };
};

function emptyApplicationCounts(): CrewApplicationStatusCounts {
  return { total: 0, pending: 0, approved: 0, rejected: 0 };
}

function buildApplicationSummary(
  groups: ApplicationGroup[],
): CrewApplicationListSummary {
  const summary: CrewApplicationListSummary = {
    ...emptyApplicationCounts(),
    byPosition: {},
  };
  for (const group of groups) {
    const count = group._count._all;
    const position =
      summary.byPosition[group.positionId] ??
      (summary.byPosition[group.positionId] = emptyApplicationCounts());
    summary[group.status] += count;
    summary.total += count;
    position[group.status] += count;
    position.total += count;
  }
  return summary;
}

function normalizeExpectedCompensation(input: ApplyInput): {
  amount: number;
  currency: CurrencyCode;
  period: 'month' | 'episode' | 'project' | null;
} | null {
  const next = input.expectedCompensation;
  if (next?.amount != null && next.currency) {
    return {
      amount: next.amount,
      currency: next.currency,
      period: next.period ?? null,
    };
  }

  return null;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string };
  return e.code === 'P2002';
}
