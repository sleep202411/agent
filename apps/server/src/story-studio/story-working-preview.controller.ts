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
  StoryUuidSchema,
  StoryWorkingPreviewQuerySchema,
  type StoryProjectIdParams,
  type StoryWorkingPreviewQuery,
} from './dto';
import { StoryWorkingPreviewService } from './story-working-preview.service';

@Controller('story-projects')
export class StoryWorkingPreviewController {
  constructor(private readonly previews: StoryWorkingPreviewService) {}

  @Get(':projectId/working-preview')
  async getWorkingPreview(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Query(new ZodValidationPipe(StoryWorkingPreviewQuerySchema))
    query: StoryWorkingPreviewQuery,
  ) {
    return {
      code: 200,
      data: await this.previews.getWorkingPreview(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        query.expectedDraftRevision,
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
