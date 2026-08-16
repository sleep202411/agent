import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  BindWorldTravelRequestSchema,
  CloseWorldSessionRequestSchema,
  CreateWorldRequestSchema,
  CreateWorldSessionRequestSchema,
  RefreshWorldSessionTokenRequestSchema,
  ReportWorldTravelStatusRequestSchema,
  type BindWorldTravelRequest,
  type CloseWorldSessionRequest,
  type CreateWorldRequest,
  type CreateWorldSessionRequest,
  type RefreshWorldSessionTokenRequest,
  type ReportWorldTravelStatusRequest,
} from '@repo/shared';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  WorldModelProjectParamsSchema,
  WorldModelSessionParamsSchema,
  WorldModelTravelParamsSchema,
  WorldModelWorkspaceIdSchema,
  WorldModelWorldParamsSchema,
  type WorldModelProjectParams,
  type WorldModelSessionParams,
  type WorldModelTravelParams,
  type WorldModelWorldParams,
} from './world-model.dto';
import { WorldModelService } from './world-model.service';

@Controller('story-projects/:projectId/world-model')
export class WorldModelController {
  constructor(private readonly worlds: WorldModelService) {}

  @Get('providers')
  async listProviders(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelProjectParamsSchema))
    params: WorldModelProjectParams,
  ) {
    return {
      code: 200,
      data: await this.worlds.listProviders(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
      ),
    };
  }

  @Post('worlds')
  @HttpCode(HttpStatus.CREATED)
  async createWorld(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelProjectParamsSchema))
    params: WorldModelProjectParams,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Body(new ZodValidationPipe(CreateWorldRequestSchema))
    body: CreateWorldRequest,
  ) {
    return {
      code: 200,
      data: await this.worlds.createWorld(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Get('worlds')
  async listWorlds(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelProjectParamsSchema))
    params: WorldModelProjectParams,
  ) {
    return {
      code: 200,
      data: await this.worlds.listWorlds(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
      ),
    };
  }

  @Get('worlds/:worldId')
  async getWorld(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelWorldParamsSchema))
    params: WorldModelWorldParams,
  ) {
    return {
      code: 200,
      data: await this.worlds.getWorld(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.worldId,
      ),
    };
  }

  @Post('worlds/:worldId/sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelWorldParamsSchema))
    params: WorldModelWorldParams,
    @Body(new ZodValidationPipe(CreateWorldSessionRequestSchema))
    body: CreateWorldSessionRequest,
  ) {
    return {
      code: 200,
      data: await this.worlds.createSession(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.worldId,
        body,
      ),
    };
  }

  @Post('sessions/:sessionId/heartbeat')
  async heartbeat(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelSessionParamsSchema))
    params: WorldModelSessionParams,
  ) {
    return {
      code: 200,
      data: await this.worlds.heartbeat(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.sessionId,
      ),
    };
  }

  @Post('sessions/:sessionId/bind-travel')
  async bindTravel(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelSessionParamsSchema))
    params: WorldModelSessionParams,
    @Body(new ZodValidationPipe(BindWorldTravelRequestSchema))
    body: BindWorldTravelRequest,
  ) {
    return {
      code: 200,
      data: await this.worlds.bindTravel(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.sessionId,
        body,
      ),
    };
  }

  @Post('sessions/:sessionId/token')
  async refreshToken(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelSessionParamsSchema))
    params: WorldModelSessionParams,
    @Body(new ZodValidationPipe(RefreshWorldSessionTokenRequestSchema))
    body: RefreshWorldSessionTokenRequest,
  ) {
    return {
      code: 200,
      data: await this.worlds.refreshToken(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.sessionId,
        body.tokenSeconds,
      ),
    };
  }

  @Post('sessions/:sessionId/close')
  async closeSession(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelSessionParamsSchema))
    params: WorldModelSessionParams,
    @Body(new ZodValidationPipe(CloseWorldSessionRequestSchema))
    body: CloseWorldSessionRequest,
  ) {
    return {
      code: 200,
      data: await this.worlds.closeSession(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.sessionId,
        body,
      ),
    };
  }

  @Post('travels/:travelId/status')
  async reportTravelStatus(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelTravelParamsSchema))
    params: WorldModelTravelParams,
    @Body(new ZodValidationPipe(ReportWorldTravelStatusRequestSchema))
    body: ReportWorldTravelStatusRequest,
  ) {
    return {
      code: 200,
      data: await this.worlds.syncTravelStatus(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.travelId,
        body,
      ),
    };
  }

  @Get('travels/:travelId/artifacts')
  async getTravelArtifacts(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(WorldModelTravelParamsSchema))
    params: WorldModelTravelParams,
  ) {
    return {
      code: 200,
      data: await this.worlds.getTravelArtifacts(
        user.userId,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.travelId,
      ),
    };
  }
}

function requiredIdempotencyKey(value: string | string[] | undefined) {
  const key = Array.isArray(value) ? value[0] : value;
  const normalized = key?.trim();
  if (!normalized || normalized.length > 240) {
    throw new BadRequestException({
      code: 'WORLD_MODEL_IDEMPOTENCY_KEY_REQUIRED',
      message: 'A valid Idempotency-Key header is required to create a world.',
    });
  }
  return normalized;
}

function requiredWorkspaceId(value: string | string[] | undefined): string {
  const workspaceId = (Array.isArray(value) ? value[0] : value)?.trim();
  const parsed = WorldModelWorkspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'WORKSPACE_HEADER_INVALID',
      message: 'A valid x-fizz-workspace-id header is required.',
    });
  }
  return parsed.data;
}
