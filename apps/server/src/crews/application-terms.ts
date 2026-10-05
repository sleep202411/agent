import { SALARY_PERIODS, TASK_PAYMENT_TERMS } from '@repo/shared/crew';
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
import { randomUUID } from 'node:crypto';
import type { CrewApplicationTerms, Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { parseIdParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { CrewAuthorizationService } from './crew-authorization.service';
import { assertNewCrewCurrency } from './earnings/ledger-currency';

export const ApplicationTermsInput = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    scope: z.string().trim().min(1).max(10000),
    // Integer minor units on the wire, never floating-point cash.
    feeAmount: z.string().regex(/^(0|[1-9][0-9]{0,15})$/),
    currency: z.enum(['USD', 'CNY']),
    feePeriod: z.enum(SALARY_PERIODS),
    paymentTerms: z.enum(TASK_PAYMENT_TERMS).nullable().optional(),
    revenueShareBp: z.number().int().min(0).max(5000),
    shareBasis: z.string().trim().min(1).max(5000).nullable(),
  })
  .strict()
  .refine((value) => value.revenueShareBp === 0 || value.shareBasis !== null, {
    message: 'Revenue sharing requires an explicitly agreed calculation basis.',
    path: ['shareBasis'],
  });
const ConfirmInput = z
  .object({ version: z.number().int().positive().max(2147483647) })
  .strict();

