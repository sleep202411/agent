import {
  Body,
  Controller,
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
  AgentMemoryParamsSchema,
  AgentUserParamsSchema,
  CreateAdminAgentUserSchema,
  ListAdminAgentUsersQuerySchema,
  ListAgentActionsQuerySchema,
  ListAgentMemoriesQuerySchema,
  ListAgentRunsQuerySchema,
  UpdateAgentMemorySchema,
  UpdateAdminAgentUserSchema,
  type AgentMemoryParams,
  type AgentUserParams,
  type CreateAdminAgentUserInput,
  type ListAdminAgentUsersQuery,
  type ListAgentActionsQuery,
  type ListAgentMemoriesQuery,
  type ListAgentRunsQuery,
  type UpdateAgentMemoryInput,
  type UpdateAdminAgentUserInput,
} from './dto';
import { AgentUsersService } from './agent-users.service';

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/agent-users')
export class AgentUsersAdminController {
  constructor(
    private readonly agentUsers: AgentUsersService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListAdminAgentUsersQuerySchema))
    query: ListAdminAgentUsersQuery,
  ) {
    return { code: 200, data: await this.agentUsers.listAdmin(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Post()
  @HttpCode(200)
  async create(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminAgentUserSchema))
    body: CreateAdminAgentUserInput,
    @Req() request: Request,
  ) {
    const agent = await this.agentUsers.createAdmin(body, admin.id);
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.agent_user.create',
      resourceType: 'agent_user',
      resourceId: agent.id,
      metadata: {
        handle: agent.handle,
        status: agent.status,
        identityStatus: agent.identityStatus,
        platformUserId: agent.platformUserId,
      },
      context: requestContext(request),
    });
    return { code: 200, data: agent };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get(':agentUserId')
  async get(
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
  ) {
    return {
      code: 200,
      data: await this.agentUsers.getAdmin(params.agentUserId),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Patch(':agentUserId')
  async update(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
    @Body(new ZodValidationPipe(UpdateAdminAgentUserSchema))
    body: UpdateAdminAgentUserInput,
    @Req() request: Request,
  ) {
    const before = await this.agentUsers.getAdmin(params.agentUserId);
    const after = await this.agentUsers.updateAdmin(
      params.agentUserId,
      body,
      admin.id,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.agent_user.update',
      resourceType: 'agent_user',
      resourceId: after.id,
      before: summarizeAgentUser(before),
      after: summarizeAgentUser(after),
      metadata: { fields: Object.keys(body) },
      context: requestContext(request),
    });
    return { code: 200, data: after };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get(':agentUserId/runs')
  async listRuns(
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
    @Query(new ZodValidationPipe(ListAgentRunsQuerySchema))
    query: ListAgentRunsQuery,
  ) {
    return {
      code: 200,
      data: await this.agentUsers.listRuns(params.agentUserId, query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get(':agentUserId/actions')
  async listActions(
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
    @Query(new ZodValidationPipe(ListAgentActionsQuerySchema))
    query: ListAgentActionsQuery,
  ) {
    return {
      code: 200,
      data: await this.agentUsers.listActions(params.agentUserId, query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get(':agentUserId/memories')
  async listMemories(
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
    @Query(new ZodValidationPipe(ListAgentMemoriesQuerySchema))
    query: ListAgentMemoriesQuery,
  ) {
    return {
      code: 200,
      data: await this.agentUsers.listMemories(params.agentUserId, query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Patch(':agentUserId/memories/:memoryId')
  async updateMemory(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AgentMemoryParamsSchema))
    params: AgentMemoryParams,
    @Body(new ZodValidationPipe(UpdateAgentMemorySchema))
    body: UpdateAgentMemoryInput,
    @Req() request: Request,
  ) {
    const memory = await this.agentUsers.updateMemory(
      params.agentUserId,
      params.memoryId,
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.agent_user.memory.update',
      resourceType: 'agent_memory',
      resourceId: memory.id,
      metadata: {
        agentUserId: params.agentUserId,
        fields: Object.keys(body),
        status: memory.status,
        type: memory.type,
      },
      context: requestContext(request),
    });
    return { code: 200, data: memory };
  }
}

function summarizeAgentUser(
  agent: Awaited<ReturnType<AgentUsersService['getAdmin']>>,
) {
  return {
    id: agent.id,
    handle: agent.handle,
    displayName: agent.displayName,
    status: agent.status,
    identityStatus: agent.identityStatus,
    platformUserId: agent.platformUserId,
    locale: agent.locale,
    region: agent.region,
    timezone: agent.timezone,
  };
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
