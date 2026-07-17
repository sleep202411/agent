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
  CreateFilmTrailerGenerationSchema,
  PutFilmCurrentVideoSchema,
  PutFilmTrailerReferencesSchema,
  RetryFilmGenerationSchema,
  StoryFilmTrailerGenerationParamsSchema,
  StoryRevisionParamsSchema,
  StoryUuidSchema,
  type CancelFilmGenerationInput,
  type CreateFilmTrailerGenerationInput,
  type PutFilmCurrentVideoInput,
  type PutFilmTrailerReferencesInput,
  type RetryFilmGenerationInput,
  type StoryFilmTrailerGenerationParams,
  type StoryRevisionParams,
} from './dto';
import { StoryFilmTrailerProductionService } from './story-film-trailer-production.service';

@Controller('story-projects')
export class StoryFilmTrailerProductionController {
  constructor(private readonly production: StoryFilmTrailerProductionService) {}

  @Get(':projectId/revisions/:revisionId/trailer')
  async getTrailer(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
  ) {
    return {
      code: 200,
      data: await this.production.getTrailer(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.revisionId,
      ),
    };
  }

  @Put(':projectId/revisions/:revisionId/trailer/references')
  async putReferences(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
    @Body(new ZodValidationPipe(PutFilmTrailerReferencesSchema))
    body: PutFilmTrailerReferencesInput,
  ) {
    return {
      code: 200,
      data: await this.production.putReferences(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.revisionId,
        body,
      ),
    };
  }

  @Post(':projectId/revisions/:revisionId/trailer/generations')
  @HttpCode(HttpStatus.CREATED)
  async createGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
    @Body(new ZodValidationPipe(CreateFilmTrailerGenerationSchema))
    body: CreateFilmTrailerGenerationInput,
  ) {
    return {
      code: 200,
      data: await this.production.createGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.revisionId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Get(':projectId/trailer-generations/:generationId')
  async getGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTrailerGenerationParamsSchema))
    params: StoryFilmTrailerGenerationParams,
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

  @Post(':projectId/trailer-generations/:generationId/cancel')
  async cancelGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTrailerGenerationParamsSchema))
    params: StoryFilmTrailerGenerationParams,
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

  @Post(':projectId/trailer-generations/:generationId/retry')
  @HttpCode(HttpStatus.CREATED)
  async retryGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTrailerGenerationParamsSchema))
    params: StoryFilmTrailerGenerationParams,
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

  @Put(':projectId/revisions/:revisionId/trailer/current-video')
  async putCurrentVideo(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
    @Body(new ZodValidationPipe(PutFilmCurrentVideoSchema))
    body: PutFilmCurrentVideoInput,
  ) {
    return {
      code: 200,
      data: await this.production.putCurrentVideo(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.revisionId,
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

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
