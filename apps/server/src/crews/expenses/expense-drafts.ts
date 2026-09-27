import { requireExpenseReceipts } from './expense-receipts';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  RequireAdminPermissions,
} from '../../admin-auth';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CrewEarningSourceType,
  CrewEarningStatus,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { Public, CurrentUser, type AuthUser } from '../../auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';

export const ExpenseDraftDefinition = z
  .object({
    category: z.string().trim().max(120),
    purpose: z.string().trim().max(2000),
    occurredOn: z.string().date().nullable(),
    currency: z.enum(['USD', 'CNY']),
    amountMinor: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,14})$/)
      .nullable(),
    evidenceNote: z.string().trim().max(4000),
    receiptIds: z
      .array(z.string().uuid())
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
  })
  .strict();
export const SaveExpenseDraft = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    definition: ExpenseDraftDefinition,
  })
  .strict();
export const SubmitExpenseDraft = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
const Params = z.object({
  crewId: z.string().min(1).max(128),
  id: z.string().uuid(),
});
const SummaryParams = z.object({ crewId: z.string().min(1).max(128) });
const ListParams = z.object({ crewId: z.string().min(1).max(128) });
const ListQuery = z
  .object({
    after: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
const HistoryQuery = z
  .object({
    beforeVersion: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
type Row = {
  id: string;
  version: number;
  crewId: string;
  claimantUserId: string;
  definition: z.infer<typeof ExpenseDraftDefinition>;
  createdAt: Date;
};

@Injectable()
export class CrewExpenseDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: CrewAuthorizationService,
  ) {}

  async history(
    crewId: string,
    id: string,
    userId: string,
    query: z.infer<typeof HistoryQuery>,
  ) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT d.id, d.version, d.crew_id AS "crewId", d.claimant_user_id AS "claimantUserId",
        d.definition, d.created_at AS "createdAt", s.status AS "submissionStatus", s.submitted_at AS "submittedAt"
      FROM crew_expense_draft_revisions d LEFT JOIN crew_expense_submissions s
        ON s.draft_id=d.id AND s.draft_version=d.version
      WHERE d.id=${id}::uuid AND d.crew_id=${crewId} AND d.claimant_user_id=${userId}
        AND ${query.beforeVersion ? Prisma.sql`d.version < ${query.beforeVersion}` : Prisma.sql`TRUE`}
      ORDER BY d.version DESC LIMIT ${query.limit + 1}
    `);
    return {
      items: rows.slice(0, query.limit),
      nextCursor:
        rows.length > query.limit ? rows[query.limit - 1].version : null,
    };
  }

  async list(crewId: string, userId: string, query: z.infer<typeof ListQuery>) {
    // Ownership is sufficient for retained personal records after departure.
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT drafts.*, submission.status AS "submissionStatus", submission.submitted_at AS "submittedAt" FROM (
        SELECT DISTINCT ON (id) id, version, crew_id AS "crewId", claimant_user_id AS "claimantUserId", definition, created_at AS "createdAt"
        FROM crew_expense_draft_revisions WHERE crew_id = ${crewId} AND claimant_user_id = ${userId}
        ORDER BY id, version DESC
      ) drafts LEFT JOIN crew_expense_submissions submission ON submission.draft_id = drafts.id AND submission.draft_version = drafts.version WHERE ${query.after ? Prisma.sql`drafts.id > ${query.after}::uuid` : Prisma.sql`TRUE`}
      ORDER BY drafts.id LIMIT ${query.limit + 1}
    `);
    return {
      items: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    };
  }

  async save(
    crewId: string,
    id: string,
    userId: string,
    input: z.infer<typeof SaveExpenseDraft>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:expense-draft:${id}`}, 0))`;
      await tx.$queryRaw`SELECT id FROM crews WHERE id = ${crewId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM crew_members WHERE crew_id = ${crewId} AND user_id = ${userId} FOR SHARE`;
      await this.authz.requireMembership(crewId, userId, tx);
      const [before] = await tx.$queryRaw<Row[]>(
        Prisma.sql`SELECT id, version, crew_id AS "crewId", claimant_user_id AS "claimantUserId", definition, created_at AS "createdAt" FROM crew_expense_draft_revisions WHERE id = ${id}::uuid ORDER BY version DESC LIMIT 1`,
      );
      if (
        before &&
        (before.crewId !== crewId || before.claimantUserId !== userId)
      )
        throw new ConflictException('Draft identity is unavailable.');
      if (
        before?.version === input.expectedVersion + 1 &&
        JSON.stringify(ExpenseDraftDefinition.parse(before.definition)) ===
          JSON.stringify(input.definition)
      )
        return before;
      if ((before?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException('Draft changed. Refresh before saving.');
      const pending = await tx.$queryRaw<
        { draft_id: string }[]
      >`SELECT draft_id FROM crew_expense_submissions WHERE draft_id = ${id}::uuid AND status = 'pending'`;
      if (pending.length)
        throw new ConflictException('This claim is awaiting review.');
      await requireExpenseReceipts(tx, id, userId, input.definition.receiptIds);
      const [saved] = await tx.$queryRaw<Row[]>(Prisma.sql`
        INSERT INTO crew_expense_draft_revisions(id, version, crew_id, claimant_user_id, definition)
        VALUES (${id}::uuid, ${input.expectedVersion + 1}, ${crewId}, ${userId}, ${JSON.stringify(input.definition)}::jsonb)
        RETURNING id, version, crew_id AS "crewId", claimant_user_id AS "claimantUserId", definition, created_at AS "createdAt"
      `);
      await this.authz.requireMembership(crewId, userId, tx);
      return saved;
    });
  }
  async pending(query: z.infer<typeof ListQuery>) {
    const rows = await this.prisma.$queryRaw<
      (Row & { submittedAt: Date })[]
    >`SELECT d.id, d.version, d.crew_id AS "crewId", d.claimant_user_id AS "claimantUserId", d.definition, d.created_at AS "createdAt", s.submitted_at AS "submittedAt"
      FROM crew_expense_submissions s JOIN crew_expense_draft_revisions d ON d.id=s.draft_id AND d.version=s.draft_version
      WHERE s.status='pending' AND ${query.after ? Prisma.sql`d.id > ${query.after}::uuid` : Prisma.sql`TRUE`} ORDER BY d.id LIMIT ${query.limit + 1}`;
    return {
      items: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    };
  }

  async submit(
    crewId: string,
    id: string,
    userId: string,
    input: z.infer<typeof SubmitExpenseDraft>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:expense-draft:${id}`}, 0))`;
      await tx.$queryRaw`SELECT id FROM crews WHERE id = ${crewId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM crew_members WHERE crew_id = ${crewId} AND user_id = ${userId} FOR SHARE`;
      await this.authz.requireMembership(crewId, userId, tx);
      const [draft] = await tx.$queryRaw<
        Row[]
      >`SELECT id, version, definition FROM crew_expense_draft_revisions WHERE id = ${id}::uuid AND crew_id = ${crewId} AND claimant_user_id = ${userId} ORDER BY version DESC LIMIT 1`;
      if (!draft || draft.version !== input.expectedVersion)
        throw new ConflictException(
          'Draft changed or is unavailable. Refresh before submitting.',
        );
      const definition = ExpenseDraftDefinition.parse(draft.definition);
      if (
        !definition.category ||
        !definition.purpose ||
        !definition.occurredOn ||
        !definition.amountMinor ||
        BigInt(definition.amountMinor) <= 0n
      )
        throw new BadRequestException(
          'Category, purpose, expense date and a positive amount are required.',
        );
      await requireExpenseReceipts(tx, id, userId, definition.receiptIds);
      await tx.$executeRaw`INSERT INTO crew_expense_submissions(draft_id, draft_version) VALUES (${id}::uuid, ${draft.version}) ON CONFLICT (draft_id,draft_version) DO NOTHING`;
      await this.authz.requireMembership(crewId, userId, tx);
      const [submission] = await tx.$queryRaw<
        {
          draftId: string;
          draftVersion: number;
          status: string;
          submittedAt: Date;
        }[]
      >`SELECT draft_id AS "draftId", draft_version AS "draftVersion", status, submitted_at AS "submittedAt" FROM crew_expense_submissions WHERE draft_id = ${id}::uuid AND draft_version = ${draft.version}`;
      return submission;
    });
  }

  async getCrewSummary(crewId: string, userId: string) {
    await this.authz.require(crewId, userId, 'finance.ledger.view');

    const rewards = await this.prisma.crewEarningEntry.groupBy({
      by: ['currency'],
      where: {
        crewId,
        sourceType: CrewEarningSourceType.task_reward,
        status: CrewEarningStatus.posted,
      },
      _sum: { amountMinor: true },
    });

    const reimbursements = await this.prisma.$queryRaw<
      Array<{ currency: string; totalMinor: string }>
    >`SELECT d.definition->>'currency' AS currency,
             COALESCE(SUM((d.definition->>'amountMinor')::numeric), 0)::text AS "totalMinor"
      FROM crew_expense_submissions s
      JOIN crew_expense_draft_revisions d
        ON d.id = s.draft_id AND d.version = s.draft_version
      WHERE d.crew_id = ${crewId}
        AND s.status = 'approved'
      GROUP BY d.definition->>'currency'`;

    const taskRewardsByCurrency: Record<string, string> = {
      CNY: '0',
      USD: '0',
    };
    const reimbursementsByCurrency: Record<string, string> = {
      CNY: '0',
      USD: '0',
    };
    const totalByCurrency: Record<string, string> = { CNY: '0', USD: '0' };

    for (const row of rewards) {
      const v = (row._sum?.amountMinor ?? 0n).toString();
      if (row.currency in taskRewardsByCurrency)
        taskRewardsByCurrency[row.currency] = v;
    }
    for (const row of reimbursements) {
      if (row.currency in reimbursementsByCurrency)
        reimbursementsByCurrency[row.currency] = row.totalMinor;
    }
    for (const c of Object.keys(totalByCurrency)) {
      totalByCurrency[c] = (
        BigInt(taskRewardsByCurrency[c] ?? '0') +
        BigInt(reimbursementsByCurrency[c] ?? '0')
      ).toString();
    }
    return { taskRewardsByCurrency, reimbursementsByCurrency, totalByCurrency };
  }
}

