import {
  BadRequestException,
  Body,
  Controller,
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
  PatchStoryAssetSpecSchema,
  PatchStoryStoryboardClipSchema,
  PatchStoryStoryboardCueSchema,
  PatchStoryStoryboardSequenceSchema,
  PutStoryStoryboardTimelineSchema,
  PutStoryStoryboardBindingSchema,
  ResolveStoryProductionConflictSchema,
  StoryAssetSpecParamsSchema,
  StoryProductionChapterParamsSchema,
  StoryStoryboardBindingParamsSchema,
  StoryStoryboardClipParamsSchema,
  StoryStoryboardCueParamsSchema,
  StoryStoryboardSequenceParamsSchema,
  type PatchStoryAssetSpecInput,
  type PatchStoryStoryboardClipInput,
  type PatchStoryStoryboardCueInput,
  type PatchStoryStoryboardSequenceInput,
  type PutStoryStoryboardTimelineInput,
  type PutStoryStoryboardBindingInput,
  type ResolveStoryProductionConflictInput,
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
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
  ) {
    return {
      code: 200,
      data: await this.production.getProductionState(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Get('asset-specs')
  async listAssetSpecs(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
  ) {
    return {
      code: 200,
      data: await this.production.listAssetSpecs(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Patch('asset-specs/:assetSpecId')
  async patchAssetSpec(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
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
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.assetSpecId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Post('asset-specs/:assetSpecId/conflict-resolution')
  async resolveAssetSpecConflict(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAssetSpecParamsSchema))
    params: StoryAssetSpecParams,
    @Body(new ZodValidationPipe(ResolveStoryProductionConflictSchema))
    body: ResolveStoryProductionConflictInput,
  ) {
    return {
      code: 200,
      data: await this.production.resolveAssetSpecConflict(
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

  @Get('storyboard')
  async getStoryboard(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProductionChapterParamsSchema))
    params: StoryProductionChapterParams,
  ) {
    return {
      code: 200,
      data: await this.production.getStoryboard(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Patch('storyboard/sequences/:sequenceId')
  async patchSequence(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
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
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.chapterId,
        params.sequenceId,
        requiredIdempotencyKey(idempotencyHeader),
        body,
      ),
    };
  }

  @Post('storyboard/sequences/:sequenceId/conflict-resolution')
  async resolveStoryboardSequenceConflict(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryStoryboardSequenceParamsSchema))
    params: StoryStoryboardSequenceParams,
    @Body(new ZodValidationPipe(ResolveStoryProductionConflictSchema))
    body: ResolveStoryProductionConflictInput,
  ) {
    return {
      code: 200,
      data: await this.production.resolveStoryboardSequenceConflict(
        user,
        requiredWorkspaceId(workspaceHeader),
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
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
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
        requiredWorkspaceId(workspaceHeader),
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
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
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

  @Put('storyboard/sequences/:sequenceId/clips/:clipId/bindings/:assetSpecId')
  async putBinding(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
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
        requiredWorkspaceId(workspaceHeader),
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
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
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
        requiredWorkspaceId(workspaceHeader),
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
      message: 'Idempotency-Key is required for Story production mutations.',
    });
  }
  return key;
}