const HistoryInput = z
  .object({
    beforeVersion: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

function dto(row: CrewApplicationTerms) {
  return {
    ...row,
    feeAmount: row.feeAmount.toString(),
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
  };
}

/** The application row serializes proposals, confirmation and approval. */
export async function assertApplicationTermsConfirmed(
  tx: Prisma.TransactionClient,
  applicationId: string,
  version: number,
) {
  if (version === 0) return; // Existing applications have no negotiated-terms record.
  const terms = await tx.crewApplicationTerms.findUnique({
    where: { applicationId_version: { applicationId, version } },
  });
  if (!terms?.confirmedAt)
    throw new ConflictException(
      'The applicant must confirm the latest terms before approval.',
    );
}

@Injectable()
export class CrewApplicationTermsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: CrewAuthorizationService,
  ) {}

  async list(
    applicationId: string,
    userId: string,
    query: z.infer<typeof HistoryInput> = { limit: 20 },
  ) {
    const page = HistoryInput.parse(query);
    const app = await this.db.crewApplication.findUnique({
      where: { id: applicationId },
      include: { crew: { select: { deletedAt: true } } },
    });
    if (!app || app.crew.deletedAt)
      throw new NotFoundException('Application not found.');
    if (app.applicantId !== userId)
      await this.auth.require(app.crewId, userId, 'applications.review');
    const rows = await this.db.crewApplicationTerms.findMany({
      where: {
        applicationId,
        version: {
          lte: app.termsVersion,
          ...(page.beforeVersion ? { lt: page.beforeVersion } : {}),
        },
      },
      take: page.limit + 1,
      orderBy: { version: 'desc' },
    });
    return {
      currentVersion: app.termsVersion,
      items: rows.slice(0, page.limit).map(dto),
      nextBeforeVersion:
        rows.length > page.limit ? rows[page.limit - 1].version : null,
    };
  }

  async propose(
    applicationId: string,
    userId: string,
    raw: z.infer<typeof ApplicationTermsInput>,
  ) {
    const input = ApplicationTermsInput.parse(raw);
    assertNewCrewCurrency(input.currency);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM crew_applications WHERE id=${applicationId} FOR UPDATE`;
      const app = await tx.crewApplication.findUnique({
        where: { id: applicationId },
        include: { crew: { select: { deletedAt: true } } },
      });
      if (!app || app.crew.deletedAt)
        throw new NotFoundException('Application not found.');
      await this.auth.require(app.crewId, userId, 'applications.review', tx);
      if (app.applicantId === userId)
        throw new ForbiddenException(
          'An applicant cannot propose their own final terms.',
        );
      if (app.status !== 'pending' && app.status !== 'approved')
        throw new ConflictException(
          'Only pending applications can negotiate terms.',
        );
      const position = await tx.crewPosition.findUniqueOrThrow({
        where: { id: app.positionId },
        select: { taskId: true },
      });
      if (position.taskId && BigInt(input.feeAmount) > 10_000_000_000n)
        throw new ConflictException(
          'The agreed fee exceeds the task reward limit.',
        );
      if (position.taskId && input.feePeriod !== 'project')
        throw new ConflictException(
          'Task recruitment requires a project fee; recurring rates cannot be settled as a task reward.',
        );
      if (app.termsVersion !== input.expectedVersion) {
        const previous = await tx.crewApplicationTerms.findUnique({
          where: {
            applicationId_version: {
              applicationId,
              version: input.expectedVersion + 1,
            },
          },
        });
        // Recover a lost response without creating another version or resetting confirmation.
        if (
          app.termsVersion === input.expectedVersion + 1 &&
          previous &&
          previous.proposedByUserId === userId &&
          previous.scope === input.scope &&
          previous.feeAmount === BigInt(input.feeAmount) &&
          previous.currency === input.currency &&
          previous.feePeriod === input.feePeriod &&
          (previous.paymentTerms ?? null) === (input.paymentTerms ?? null) &&
          previous.revenueShareBp === input.revenueShareBp &&
          previous.shareBasis === input.shareBasis
        )
          return dto(previous);
        throw new ConflictException(
          'Terms changed. Read the latest version before proposing again.',
        );
      }
      // Approval permits recovery of the identical saved offer above, never a new proposal.
      if (app.status !== 'pending')
        throw new ConflictException(
          'Only pending applications can negotiate terms.',
        );
      const row = await tx.crewApplicationTerms.create({
        data: {
          id: randomUUID(),
          applicationId,
          version: input.expectedVersion + 1,
          scope: input.scope,
          feeAmount: BigInt(input.feeAmount),
          currency: input.currency,
          feePeriod: input.feePeriod,
          paymentTerms: input.paymentTerms ?? null,
          revenueShareBp: input.revenueShareBp,
          shareBasis: input.shareBasis,
          proposedByUserId: userId,
        },
      });
      await tx.crewApplication.update({
        where: { id: applicationId },
        data: { termsVersion: row.version },
      });
      return dto(row);
    });
  }

  async confirm(applicationId: string, userId: string, version: number) {
    ConfirmInput.parse({ version });
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM crew_applications WHERE id=${applicationId} FOR UPDATE`;
      const app = await tx.crewApplication.findUnique({
        where: { id: applicationId },
        include: { crew: { select: { deletedAt: true } } },
      });
      if (!app || app.crew.deletedAt)
        throw new NotFoundException('Application not found.');
      if (app.applicantId !== userId)
        throw new ForbiddenException(
          'Only the applicant can confirm these terms.',
        );
      if (app.termsVersion !== version)
        throw new ConflictException(
          'Terms changed. Review the latest version before confirming.',
        );
      const row = await tx.crewApplicationTerms.findUnique({
        where: { applicationId_version: { applicationId, version } },
      });
      if (!row) throw new NotFoundException('Terms not found.');
      if (
        row.confirmedAt &&
        (app.status === 'pending' || app.status === 'approved')
      )
        return dto(row);
      if (app.status !== 'pending')
        throw new ConflictException('This application is no longer pending.');
      return dto(
        await tx.crewApplicationTerms.update({
          where: { id: row.id },
          data: { confirmedAt: new Date() },
        }),
      );
    });
  }
}

@Controller('applications/:applicationId/terms')
export class CrewApplicationTermsController {
  constructor(private readonly svc: CrewApplicationTermsService) {}
  @Get()
  list(
    @Param('applicationId') id: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(HistoryInput))
    query: z.infer<typeof HistoryInput>,
  ) {
    return this.svc.list(parseIdParam(id, 'applicationId'), user.userId, query);
  }
  @Post()
  propose(
    @Param('applicationId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ApplicationTermsInput))
    body: z.infer<typeof ApplicationTermsInput>,
  ) {
    return this.svc.propose(
      parseIdParam(id, 'applicationId'),
      user.userId,
      body,
    );
  }
  @Post('confirm')
  confirm(
    @Param('applicationId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ConfirmInput))
    body: z.infer<typeof ConfirmInput>,
  ) {
    return this.svc.confirm(
      parseIdParam(id, 'applicationId'),
      user.userId,
      body.version,
    );
  }
}
