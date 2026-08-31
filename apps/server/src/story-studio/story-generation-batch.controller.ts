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
  ConfirmStoryGenerationBatchSchema,
  QuoteStoryAssetGenerationBatchSchema,
  QuoteStoryStoryboardGenerationBatchSchema,
  StoryGenerationBatchParamsSchema,
  type ConfirmStoryGenerationBatchInput,
  type QuoteStoryAssetGenerationBatchInput,
  type QuoteStoryStoryboardGenerationBatchInput,
  type StoryGenerationBatchParams,
} from './story-generation-batch.schema';
import { StoryGenerationBatchService } from './story-generation-batch.service';
import {
  StoryProductionChapterParamsSchema,
  type StoryProductionChapterParams,
} from './story-production-plan.schema';

@Controller('story-projects/:projectId/chapters/:chapterId/generation-batches')
export class StoryGenerationBatchController {
  constructor(private readonly batches: StoryGenerationBatchService) {}

  @Post('asset-specs/quote')
  async quoteAssets(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
    @Body(new ZodValidationPipe(QuoteStoryAssetGenerationBatchSchema))
    body: QuoteStoryAssetGenerationBatchInput,
  ) {
    return {
      code: 200,
      data: await this.batches.quoteAssets(
        user,
        params.projectId,
        params.chapterId,
        requiredIdempotencyHeader(idempotencyKey),
        body,
      ),
    };
  }

  @Post('storyboard/clips/quote')
  async quoteStoryboardClips(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
    @Body(new ZodValidationPipe(QuoteStoryStoryboardGenerationBatchSchema))
    body: QuoteStoryStoryboardGenerationBatchInput,
  ) {
    return {
      code: 200,
      data: await this.batches.quoteStoryboardClips(
        user,
        params.projectId,
        params.chapterId,
        requiredIdempotencyHeader(idempotencyKey),
        body,
      ),
    };
  }

  @Post(':batchId/confirm')
  @HttpCode(202)
  async confirm(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryGenerationBatchParamsSchema))
    params: StoryGenerationBatchParams,
    @Body(new ZodValidationPipe(ConfirmStoryGenerationBatchSchema))
    body: ConfirmStoryGenerationBatchInput,
  ) {
    return {
      code: 202,
      data: await this.batches.confirm(
        user,
        params.projectId,
        params.chapterId,
        params.batchId,
        body,
      ),
    };
  }

  @Get(':batchId')
  async get(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryGenerationBatchParamsSchema))
    params: StoryGenerationBatchParams,
  ) {
    return {
      code: 200,
      data: await this.batches.get(
        user,
        params.projectId,
        params.chapterId,
        params.batchId,
      ),
    };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
  ) {
    return {
      code: 200,
      data: await this.batches.list(user, params.projectId, params.chapterId),
    };
  }

  @Post(':batchId/cancel')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryGenerationBatchParamsSchema))
    params: StoryGenerationBatchParams,
  ) {
    return {
      code: 200,
      data: await this.batches.cancel(
        user,
        params.projectId,
        params.chapterId,
        params.batchId,
      ),
    };
  }

  @Post(':batchId/resume')
  @HttpCode(202)
  async resume(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryGenerationBatchParamsSchema))
    params: StoryGenerationBatchParams,
  ) {
    return {
      code: 202,
      data: await this.batches.resume(
        user,
        params.projectId,
        params.chapterId,
        params.batchId,
      ),
    };
  }
}

function requiredIdempotencyHeader(
  value: string | string[] | undefined,
): string {
  const normalized = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!normalized) {
    throw new BadRequestException({
      code: 'REQUIRED_HEADER_MISSING',
      message: 'Idempotency-Key is required.',
    });
  }
  return normalized;
}
