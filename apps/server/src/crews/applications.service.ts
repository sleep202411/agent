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
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import type { ApplyInput } from './dto';
import { toApplicationDTO } from './mappers';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
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

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const app = await tx.crewApplication.create({
          data: {
            crewId,
            positionId,
            applicantId,
            message: input.message ?? null,
            portfolioUrl: input.portfolioUrl ?? null,
            // Yuan → 分.
            expectedSalaryCents:
              input.expectedSalary != null
                ? BigInt(input.expectedSalary * 100)
                : null,
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
              deeplink: `/crews/${crewId}?tab=applications`,
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
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedApp = await tx.crewApplication.update({
        where: { id: applicationId },
        data: { status: next, reviewedAt, reviewerId },
      });

      if (next === 'approved') {
        const newCount = app.position.recruitedCount + 1;
        const flipFull = newCount >= app.position.targetCount;
        await tx.crewPosition.update({
          where: { id: app.position.id },
          data: {
            recruitedCount: newCount,
            ...(flipFull ? { status: 'full' as const } : {}),
          },
        });

        // Plain insert — partial unique on (crewId, userId) WHERE
        // removed_at IS NULL means a previously removed member becomes
        // a new active row, preserving the history.
        await tx.crewMember.create({
          data: {
            crewId: app.crewId,
            userId: app.applicantId,
            roleType: app.position.positionType,
            positionId: app.position.id,
            via: 'application',
          },
        });
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
            deeplink: `/crews/${app.crewId}`,
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

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string };
  return e.code === 'P2002';
}
