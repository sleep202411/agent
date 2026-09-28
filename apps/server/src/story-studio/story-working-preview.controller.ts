import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  StoryProjectIdParamsSchema,
  StoryStableIdSchema,
  StoryUuidSchema,
  type StoryProjectIdParams,
} from './dto';
import { StoryWorkingPreviewService } from './story-working-preview.service';

/**
 * Preview the chapter the author is editing. `sceneId` is the node whose play
 * button was pressed; it is the start of that preview and is not an entry-node
 * lookup. Omit both to walk the whole story.
 */
const StoryWorkingPreviewQuerySchema = z
  .object({
    chapterId: StoryUuidSchema.optional(),
    sceneId: StoryStableIdSchema.optional(),
  })
  .strict();
type StoryWorkingPreviewQuery = z.infer<typeof StoryWorkingPreviewQuerySchema>;

@Controller('story-projects')
export class StoryWorkingPreviewController {
  constructor(private readonly previews: StoryWorkingPreviewService) {}

  @Get(':projectId/working-preview')
  async getWorkingPreview(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    // Defaulted so the whole-story preview stays callable with no query at all;
    // the pipe supplies a parsed object on every real request.
    @Query(new ZodValidationPipe(StoryWorkingPreviewQuerySchema))
    query: StoryWorkingPreviewQuery = {},
  ) {
    return {
      code: 200,
      data: await this.previews.getWorkingPreview(
        user,
        params.projectId,
        query.chapterId,
        query.sceneId,
      ),
    };
  }
}
