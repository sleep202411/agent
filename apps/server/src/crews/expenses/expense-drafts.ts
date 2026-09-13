import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../auth';
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
  })
  .strict();
export const SaveExpenseDraft = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    definition: ExpenseDraftDefinition,
  })
  .strict();
const Params = z.object({
  crewId: z.string().min(1).max(128),
  id: z.string().uuid(),
});
const ListParams = z.object({ crewId: z.string().min(1).max(128) });
const ListQuery = z
  .object({
    after: z.string().uuid().optional(),
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

  async list(crewId: string, userId: string, query: z.infer<typeof ListQuery>) {
    // Ownership is sufficient for retained personal records after departure.
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT * FROM (
        SELECT DISTINCT ON (id) id, version, crew_id AS "crewId", claimant_user_id AS "claimantUserId", definition, created_at AS "createdAt"
        FROM crew_expense_draft_revisions WHERE crew_id = ${crewId} AND claimant_user_id = ${userId}
        ORDER BY id, version DESC
      ) drafts WHERE ${query.after ? Prisma.sql`id > ${query.after}::uuid` : Prisma.sql`TRUE`}
      ORDER BY id LIMIT ${query.limit + 1}
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
      const [saved] = await tx.$queryRaw<Row[]>(Prisma.sql`
        INSERT INTO crew_expense_draft_revisions(id, version, crew_id, claimant_user_id, definition)
        VALUES (${id}::uuid, ${input.expectedVersion + 1}, ${crewId}, ${userId}, ${JSON.stringify(input.definition)}::jsonb)
        RETURNING id, version, crew_id AS "crewId", claimant_user_id AS "claimantUserId", definition, created_at AS "createdAt"
      `);
      await this.authz.requireMembership(crewId, userId, tx);
      return saved;
    });
  }
}

@Controller('crews/:crewId/expense-drafts')
export class CrewExpenseDraftController {
  constructor(private readonly drafts: CrewExpenseDraftService) {}
  @Get()
  list(
    @Param(new ZodValidationPipe(ListParams))
    params: z.infer<typeof ListParams>,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>,
  ) {
    return this.drafts.list(params.crewId, user.userId, query);
  }
  @Post(':id')
  save(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SaveExpenseDraft))
    input: z.infer<typeof SaveExpenseDraft>,
  ) {
    return this.drafts.save(params.crewId, params.id, user.userId, input);
  }
}
