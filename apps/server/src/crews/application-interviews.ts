import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { CrewApplicationInterviewEvent, Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { parseIdParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { CrewAuthorizationService } from './crew-authorization.service';

export const InterviewInput = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    requestKey: z.string().uuid(),
    action: z.enum(['schedule', 'confirm', 'complete', 'cancel', 'message']),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    message: z.string().trim().min(1).max(4000),
  })
  .strict()
  .refine(
    (value) =>
      (value.action === 'schedule') === (value.scheduledAt !== undefined),
    {
      message: 'Only scheduling supplies a required interview time.',
      path: ['scheduledAt'],
    },
  );
const PageInput = z
  .object({
    beforeVersion: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

function eventDto(row: CrewApplicationInterviewEvent) {
  return {
    id: row.id,
    applicationId: row.applicationId,
    version: row.version,
    requestKey: row.requestKey,
    actorUserId: row.actorUserId,
    action: row.action,
    state: row.state,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Called while approval holds the application row lock. */
export async function assertInterviewResolved(
  tx: Prisma.TransactionClient,
  applicationId: string,
) {
  const latest = await tx.crewApplicationInterviewEvent.findFirst({
    where: { applicationId },
    orderBy: { version: 'desc' },
    select: { state: true },
  });
  if (latest && ['proposed', 'confirmed'].includes(latest.state))
    throw new ConflictException(
      'Complete or cancel the pending interview before approving the application.',
    );
}

@Injectable()
export class CrewApplicationInterviewsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: CrewAuthorizationService,
  ) {}

  private async access(
    tx: Prisma.TransactionClient,
    applicationId: string,
    userId: string,
  ) {
    const app = await tx.crewApplication.findUnique({
      where: { id: applicationId },
      include: { crew: { select: { deletedAt: true } } },
    });
    if (!app || app.crew.deletedAt)
      throw new NotFoundException('Application not found.');
    if (app.applicantId !== userId)
      await this.auth.require(app.crewId, userId, 'applications.review', tx);
    return app;
  }

  async list(
    applicationId: string,
    userId: string,
    raw: z.infer<typeof PageInput> = { limit: 20 },
  ) {
    const page = PageInput.parse(raw);
    const app = await this.access(this.db, applicationId, userId);
    const latest = await this.db.crewApplicationInterviewEvent.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
    });
    const rows = await this.db.crewApplicationInterviewEvent.findMany({
      where: {
        applicationId,
        version: {
          lte: latest?.version ?? 0,
          ...(page.beforeVersion ? { lt: page.beforeVersion } : {}),
        },
      },
      orderBy: { version: 'desc' },
      take: page.limit + 1,
    });
    return {
      applicationStatus: app.status,
      canUpdate: app.status === 'pending',
      canMessage:
        app.status === 'pending' ||
        (app.status === 'approved' &&
          Boolean(await this.auth.resolve(app.crewId, userId, this.db))),
      version: latest?.version ?? 0,
      state: latest?.state ?? 'not_started',
      scheduledAt: latest?.scheduledAt ?? null,
      items: rows.slice(0, page.limit).map(eventDto),
      nextBeforeVersion:
        rows.length > page.limit ? rows[page.limit - 1].version : null,
    };
  }

  async update(
    applicationId: string,
    userId: string,
    raw: z.infer<typeof InterviewInput>,
  ) {
    const input = InterviewInput.parse(raw);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM crew_applications WHERE id=${applicationId} FOR UPDATE`;
      const app = await this.access(tx, applicationId, userId);
      const retry = await tx.crewApplicationInterviewEvent.findUnique({
        where: {
          applicationId_requestKey: {
            applicationId,
            requestKey: input.requestKey,
          },
        },
      });
      if (retry) {
        if (retry.actorUserId !== userId || retry.fingerprint !== fingerprint)
          throw new ConflictException(
            'The request key was already used for a different interview update.',
          );
        return eventDto(retry);
      }
      if (app.status === 'approved' && input.action === 'message')
        await this.auth.requireMembership(app.crewId, userId, tx);
      else if (app.status !== 'pending')
        throw new ConflictException(
          'Reviewed applications cannot change interview history.',
        );
      const latest = await tx.crewApplicationInterviewEvent.findFirst({
        where: { applicationId },
        orderBy: { version: 'desc' },
      });
      if ((latest?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException(
          'Interview progress changed. Read the latest version and retry.',
        );
      let state = latest?.state ?? 'not_started';
      let scheduledAt = latest?.scheduledAt ?? null;
      const applicant = app.applicantId === userId;
      if (input.action === 'schedule') {
        if (applicant)
          throw new ForbiddenException(
            'Only a reviewer can propose an interview time.',
          );
        scheduledAt = new Date(input.scheduledAt!);
        if (scheduledAt <= new Date())
          throw new ConflictException('Interview time must be in the future.');
        state = 'proposed';
      } else if (input.action === 'confirm') {
        if (!applicant)
          throw new ForbiddenException(
            'Only the applicant can confirm the proposed interview.',
          );
        if (state !== 'proposed' || !scheduledAt || scheduledAt <= new Date())
          throw new ConflictException(
            'There is no future proposed interview to confirm.',
          );
        state = 'confirmed';
      } else if (input.action === 'complete') {
        if (applicant)
          throw new ForbiddenException(
            'Only a reviewer can record interview completion.',
          );
        if (state !== 'confirmed' || !scheduledAt || scheduledAt > new Date())
          throw new ConflictException(
            'Only a confirmed interview that has started can be completed.',
          );
        state = 'completed';
      } else if (input.action === 'cancel') {
        if (!['proposed', 'confirmed'].includes(state))
          throw new ConflictException(
            'There is no pending interview to cancel.',
          );
        state = 'cancelled';
      }
      const row = await tx.crewApplicationInterviewEvent.create({
        data: {
          id: randomUUID(),
          applicationId,
          version: input.expectedVersion + 1,
          requestKey: input.requestKey,
          fingerprint,
          actorUserId: userId,
          action: input.action,
          state,
          scheduledAt,
          message: input.message,
        },
      });
      return eventDto(row);
    });
  }
}

@Controller('applications/:applicationId/interview')
export class CrewApplicationInterviewsController {
  constructor(private readonly svc: CrewApplicationInterviewsService) {}
  @Get()
  list(
    @Param('applicationId') id: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(PageInput)) page: z.infer<typeof PageInput>,
  ) {
    return this.svc.list(parseIdParam(id, 'applicationId'), user.userId, page);
  }
  @Post()
  update(
    @Param('applicationId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(InterviewInput))
    input: z.infer<typeof InterviewInput>,
  ) {
    return this.svc.update(
      parseIdParam(id, 'applicationId'),
      user.userId,
      input,
    );
  }
}
