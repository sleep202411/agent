import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  StoryProjectIdParamsSchema,
  StoryUuidSchema,
  type StoryProjectIdParams,
} from './dto';
import { StoryProjectMoveService } from './story-project-move.service';

export const MoveStoryProjectSchema = z
  .object({
    targetWorkspaceId: StoryUuidSchema,
    expectedWorkspaceId: StoryUuidSchema,
    expectedProjectVersion: z.number().int().nonnegative(),
  })
  .strict();
export type MoveStoryProjectInput = z.infer<typeof MoveStoryProjectSchema>;

@Controller('story-projects')
export class StoryProjectMoveController {
  constructor(private readonly moves: StoryProjectMoveService) {}

  @Post(':projectId/move')
  @HttpCode(200)
  async move(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(MoveStoryProjectSchema))
    body: MoveStoryProjectInput,
  ) {
    return {
      code: 200,
      data: await this.moves.move(user, params.projectId, body),
    };
  }
}
