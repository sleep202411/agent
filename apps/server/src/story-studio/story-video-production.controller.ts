import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Put,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  StoryClipVideoParamsSchema,
  StoryUuidSchema,
  type StoryClipVideoParams,
} from './dto';
import { StoryVideoProductionService } from './story-video-production.service';
import {
  PutStoryClipVideoSelectionSchema,
  type PutStoryClipVideoSelectionInput,
} from './story-video-production.schema';

@Controller('story-projects')
export class StoryVideoProductionController {
  constructor(private readonly production: StoryVideoProductionService) {}

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

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
