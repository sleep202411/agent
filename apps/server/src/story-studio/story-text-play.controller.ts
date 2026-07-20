import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  StoryProjectIdParamsSchema,
  StoryUuidSchema,
  type StoryProjectIdParams,
} from './dto';
import {
  StoryTextPlayService,
  StoryTextPlayTurnRequestSchema,
  type StoryTextPlayTurnRequest,
} from './story-text-play.service';

/** Creator-side text-adventure 试玩 (the public player runtime is Java's). */
@Controller('story-projects')
export class StoryTextPlayController {
  constructor(private readonly textPlay: StoryTextPlayService) {}

  @Post(':projectId/text-play/start')
  async start(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.textPlay.start(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
      ),
    };
  }

  @Post(':projectId/text-play/turn')
  async turn(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(StoryTextPlayTurnRequestSchema))
    body: StoryTextPlayTurnRequest,
  ) {
    return {
      code: 200,
      data: await this.textPlay.turn(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        body,
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
