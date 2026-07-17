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
  StoryProjectIdParamsSchema,
  StoryUuidSchema,
  type StoryProjectIdParams,
} from './dto';
import { StoryTrailerProductionService } from './story-trailer-production.service';
import {
  CreateStoryTrailerVideoGenerationSchema,
  PutStoryTrailerVideoSelectionSchema,
  type CreateStoryTrailerVideoGenerationInput,
  type PutStoryTrailerVideoSelectionInput,
} from './story-video-production.schema';

@Controller('story-projects')
export class StoryTrailerProductionController {
  constructor(private readonly production: StoryTrailerProductionService) {}

  @Get(':projectId/trailer')
  async getTrailer(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.production.getTrailer(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
      ),
    };
  }

  @Post(':projectId/trailer/generations')
  @HttpCode(HttpStatus.CREATED)
  async createGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(CreateStoryTrailerVideoGenerationSchema))
    body: CreateStoryTrailerVideoGenerationInput,
  ) {
    return {
      code: 200,
      data: await this.production.createGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Put(':projectId/trailer/current-video')
  async putCurrentVideo(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(PutStoryTrailerVideoSelectionSchema))
    body: PutStoryTrailerVideoSelectionInput,
  ) {
    return {
      code: 200,
      data: await this.production.putCurrentVideo(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
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
