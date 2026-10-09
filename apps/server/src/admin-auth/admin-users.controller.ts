import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ADMIN_PERMISSION_KEYS } from './admin-auth.constants';
import { CurrentAdmin, RequireAdminPermissions } from './admin-auth.decorator';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import type { AdminActor } from './admin-auth.types';
import { AdminPermissionGuard } from './admin-permission.guard';
import {
  AdminRoleParamsSchema,
  AdminUserParamsSchema,
  AdminUserSessionParamsSchema,
  CreateAdminRoleSchema,
  CreateAdminUserSchema,
  ListAdminSessionsQuerySchema,
  ListAdminUsersQuerySchema,
  ResetAdminPasswordSchema,
  UpdateAdminRoleSchema,
  UpdateAdminUserSchema,
  type AdminRoleParams,
  type AdminUserParams,
  type AdminUserSessionParams,
  type CreateAdminRoleInput,
  type CreateAdminUserInput,
  type ListAdminSessionsQuery,
  type ListAdminUsersQuery,
  type ResetAdminPasswordInput,
  type UpdateAdminRoleInput,
  type UpdateAdminUserInput,
} from './admin-users.dto';
import { AdminUsersService } from './admin-users.service';

@Public()
@Controller('admin/users')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AdminManage)
export class AdminUsersController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListAdminUsersQuerySchema))
    query: ListAdminUsersQuery,
  ) {
    return { code: 200, data: await this.adminUsers.list(query) };
  }

  @Post()
  @HttpCode(200)
  async create(
    @CurrentAdmin() actor: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminUserSchema))
    body: CreateAdminUserInput,
    @Req() request: Request,
  ) {
    const user = await this.adminUsers.create(body);
    await this.adminAuth.writeAudit({
      actor,
      action: 'admin.user.create',
      resourceType: 'admin_user',
      resourceId: user.id,
      metadata: {
        email: user.email,
        siteScope: user.siteScope,
        status: user.status,
      },
      context: requestContext(request),
    });
    return { code: 200, data: user };
  }

  // Static segments must be declared before the `:userId` param routes below,
  // otherwise Express matches `/roles` and `/sessions` as `:userId`.
  @Get('roles')
  async listRoles() {
    return { code: 200, data: await this.adminUsers.listRoles() };
  }

  @Post('roles')
  @HttpCode(200)
  async createRole(
    @CurrentAdmin() actor: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminRoleSchema))
    body: CreateAdminRoleInput,
    @Req() request: Request,
  ) {
    const data = await this.adminUsers.createRole(body);
    await this.adminAuth.writeAudit({
      actor,
      action: 'admin.role.create',
      resourceType: 'admin_role',
      resourceId: body.key,
      metadata: { name: body.name, permissions: body.permissions },
      context: requestContext(request),
    });
    return { code: 200, data };
  }

  @Patch('roles/:roleKey')
  async updateRole(
    @CurrentAdmin() actor: AdminActor,
    @Param(new ZodValidationPipe(AdminRoleParamsSchema))
    params: AdminRoleParams,
    @Body(new ZodValidationPipe(UpdateAdminRoleSchema))
    body: UpdateAdminRoleInput,
    @Req() request: Request,
  ) {
    const data = await this.adminUsers.updateRole(params.roleKey, body);
    await this.adminAuth.writeAudit({
      actor,
      action: 'admin.role.update',
      resourceType: 'admin_role',
      resourceId: params.roleKey,
      metadata: { fields: Object.keys(body) },
      context: requestContext(request),
    });
    return { code: 200, data };
  }

  @Delete('roles/:roleKey')
  @HttpCode(200)
  async deleteRole(
    @CurrentAdmin() actor: AdminActor,
    @Param(new ZodValidationPipe(AdminRoleParamsSchema))
    params: AdminRoleParams,
    @Req() request: Request,
  ) {
    const data = await this.adminUsers.deleteRole(params.roleKey);
    await this.adminAuth.writeAudit({
      actor,
      action: 'admin.role.delete',
      resourceType: 'admin_role',
      resourceId: params.roleKey,
      context: requestContext(request),
    });
    return { code: 200, data };
  }

  @Get('sessions')
  async listAllSessions(
    @Query(new ZodValidationPipe(ListAdminSessionsQuerySchema))
    query: ListAdminSessionsQuery,
  ) {
    return { code: 200, data: await this.adminUsers.listAllSessions(query) };
  }

  @Get(':userId')
  async get(
    @Param(new ZodValidationPipe(AdminUserParamsSchema))
    params: AdminUserParams,
  ) {
    return { code: 200, data: await this.adminUsers.getById(params.userId) };
  }

  @Patch(':userId')
  async update(
    @CurrentAdmin() actor: AdminActor,
    @Param(new ZodValidationPipe(AdminUserParamsSchema))
    params: AdminUserParams,
    @Body(new ZodValidationPipe(UpdateAdminUserSchema))
    body: UpdateAdminUserInput,
    @Req() request: Request,
  ) {
    const before = await this.adminUsers.getById(params.userId);
    const after = await this.adminUsers.update(actor, params.userId, body);
    await this.adminAuth.writeAudit({
      actor,
      action: 'admin.user.update',
      resourceType: 'admin_user',
      resourceId: after.id,
      before: summarizeAdminUser(before),
      after: summarizeAdminUser(after),
      metadata: { fields: Object.keys(body) },
      context: requestContext(request),
    });
    return { code: 200, data: after };
  }

  @Post(':userId/reset-password')
  @HttpCode(200)
  async resetPassword(
    @CurrentAdmin() actor: AdminActor,
    @Param(new ZodValidationPipe(AdminUserParamsSchema))
    params: AdminUserParams,
    @Body(new ZodValidationPipe(ResetAdminPasswordSchema))
    body: ResetAdminPasswordInput,
    @Req() request: Request,
  ) {
    const user = await this.adminUsers.resetPassword(
      params.userId,
      body.password,
      actor.id === params.userId ? actor.sessionId : undefined,
    );
    await this.adminAuth.writeAudit({
      actor,
      action: 'admin.user.password.reset',
      resourceType: 'admin_user',
      resourceId: user.id,
      metadata: { email: user.email },
      context: requestContext(request),
    });
    return { code: 200, data: user };
  }

  @Post(':userId/reset-mfa')
  @HttpCode(200)
  async resetMfa(
    @CurrentAdmin() actor: AdminActor,
    @Param(new ZodValidationPipe(AdminUserParamsSchema))
    params: AdminUserParams,
    @Req() request: Request,
  ) {
    const user = await this.adminUsers.resetMfa(
      params.userId,
      actor.id === params.userId ? actor.sessionId : undefined,
    );
    await this.adminAuth.writeAudit({
      actor,
      action: 'admin.user.mfa.reset',
      resourceType: 'admin_user',
      resourceId: user.id,
      metadata: { email: user.email, requireMfa: user.requireMfa },
      context: requestContext(request),
    });
    return { code: 200, data: user };
  }

  @Post(':userId/revoke-sessions')
  @HttpCode(200)
  async revokeSessions(
    @CurrentAdmin() actor: AdminActor,
    @Param(new ZodValidationPipe(AdminUserParamsSchema))
    params: AdminUserParams,
    @Req() request: Request,
  ) {
    const user = await this.adminUsers.getById(params.userId);
    const result = await this.adminUsers.revokeSessions(
      params.userId,
      actor.id === params.userId ? actor.sessionId : undefined,
    );
    await this.adminAuth.writeAudit({
      actor,
      action: 'admin.user.sessions.revoke',
      resourceType: 'admin_user',
      resourceId: user.id,
      metadata: { email: user.email, revokedCount: result.revokedCount },
      context: requestContext(request),
    });
    return { code: 200, data: result };
  }

  @Get(':userId/sessions')
  async listSessions(
    @Param(new ZodValidationPipe(AdminUserParamsSchema))
    params: AdminUserParams,
  ) {
    return {
      code: 200,
      data: await this.adminUsers.listSessions(params.userId),
    };
  }

  @Post(':userId/sessions/:sessionId/revoke')
  @HttpCode(200)
  async revokeSession(
    @CurrentAdmin() actor: AdminActor,
    @Param(new ZodValidationPipe(AdminUserSessionParamsSchema))
    params: AdminUserSessionParams,
    @Req() request: Request,
  ) {
    const result = await this.adminUsers.revokeSession(
      params.userId,
      params.sessionId,
      actor.id === params.userId ? actor.sessionId : undefined,
    );
    await this.adminAuth.writeAudit({
      actor,
      action: 'admin.user.session.revoke',
      resourceType: 'admin_session',
      resourceId: params.sessionId,
      metadata: {
        targetUserId: params.userId,
        revokedCount: result.revokedCount,
      },
      context: requestContext(request),
    });
    return { code: 200, data: result };
  }
}

function requestContext(request: Request) {
  return {
    ipAddress: request.ip,
    userAgent: headerValue(request.headers['user-agent']),
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

type AdminUserSummary = Awaited<ReturnType<AdminUsersService['getById']>>;

function summarizeAdminUser(user: AdminUserSummary) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    siteScope: user.siteScope,
    platformUserId: user.platformUserId,
    roleKeys: user.roleKeys,
    roleKey: user.roleKey,
    requireMfa: user.requireMfa,
    mfaEnabledAt: user.mfaEnabledAt,
    lockedUntil: user.lockedUntil,
  };
}
