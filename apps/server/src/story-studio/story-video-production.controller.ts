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
  StoryClipVideoParamsSchema,
  StoryUuidSchema,
  StoryVideoGenerationParamsSchema,
  type StoryClipVideoParams,
  type StoryVideoGenerationParams,
} from './dto';
import { StoryVideoProductionService } from './story-video-production.service';
import {
  CancelStoryVideoGenerationSchema,
  CreateStoryClipVideoGenerationSchema,
  PutStoryClipVideoSelectionSchema,
  RetryStoryVideoGenerationSchema,
  type CancelStoryVideoGenerationInput,
  type CreateStoryClipVideoGenerationInput,
  type PutStoryClipVideoSelectionInput,
  type RetryStoryVideoGenerationInput,
} from './story-video-production.schema';

@Controller('story-projects')
export class StoryVideoProductionController {
  constructor(private readonly production: StoryVideoProductionService) {}

  @Post(':projectId/clips/:graphNodeId/generations')
  @HttpCode(HttpStatus.CREATED)
  async createGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryClipVideoParamsSchema))
    params: StoryClipVideoParams,
    @Body(new ZodValidationPipe(CreateStoryClipVideoGenerationSchema))
    body: CreateStoryClipVideoGenerationInput,
  ) {
    return {
      code: 200,
      data: await this.production.createClipGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.graphNodeId,
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
    @Param(new ZodValidationPipe(StoryVideoGenerationParamsSchema))
    params: StoryVideoGenerationParams,
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
    @Param(new ZodValidationPipe(StoryVideoGenerationParamsSchema))
    params: StoryVideoGenerationParams,
    @Body(new ZodValidationPipe(CancelStoryVideoGenerationSchema))
    body: CancelStoryVideoGenerationInput,
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
    @Param(new ZodValidationPipe(StoryVideoGenerationParamsSchema))
    params: StoryVideoGenerationParams,
    @Body(new ZodValidationPipe(RetryStoryVideoGenerationSchema))
    body: RetryStoryVideoGenerationInput,
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
    @Param(new ZodValidationPipe(StoryClipVideoParamsSchema))
    params: StoryClipVideoParams,
    @Body(new ZodValidationPipe(PutStoryClipVideoSelectionSchema))
    body: PutStoryClipVideoSelectionInput,
  ) {
    return {
      code: 200,
      data: await this.production.putClipCurrentVideo(
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
