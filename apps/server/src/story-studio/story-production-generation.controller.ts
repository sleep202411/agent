import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreateStoryAssetGenerationSchema,
  CreateStoryStoryboardClipGenerationSchema,
  RetryStoryProductionGenerationSchema,
  StoryAssetGenerationParamsSchema,
  StoryStoryboardClipGenerationParamsSchema,
  type CreateStoryAssetGenerationInput,
  type CreateStoryStoryboardClipGenerationInput,
  type RetryStoryProductionGenerationInput,
  type StoryAssetGenerationParams,
  type StoryStoryboardClipGenerationParams,
} from './story-production-generation.schema';
import { StoryProductionGenerationService } from './story-production-generation.service';
import {
  StoryAssetSpecParamsSchema,
  StoryStoryboardClipParamsSchema,
  type StoryAssetSpecParams,
  type StoryStoryboardClipParams,
} from './story-production-plan.schema';

@Controller('story-projects/:projectId/chapters/:chapterId')
export class StoryProductionGenerationController {
  constructor(private readonly generations: StoryProductionGenerationService) {}

  @Post('asset-specs/:assetSpecId/generations')
  @HttpCode(202)
  async createAssetGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAssetSpecParamsSchema))
    params: StoryAssetSpecParams,
    @Body(new ZodValidationPipe(CreateStoryAssetGenerationSchema))
    body: CreateStoryAssetGenerationInput,
  ) {
    return {
      code: 202,
      data: await this.generations.createAssetGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.assetSpecId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Get('asset-specs/:assetSpecId/generations/:generationId')
  async getAssetGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAssetGenerationParamsSchema))
    params: StoryAssetGenerationParams,
  ) {
    return {
      code: 200,
      data: await this.generations.getAssetGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.assetSpecId,
        params.generationId,
      ),
    };
  }

  @Post('asset-specs/:assetSpecId/generations/:generationId/cancel')
  @HttpCode(200)
  async cancelAssetGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAssetGenerationParamsSchema))
    params: StoryAssetGenerationParams,
  ) {
    return {
      code: 200,
      data: await this.generations.cancelAssetGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.assetSpecId,
        params.generationId,
      ),
    };
  }

  @Post('asset-specs/:assetSpecId/generations/:generationId/retry')
  @HttpCode(202)
  async retryAssetGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAssetGenerationParamsSchema))
    params: StoryAssetGenerationParams,
    @Body(new ZodValidationPipe(RetryStoryProductionGenerationSchema))
    body: RetryStoryProductionGenerationInput,
  ) {
    return {
      code: 202,
      data: await this.generations.retryAssetGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.assetSpecId,
        params.generationId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Post(
    'asset-specs/:assetSpecId/generations/:generationId/materialization/retry',
  )
  @HttpCode(202)
  async retryAssetGenerationMaterialization(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAssetGenerationParamsSchema))
    params: StoryAssetGenerationParams,
  ) {
    return {
      code: 202,
      data: await this.generations.reattachAssetGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.assetSpecId,
        params.generationId,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Post('storyboard/sequences/:sequenceId/clips/:clipId/generations')
  @HttpCode(202)
  async createStoryboardClipGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardClipParamsSchema))
    params: StoryStoryboardClipParams,
    @Body(new ZodValidationPipe(CreateStoryStoryboardClipGenerationSchema))
    body: CreateStoryStoryboardClipGenerationInput,
  ) {
    return {
      code: 202,
      data: await this.generations.createStoryboardClipGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.sequenceId,
        params.clipId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Get(
    'storyboard/sequences/:sequenceId/clips/:clipId/generations/:generationId',
  )
  async getStoryboardClipGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardClipGenerationParamsSchema))
    params: StoryStoryboardClipGenerationParams,
  ) {
    return {
      code: 200,
      data: await this.generations.getStoryboardClipGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.sequenceId,
        params.clipId,
        params.generationId,
      ),
    };
  }

  @Post(
    'storyboard/sequences/:sequenceId/clips/:clipId/generations/:generationId/cancel',
  )
  @HttpCode(200)
  async cancelStoryboardClipGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardClipGenerationParamsSchema))
    params: StoryStoryboardClipGenerationParams,
  ) {
    return {
      code: 200,
      data: await this.generations.cancelStoryboardClipGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.sequenceId,
        params.clipId,
        params.generationId,
      ),
    };
  }

  @Post(
    'storyboard/sequences/:sequenceId/clips/:clipId/generations/:generationId/retry',
  )
  @HttpCode(202)
  async retryStoryboardClipGeneration(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardClipGenerationParamsSchema))
    params: StoryStoryboardClipGenerationParams,
    @Body(new ZodValidationPipe(RetryStoryProductionGenerationSchema))
    body: RetryStoryProductionGenerationInput,
  ) {
    return {
      code: 202,
      data: await this.generations.retryStoryboardClipGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.sequenceId,
        params.clipId,
        params.generationId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Post(
    'storyboard/sequences/:sequenceId/clips/:clipId/generations/:generationId/materialization/retry',
  )
  @HttpCode(202)
  async retryStoryboardClipGenerationMaterialization(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardClipGenerationParamsSchema))
    params: StoryStoryboardClipGenerationParams,
  ) {
    return {
      code: 202,
      data: await this.generations.reattachStoryboardClipGeneration(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.sequenceId,
        params.clipId,
        params.generationId,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }
}

function requiredWorkspaceId(value: string | string[] | undefined): string {
  const workspaceId = Array.isArray(value) ? value[0] : value;
  if (!workspaceId?.trim()) {
    throw new BadRequestException({
      code: 'WORKSPACE_HEADER_REQUIRED',
      message: 'x-fizz-workspace-id is required.',
    });
  }
  return workspaceId.trim();
}

function requiredIdempotencyKey(value: string | string[] | undefined): string {
  const key = Array.isArray(value) ? value[0] : value;
  if (!key?.trim()) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'Idempotency-Key is required for Story generation commands.',
    });
  }
  return key.trim();
}