@Controller('crews/:crewId/expense-drafts')
export class CrewExpenseDraftController {
  constructor(private readonly drafts: CrewExpenseDraftService) {}
  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  summary(
    @Param(new ZodValidationPipe(SummaryParams))
    params: z.infer<typeof SummaryParams>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.drafts
      .getCrewSummary(params.crewId, user.userId)
      .then((data) => ({ code: 200, data }));
  }
  @Get(':id/history')
  @Header('Cache-Control', 'private, no-store')
  history(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(HistoryQuery))
    query: z.infer<typeof HistoryQuery>,
  ) {
    return this.drafts.history(params.crewId, params.id, user.userId, query);
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Param(new ZodValidationPipe(ListParams))
    params: z.infer<typeof ListParams>,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>,
  ) {
    return this.drafts.list(params.crewId, user.userId, query);
  }
  @Post(':id/submit')
  @Header('Cache-Control', 'private, no-store')
  submit(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SubmitExpenseDraft))
    input: z.infer<typeof SubmitExpenseDraft>,
  ) {
    return this.drafts.submit(params.crewId, params.id, user.userId, input);
  }

  @Post(':id')
  @Header('Cache-Control', 'private, no-store')
  save(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SaveExpenseDraft))
    input: z.infer<typeof SaveExpenseDraft>,
  ) {
    return this.drafts.save(params.crewId, params.id, user.userId, input);
  }
}

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/crew-expense-submissions')
export class CrewExpenseSubmissionAdminController {
  constructor(private readonly drafts: CrewExpenseDraftService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  async pending(
    @Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>,
  ) {
    return { code: 200, data: await this.drafts.pending(query) };
  }
}
