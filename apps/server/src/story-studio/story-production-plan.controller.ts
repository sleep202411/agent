import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ArchiveStoryAssetSpecSchema,
  CreateStoryAssetSpecSchema,
  PatchStoryAssetSpecSchema,
  PatchStoryStoryboardClipSchema,
  PatchStoryStoryboardCueSchema,
  PatchStoryStoryboardSequenceSchema,
  PutStoryStoryboardTimelineSchema,
  PutStoryStoryboardBindingSchema,
  StoryAssetSpecParamsSchema,
  StoryProductionChapterParamsSchema,
  StoryStoryboardBindingParamsSchema,
  StoryStoryboardClipParamsSchema,
  StoryStoryboardCueParamsSchema,
  StoryStoryboardSequenceParamsSchema,
  type ArchiveStoryAssetSpecInput,
  type CreateStoryAssetSpecInput,
  type PatchStoryAssetSpecInput,
  type PatchStoryStoryboardClipInput,
  type PatchStoryStoryboardCueInput,
  type PatchStoryStoryboardSequenceInput,
  type PutStoryStoryboardTimelineInput,
  type PutStoryStoryboardBindingInput,
  type StoryAssetSpecParams,
  type StoryProductionChapterParams,
  type StoryStoryboardBindingParams,
  type StoryStoryboardClipParams,
  type StoryStoryboardCueParams,
  type StoryStoryboardSequenceParams,
} from './story-production-plan.schema';
import { StoryProductionPlanService } from './story-production-plan.service';

@Controller('story-projects/:projectId/chapters/:chapterId')
export class StoryProductionPlanController {
  constructor(private readonly production: StoryProductionPlanService) {}

  @Get('production-state')
  async getProductionState(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
  ) {
    return {
      code: 200,
      data: await this.production.getProductionState(
        user,
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Get('asset-specs')
  async listAssetSpecs(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
  ) {
    return {
      code: 200,
      data: await this.production.listAssetSpecs(
        user,
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Post('asset-specs')
  async createAssetSpec(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
    @Body(new ZodValidationPipe(CreateStoryAssetSpecSchema))
    body: CreateStoryAssetSpecInput,
  ) {
    return {
      code: 201,
      data: await this.production.createAssetSpec(
        user,
        params.projectId,
        params.chapterId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Patch('asset-specs/:assetSpecId')
  async patchAssetSpec(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAssetSpecParamsSchema))
    params: StoryAssetSpecParams,
    @Body(new ZodValidationPipe(PatchStoryAssetSpecSchema))
    body: PatchStoryAssetSpecInput,
  ) {
    return {
      code: 200,
      data: await this.production.patchAssetSpec(
        user,
        params.projectId,
        params.chapterId,
        params.assetSpecId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Delete('asset-specs/:assetSpecId')
  async archiveAssetSpec(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAssetSpecParamsSchema))
    params: StoryAssetSpecParams,
    @Body(new ZodValidationPipe(ArchiveStoryAssetSpecSchema))
    body: ArchiveStoryAssetSpecInput,
  ) {
    return {
      code: 200,
      data: await this.production.archiveAssetSpec(
        user,
        params.projectId,
        params.chapterId,
        params.assetSpecId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Get('storyboard')
  async getStoryboard(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
  ) {
    return {
      code: 200,
      data: await this.production.getStoryboard(
        user,
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Patch('storyboard/sequences/:sequenceId')
  async patchSequence(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardSequenceParamsSchema))
    params: StoryStoryboardSequenceParams,
    @Body(new ZodValidationPipe(PatchStoryStoryboardSequenceSchema))
    body: PatchStoryStoryboardSequenceInput,
  ) {
    return {
      code: 200,
      data: await this.production.patchSequence(
        user,
        params.projectId,
        params.chapterId,
        params.sequenceId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Put('storyboard/sequences/:sequenceId/timeline')
  async putTimeline(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardSequenceParamsSchema))
    params: StoryStoryboardSequenceParams,
    @Body(new ZodValidationPipe(PutStoryStoryboardTimelineSchema))
    body: PutStoryStoryboardTimelineInput,
  ) {
    return {
      code: 200,
      data: await this.production.putTimeline(
        user,
        params.projectId,
        params.chapterId,
        params.sequenceId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Patch('storyboard/sequences/:sequenceId/clips/:clipId')
  async patchClip(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardClipParamsSchema))
    params: StoryStoryboardClipParams,
    @Body(new ZodValidationPipe(PatchStoryStoryboardClipSchema))
    body: PatchStoryStoryboardClipInput,
  ) {
    return {
      code: 200,
      data: await this.production.patchClip(
        user,
        params.projectId,
        params.chapterId,
        params.sequenceId,
        params.clipId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Put('storyboard/sequences/:sequenceId/clips/:clipId/bindings/:assetSpecId')
  async putBinding(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardBindingParamsSchema))
    params: StoryStoryboardBindingParams,
    @Body(new ZodValidationPipe(PutStoryStoryboardBindingSchema))
    body: PutStoryStoryboardBindingInput,
  ) {
    return {
      code: 200,
      data: await this.production.putBinding(
        user,
        params.projectId,
        params.chapterId,
        params.sequenceId,
        params.clipId,
        params.assetSpecId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Patch('storyboard/sequences/:sequenceId/cues/:cueId')
  async patchCue(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardCueParamsSchema))
    params: StoryStoryboardCueParams,
    @Body(new ZodValidationPipe(PatchStoryStoryboardCueSchema))
    body: PatchStoryStoryboardCueInput,
  ) {
    return {
      code: 200,
      data: await this.production.patchCue(
        user,
        params.projectId,
        params.chapterId,
        params.sequenceId,
        params.cueId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }
}

function requiredIdempotencyKey(value: string | string[] | undefined): string {
  const key = Array.isArray(value) ? value[0] : value;
  if (!key?.trim()) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'Idempotency-Key is required for Story production mutations.',
    });
  }
  return key;
}
