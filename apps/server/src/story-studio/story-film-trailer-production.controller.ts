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
  CreateFilmTrailerTakeReviewSchema,
  CreateFilmTrailerTakeSchema,
  FilmTakeListQuerySchema,
  PutFilmTrailerMasterSchema,
  PutFilmTrailerReferencesSchema,
  RetryFilmTakeSchema,
  StoryFilmTrailerTakeParamsSchema,
  StoryRevisionParamsSchema,
  StoryUuidSchema,
  type ApproveFilmTakeInput,
  type CancelFilmTakeInput,
  type CreateFilmTrailerTakeInput,
  type CreateFilmTrailerTakeReviewInput,
  type FilmTakeListQuery,
  type PutFilmTrailerMasterInput,
  type PutFilmTrailerReferencesInput,
  type RetryFilmTakeInput,
  type StoryFilmTrailerTakeParams,
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

  @Post(':projectId/revisions/:revisionId/trailer/takes')
  @HttpCode(HttpStatus.CREATED)
  async createTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
    @Body(new ZodValidationPipe(CreateFilmTrailerTakeSchema))
    body: CreateFilmTrailerTakeInput,
  ) {
    return {
      code: 200,
      data: await this.production.createTake(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.revisionId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Get(':projectId/revisions/:revisionId/trailer/takes')
  async listTakes(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
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
        query,
      ),
    };
  }

  @Get(':projectId/trailer-takes/:takeId')
  async getTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTrailerTakeParamsSchema))
    params: StoryFilmTrailerTakeParams,
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

  @Post(':projectId/trailer-takes/:takeId/cancel')
  async cancelTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTrailerTakeParamsSchema))
    params: StoryFilmTrailerTakeParams,
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

  @Post(':projectId/trailer-takes/:takeId/retry')
  @HttpCode(HttpStatus.CREATED)
  async retryTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTrailerTakeParamsSchema))
    params: StoryFilmTrailerTakeParams,
    @Body(new ZodValidationPipe(RetryFilmTakeSchema))
    body: RetryFilmTakeInput,
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

  @Post(':projectId/trailer-takes/:takeId/reviews')
  @HttpCode(HttpStatus.CREATED)
  async reviewTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTrailerTakeParamsSchema))
    params: StoryFilmTrailerTakeParams,
    @Body(new ZodValidationPipe(CreateFilmTrailerTakeReviewSchema))
    body: CreateFilmTrailerTakeReviewInput,
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

  @Post(':projectId/trailer-takes/:takeId/approval')
  @HttpCode(HttpStatus.CREATED)
  async approveTake(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmTrailerTakeParamsSchema))
    params: StoryFilmTrailerTakeParams,
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

  @Put(':projectId/revisions/:revisionId/trailer/master')
  async putMaster(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
    @Body(new ZodValidationPipe(PutFilmTrailerMasterSchema))
    body: PutFilmTrailerMasterInput,
  ) {
    return {
      code: 200,
      data: await this.production.putMaster(
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
