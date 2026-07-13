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
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ApproveFilmTakeSchema,
  CancelFilmTakeSchema,
  CreateDraftFilmTakeSchema,
  CreateFilmTakeReviewSchema,
  CreateFilmTakeSchema,
  FilmTakeListQuerySchema,
  PrepareDraftFilmClipSchema,
  PutFilmClipMasterSchema,
  RetryFilmTakeSchema,
  StoryFilmClipParamsSchema,
  StoryFilmDraftClipParamsSchema,
  StoryFilmTakeParamsSchema,
  StoryUuidSchema,
  type ApproveFilmTakeInput,
  type CancelFilmTakeInput,
  type CreateDraftFilmTakeInput,
  type CreateFilmTakeInput,
  type CreateFilmTakeReviewInput,
  type FilmTakeListQuery,
  type PrepareDraftFilmClipInput,
  type PutFilmClipMasterInput,
  type RetryFilmTakeInput,
  type StoryFilmClipParams,
  type StoryFilmDraftClipParams,
  type StoryFilmTakeParams,
} from './dto';
import { StoryFilmProductionService } from './story-film-production.service';

@Controller('story-projects')
export class StoryFilmProductionController {
  constructor(private readonly production: StoryFilmProductionService) {}

  @Post(':projectId/clips/:graphNodeId/prepare')
  async prepareDraftClip(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmDraftClipParamsSchema))
    params: StoryFilmDraftClipParams,
    @Body(new ZodValidationPipe(PrepareDraftFilmClipSchema))
    body: PrepareDraftFilmClipInput,
  ) {
    return {
      code: 200,
      data: await this.production.prepareDraftClip(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.graphNodeId,
        body,
      ),
    };
  }

  @Post(':projectId/clips/:graphNodeId/takes')
  @HttpCode(HttpStatus.CREATED)
  async createDraftTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmDraftClipParamsSchema))
    params: StoryFilmDraftClipParams,
    @Body(new ZodValidationPipe(CreateDraftFilmTakeSchema))
    body: CreateDraftFilmTakeInput,
  ) {
    return {
      code: 200,
      data: await this.production.createDraftTake(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.graphNodeId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Get(':projectId/clips/:graphNodeId/takes')
  async listDraftTakes(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmDraftClipParamsSchema))
    params: StoryFilmDraftClipParams,
    @Query(new ZodValidationPipe(FilmTakeListQuerySchema))
    query: FilmTakeListQuery,
  ) {
    return {
      code: 200,
      data: await this.production.listDraftTakes(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.graphNodeId,
        query,
      ),
    };
  }

  @Post(':projectId/revisions/:revisionId/clips/:clipId/takes')
  @HttpCode(HttpStatus.CREATED)
  async createTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmClipParamsSchema))
    params: StoryFilmClipParams,
    @Body(new ZodValidationPipe(CreateFilmTakeSchema))
    body: CreateFilmTakeInput,
  ) {
    return {
      code: 200,
      data: await this.production.createTake(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.revisionId,
        params.clipId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Get(':projectId/revisions/:revisionId/clips/:clipId/takes')
  async listTakes(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmClipParamsSchema))
    params: StoryFilmClipParams,
    @Query(new ZodValidationPipe(FilmTakeListQuerySchema))
    query: FilmTakeListQuery,
  ) {
    return {
      code: 200,
      data: await this.production.listTakes(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.revisionId,
        params.clipId,
        query,
      ),
    };
  }

  @Get(':projectId/takes/:takeId')
  async getTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTakeParamsSchema))
    params: StoryFilmTakeParams,
  ) {
    return {
      code: 200,
      data: await this.production.getTake(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.takeId,
      ),
    };
  }

  @Post(':projectId/takes/:takeId/cancel')
  async cancelTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTakeParamsSchema))
    params: StoryFilmTakeParams,
    @Body(new ZodValidationPipe(CancelFilmTakeSchema))
    body: CancelFilmTakeInput,
  ) {
    return {
      code: 200,
      data: await this.production.cancelTake(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.takeId,
        body,
      ),
    };
  }

  @Post(':projectId/takes/:takeId/retry')
  @HttpCode(HttpStatus.CREATED)
  async retryTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTakeParamsSchema))
    params: StoryFilmTakeParams,
    @Body(new ZodValidationPipe(RetryFilmTakeSchema)) body: RetryFilmTakeInput,
  ) {
    return {
      code: 200,
      data: await this.production.retryTake(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.takeId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Post(':projectId/takes/:takeId/reviews')
  @HttpCode(HttpStatus.CREATED)
  async reviewTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTakeParamsSchema))
    params: StoryFilmTakeParams,
    @Body(new ZodValidationPipe(CreateFilmTakeReviewSchema))
    body: CreateFilmTakeReviewInput,
  ) {
    return {
      code: 200,
      data: await this.production.reviewTake(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.takeId,
        body,
      ),
    };
  }

  @Post(':projectId/takes/:takeId/approval')
  @HttpCode(HttpStatus.CREATED)
  async approveTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTakeParamsSchema))
    params: StoryFilmTakeParams,
    @Body(new ZodValidationPipe(ApproveFilmTakeSchema))
    body: ApproveFilmTakeInput,
  ) {
    return {
      code: 200,
      data: await this.production.approveTake(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.takeId,
        body,
      ),
    };
  }

  @Put(':projectId/revisions/:revisionId/clips/:clipId/master')
  async putMaster(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmClipParamsSchema))
    params: StoryFilmClipParams,
    @Body(new ZodValidationPipe(PutFilmClipMasterSchema))
    body: PutFilmClipMasterInput,
  ) {
    return {
      code: 200,
      data: await this.production.putMaster(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.revisionId,
        params.clipId,
        body,
      ),
    };
  }
}

function requiredWorkspaceId(value: string | string[] | undefined): string {
  const normalized = firstHeader(value)?.trim();
  const parsed = StoryUuidSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new BadRequestException({
      code: normalized
        ? 'WORKSPACE_HEADER_INVALID'
        : 'WORKSPACE_HEADER_REQUIRED',
      message: normalized
        ? 'x-fizz-workspace-id must be a valid UUID.'
        : 'x-fizz-workspace-id is required.',
    });
  }
  return parsed.data;
}

function requiredIdempotencyKey(value: string | string[] | undefined): string {
  const normalized = firstHeader(value)?.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException({
      code: normalized ? 'IDEMPOTENCY_KEY_INVALID' : 'IDEMPOTENCY_KEY_REQUIRED',
      message: normalized
        ? 'Idempotency-Key must be at most 160 characters.'
        : 'Idempotency-Key is required for video generation.',
    });
  }
  return normalized;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
