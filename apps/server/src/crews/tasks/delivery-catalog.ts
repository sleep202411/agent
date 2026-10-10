import { findActiveDeliveryCategory } from './task-delivery-binding';
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { Public, CurrentUser, type AuthUser } from '../../auth';
import { CrewAuthorizationService } from '../crew-authorization.service';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../../admin-auth';
import { ZodValidationPipe } from '../../common/zod.pipe';

const Field = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
    label: z.string().trim().min(1).max(120),
    instructions: z.string().trim().max(1000),
    type: z.enum(['text', 'attachment']),
    required: z.boolean(),
  })
  .strict();
export const DeliveryDefinition = z
  .object({
    approvalPolicy: z.enum(['standard', 'fd3_or_production_lead']).optional(),
    categoryKey: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,47}$/)
      .optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
    status: z.enum(['active', 'archived']),
    prices: z
      .array(
        z
          .object({
            currency: z.enum(['USD', 'CNY']),
            amountMinor: z.string().regex(/^(0|[1-9][0-9]{0,14})$/),
            unit: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .max(2)
      .refine(
        (rows) => new Set(rows.map((row) => row.currency)).size === rows.length,
        'Duplicate currency',
      ),
    fields: z
      .array(Field)
      .min(1)
      .max(40)
      .refine(
        (rows) => new Set(rows.map((row) => row.key)).size === rows.length,
        'Duplicate field key',
      ),
  })
  .strict();
export const SaveDeliveryCategory = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(1000),
    definition: DeliveryDefinition,
  })
  .strict();
const Params = z.object({ id: z.string().uuid() });
const ListQuery = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type DeliveryCategory = {
  id: string;
  version: number;
  definition: z.infer<typeof DeliveryDefinition>;
};
type Stored = DeliveryCategory & { actorId: string; reason: string };

@Injectable()
export class CrewDeliveryCatalogService {
  constructor(private readonly db: PrismaService) {}
  async list(query: z.infer<typeof ListQuery>, activeOnly = false) {
    const rows = await this.db.$queryRaw<DeliveryCategory[]>(Prisma.sql`
      SELECT category_id AS id, version, definition FROM (
        SELECT DISTINCT ON (category_id) category_id, version, definition
        FROM crew_delivery_catalog_revisions ORDER BY category_id, version DESC
      ) current WHERE TRUE
      ${query.cursor ? Prisma.sql`AND category_id > ${query.cursor}::uuid` : Prisma.empty}
      ${activeOnly ? Prisma.sql`AND definition->>'status'='active'` : Prisma.empty}
      ORDER BY category_id LIMIT ${query.limit + 1}`);
    const items = rows.slice(0, query.limit);
    return {
      items,
      nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
    };
  }
  async save(
    actor: AdminActor,
    id: string,
    input: z.infer<typeof SaveDeliveryCategory>,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:delivery-catalog:${id}`},0))`;
      await tx.$queryRaw`SELECT s.id FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
        JOIN admin_user_roles ur ON ur.user_id=u.id JOIN admin_role_permissions rp ON rp.role_id=ur.role_id
        JOIN admin_permissions p ON p.id=rp.permission_id
        WHERE s.id=${actor.sessionId}::uuid AND u.id=${actor.id}::uuid AND p.key=${ADMIN_PERMISSION_KEYS.CrewManage}
        FOR SHARE OF s,u,ur,rp,p`;
      const check = async () => {
        const [row] = await tx.$queryRaw<
          Array<{ allowed: boolean }>
        >`SELECT EXISTS(
          SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
          JOIN admin_user_roles ur ON ur.user_id=u.id JOIN admin_role_permissions rp ON rp.role_id=ur.role_id
          JOIN admin_permissions p ON p.id=rp.permission_id
          WHERE s.id=${actor.sessionId}::uuid AND u.id=${actor.id}::uuid
          AND s.status='active' AND s.expires_at>clock_timestamp() AND u.status='active'
          AND p.key=${ADMIN_PERMISSION_KEYS.CrewManage}) AS allowed`;
        if (!row?.allowed)
          throw new ForbiddenException(
            'Current Crew administration permission is required.',
          );
      };
      await check();
      const [before] = await tx.$queryRaw<
        Stored[]
      >`SELECT category_id AS id, version, definition, created_by AS "actorId", reason
        FROM crew_delivery_catalog_revisions WHERE category_id=${id}::uuid ORDER BY version DESC LIMIT 1`;
      const definitionJson = JSON.stringify(input.definition);
      if (
        before?.version === input.expectedVersion + 1 &&
        before.actorId === actor.id &&
        before.reason === input.reason
      ) {
        const [replay] = await tx.$queryRaw<
          Array<{ same: boolean }>
        >`SELECT definition=${definitionJson}::jsonb AS same
          FROM crew_delivery_catalog_revisions WHERE category_id=${id}::uuid AND version=${before.version}`;
        if (replay?.same)
          return { id, version: before.version, definition: before.definition };
      }
      if ((before?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException('Category changed. Refresh before saving.');
      if (
        input.definition.categoryKey &&
        input.definition.status === 'active'
      ) {
        const duplicate = await findActiveDeliveryCategory(
          tx,
          input.definition.categoryKey,
          id,
        );
        if (duplicate) {
          throw new ConflictException(
            `categoryKey "${input.definition.categoryKey}" is already in use by another active category.`,
          );
        }
      }
      const after = {
        id,
        version: input.expectedVersion + 1,
        definition: input.definition,
      };
      await tx.$executeRaw`INSERT INTO crew_delivery_catalog_revisions(category_id,version,definition,created_by,reason)
        VALUES (${id}::uuid,${after.version},${definitionJson}::jsonb,${actor.id}::uuid,${input.reason})`;
      await tx.adminAuditLog.create({
        data: {
          actorUserId: actor.id,
          actorSessionId: actor.sessionId,
          siteScope: actor.siteScope,
          action: 'admin.crew.delivery_catalog',
          resourceType: 'crew_delivery_category',
          resourceId: id,
          reason: input.reason,
          before: before
            ? { id, version: before.version, definition: before.definition }
            : Prisma.JsonNull,
          after,
        },
      });
      await check();
      return after;
    });
  }
}

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/crew-delivery-catalog')
export class CrewDeliveryCatalogAdminController {
  constructor(private readonly service: CrewDeliveryCatalogService) {}
  @Get()
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  async list(
    @Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>,
  ) {
    return { code: 200, data: await this.service.list(query) };
  }
  @Post(':id')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  async save(
    @CurrentAdmin() actor: AdminActor,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @Body(new ZodValidationPipe(SaveDeliveryCategory))
    input: z.infer<typeof SaveDeliveryCategory>,
  ) {
    return {
      code: 200,
      data: await this.service.save(actor, params.id, input),
    };
  }
}

@Controller('crews/:crewId/delivery-catalog')
export class CrewDeliveryCatalogController {
  constructor(
    private readonly service: CrewDeliveryCatalogService,
    private readonly authorization: CrewAuthorizationService,
  ) {}
  @Get()
  async list(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>,
  ) {
    await this.authorization.require(crewId, user.userId, 'tasks.view');
    return this.service.list(query, true);
  }
}
