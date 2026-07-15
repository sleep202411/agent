import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  StoryProjectIdParamsSchema,
  StoryProjectVideoLibraryQuerySchema,
  StoryUuidSchema,
  type StoryProjectIdParams,
  type StoryProjectVideoLibraryQuery,
} from './dto';
import { StoryProjectVideoLibraryService } from './story-project-video-library.service';

@Controller('story-projects')
export class StoryProjectVideoLibraryController {
  constructor(private readonly videoLibrary: StoryProjectVideoLibraryService) {}

  @Get(':projectId/video-library')
  async list(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Query(new ZodValidationPipe(StoryProjectVideoLibraryQuerySchema))
    query: StoryProjectVideoLibraryQuery,
  ) {
    return {
      code: 200,
      data: await this.videoLibrary.list(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        query,
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
