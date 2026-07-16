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
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CancelFilmGenerationSchema,
  CreateDraftFilmGenerationSchema,
  CreateFilmGenerationSchema,
  PutDraftFilmCurrentVideoSchema,
  RetryFilmGenerationSchema,
  StoryFilmClipParamsSchema,
  StoryFilmDraftClipParamsSchema,
  StoryFilmGenerationParamsSchema,
  StoryUuidSchema,
  type CancelFilmGenerationInput,
  type CreateDraftFilmGenerationInput,
  type CreateFilmGenerationInput,
  type PutDraftFilmCurrentVideoInput,
  type RetryFilmGenerationInput,
  type StoryFilmClipParams,
  type StoryFilmDraftClipParams,
  type StoryFilmGenerationParams,
} from './dto';
import { StoryFilmProductionService } from './story-film-production.service';

@Controller('story-projects')
export class StoryFilmProductionController {
  constructor(private readonly production: StoryFilmProductionService) {}

  @Post(':projectId/clips/:graphNodeId/generations')
  @HttpCode(HttpStatus.CREATED)
  async createDraftGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmDraftClipParamsSchema))
    params: StoryFilmDraftClipParams,
    @Body(new ZodValidationPipe(CreateDraftFilmGenerationSchema))
    body: CreateDraftFilmGenerationInput,
  ) {
    return {
      code: 200,
      data: await this.production.createDraftGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.graphNodeId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Post(':projectId/revisions/:revisionId/clips/:clipId/generations')
  @HttpCode(HttpStatus.CREATED)
  async createGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmClipParamsSchema))
    params: StoryFilmClipParams,
    @Body(new ZodValidationPipe(CreateFilmGenerationSchema))
    body: CreateFilmGenerationInput,
  ) {
    return {
      code: 200,
      data: await this.production.createGeneration(
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

  @Get(':projectId/generations/:generationId')
  async getGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmGenerationParamsSchema))
    params: StoryFilmGenerationParams,
  ) {
    return {
      code: 200,
      data: await this.production.getGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.generationId,
      ),
    };
  }

  @Post(':projectId/generations/:generationId/cancel')
  async cancelGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmGenerationParamsSchema))
    params: StoryFilmGenerationParams,
    @Body(new ZodValidationPipe(CancelFilmGenerationSchema))
    body: CancelFilmGenerationInput,
  ) {
    return {
      code: 200,
      data: await this.production.cancelGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.generationId,
        body,
      ),
    };
  }

  @Post(':projectId/generations/:generationId/retry')
  @HttpCode(HttpStatus.CREATED)
  async retryGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmGenerationParamsSchema))
    params: StoryFilmGenerationParams,
    @Body(new ZodValidationPipe(RetryFilmGenerationSchema))
    body: RetryFilmGenerationInput,
  ) {
    return {
      code: 200,
      data: await this.production.retryGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.generationId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Put(':projectId/clips/:graphNodeId/current-video')
  async putCurrentVideo(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmDraftClipParamsSchema))
    params: StoryFilmDraftClipParams,
    @Body(new ZodValidationPipe(PutDraftFilmCurrentVideoSchema))
    body: PutDraftFilmCurrentVideoInput,
  ) {
    return {
      code: 200,
      data: await this.production.putCurrentVideo(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.graphNodeId,
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
