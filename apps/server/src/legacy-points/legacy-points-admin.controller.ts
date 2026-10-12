/**
 * Admin endpoints for legacy (Java) points. Mounted at
 * `/admin/legacy-points` — the admin-ui proxies browser → Next route
 * handler → here. Auth + audit mirror BillingAdminController exactly.
 *
 * Permission: `user.read` (lookup/records) / `user.write` (grant) — the
 * 用户管理 domain's own keys, so customer service can manage end-user
 * points without billing write access.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminAuthService,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  GrantLegacyPointsSchema,
  LegacyUserParamsSchema,
  ListLegacyLedgerQuerySchema,
  ListLegacyRecordsQuerySchema,
  LegacyUsersByIdsQuerySchema,
  SearchMembersQuerySchema,
  type GrantLegacyPointsInput,
  type LegacyUserParams,
  type ListLegacyLedgerQuery,
  type ListLegacyRecordsQuery,
  type LegacyUsersByIdsQuery,
  type SearchMembersQuery,
} from './dto';
import { LegacyPointsService } from './legacy-points.service';

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/legacy-points')
export class LegacyPointsAdminController {
  constructor(
    private readonly legacyPoints: LegacyPointsService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.UserRead)
  @Get('users')
  async search(
    @Query(new ZodValidationPipe(SearchMembersQuerySchema))
    query: SearchMembersQuery,
  ) {
    return {
      code: 200,
      data: await this.legacyPoints.searchMembers({
        query: query.query,
        page: query.page,
        pageSize: query.pageSize,
      }),
    };
  }

  // Flat path, same reason as `users-by-ids`: `users/:identifier` swallows
  // `users/emails` and `findUser('emails')` returns null (HTTP 200).
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.UserRead)
  @Get('users-emails')
  async exportEmails(
    @CurrentAdmin() admin: AdminActor,
    @Req() request: Request,
  ) {
    const data = await this.legacyPoints.exportActiveEmails();
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.legacy_points.export_active_emails',
      resourceType: 'legacy_client_user',
      resourceId: 'active-emails',
      metadata: { count: data.count },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.UserRead)
  @Get('users-by-ids')
  async byIds(
    @Query(new ZodValidationPipe(LegacyUsersByIdsQuerySchema))
    query: LegacyUsersByIdsQuery,
  ) {
    return {
      code: 200,
      data: { items: await this.legacyPoints.findUsersByIds(query.ids) },
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.UserRead)
  @Get('users/:identifier')
  async lookup(
    @Param(new ZodValidationPipe(LegacyUserParamsSchema))
    params: LegacyUserParams,
  ) {
    return {
      code: 200,
      data: await this.legacyPoints.findUser(params.identifier),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.UserRead)
  @Get('ledger')
  async ledger(
    @Query(new ZodValidationPipe(ListLegacyLedgerQuerySchema))
    query: ListLegacyLedgerQuery,
  ) {
    return {
      code: 200,
      data: await this.legacyPoints.listLedgerRecords({
        query: query.query,
        recordType: query.recordType,
        page: query.page,
        pageSize: query.pageSize,
      }),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.UserRead)
  @Get('records')
  async records(
    @Query(new ZodValidationPipe(ListLegacyRecordsQuerySchema))
    query: ListLegacyRecordsQuery,
  ) {
    return {
      code: 200,
      data: await this.legacyPoints.listRecentRecords(
        query.identifier,
        query.limit,
      ),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.UserWrite)
  @Post('grant')
  async grant(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(GrantLegacyPointsSchema))
    body: GrantLegacyPointsInput,
    @Req() request: Request,
  ) {
    const data = await this.legacyPoints.grantPoints({
      identifier: body.identifier,
      score: body.score,
      operatorId: admin.id,
      note: body.note,
    });
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.legacy_points.grant',
      resourceType: 'legacy_client_user',
      resourceId: data.userId,
      metadata: {
        identifier: body.identifier,
        delta: data.delta,
        previousBalance: data.previousBalance,
        newBalance: data.newBalance,
        recordId: data.recordId,
        note: body.note ?? '',
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return { code: 200, data };
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}
