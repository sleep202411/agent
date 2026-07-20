import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CompleteStoryProjectVideoUploadSchema,
  StoryProjectIdParamsSchema,
  StoryProjectVideoUploadParamsSchema,
  StoryUuidSchema,
  type CompleteStoryProjectVideoUpload,
  type StoryProjectIdParams,
  type StoryProjectVideoUploadParams,
} from './dto';
import { StoryProjectVideoLibraryService } from './story-project-video-library.service';

@Controller('story-projects')
export class StoryProjectVideoLibraryController {
  constructor(private readonly videoLibrary: StoryProjectVideoLibraryService) {}

  @Post(':projectId/video-library/uploads/complete')
  @HttpCode(202)
  async completeUpload(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(CompleteStoryProjectVideoUploadSchema))
    input: CompleteStoryProjectVideoUpload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.videoLibrary.completeUpload(
      user,
      requiredWorkspaceId(workspaceHeader),
      params.projectId,
      input,
    );
    const httpStatus =
      data.status === 'queued' || data.status === 'processing' ? 202 : 200;
    response.status(httpStatus);
    return {
      code: httpStatus,
      data,
    };
  }

  @Get(':projectId/video-library/uploads/:mediaAssetId')
  async getUploadFinalize(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectVideoUploadParamsSchema))
    params: StoryProjectVideoUploadParams,
  ) {
    return {
      code: 200,
      data: await this.videoLibrary.getUploadFinalize(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.mediaAssetId,
      ),
    };
  }

  @Delete(':projectId/video-library/uploads/:mediaAssetId')
  @HttpCode(200)
  async cancelUploadFinalize(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectVideoUploadParamsSchema))
    params: StoryProjectVideoUploadParams,
  ) {
    return {
      code: 200,
      data: await this.videoLibrary.cancelUploadFinalize(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.mediaAssetId,
      ),
    };
  }
}

function requiredWorkspaceId(value: string | string[] | undefined): string {
  const normalized = (Array.isArray(value) ? value[0] : value)?.trim();
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
