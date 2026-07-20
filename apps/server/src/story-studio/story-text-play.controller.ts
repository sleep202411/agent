import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  StoryProjectIdParamsSchema,
  StoryUuidSchema,
  type StoryProjectIdParams,
} from './dto';
import {
  StoryTextPlayDirectionSchema,
  StoryTextPlayService,
  StoryTextPlayTurnRequestSchema,
  type StoryTextPlayTurnRequest,
} from './story-text-play.service';

/** Java's gameId is our project id, but it travels as an opaque public token. */
const StoryTextExperienceParamsSchema = z
  .object({ gameId: z.string().trim().min(1).max(160) })
  .strict();
type StoryTextExperienceParams = z.infer<
  typeof StoryTextExperienceParamsSchema
>;

const ContentVersionSchema = z.string().trim().min(1).max(160);

const StoryTextExperienceDirectionsSchema = z
  .object({
    contentVersion: ContentVersionSchema,
    count: z.number().int().min(3).max(6).default(6),
  })
  .strict();
type StoryTextExperienceDirections = z.infer<
  typeof StoryTextExperienceDirectionsSchema
>;

const StoryTextExperienceStartSchema = z
  .object({
    contentVersion: ContentVersionSchema,
    direction: StoryTextPlayDirectionSchema.nullable().default(null),
  })
  .strict();
type StoryTextExperienceStart = z.infer<typeof StoryTextExperienceStartSchema>;

const StoryTextExperienceTurnSchema = StoryTextPlayTurnRequestSchema.extend({
  contentVersion: ContentVersionSchema,
});
type StoryTextExperienceTurn = z.infer<typeof StoryTextExperienceTurnSchema>;

/**
 * Creator-side text-adventure 试玩 against the live draft.
 *
 * The PUBLIC runtime for a published text adventure lives in
 * `StoryTextExperienceController` below — same engine, frozen revision.
 */
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

/**
 * Public text-adventure runtime. A text adventure is an authored skeleton the
 * model narrates between anchors, so playback is a turn loop rather than the
 * frozen manifest playback an interactive film uses — the film path is
 * untouched. A confirmed publication is the anonymous read grant; the client
 * carries the play state, so the runtime stays stateless.
 */
@Controller('story-experiences')
export class StoryTextExperienceController {
  constructor(private readonly textPlay: StoryTextPlayService) {}

  /** Entry directions the player picks between before the first beat. */
  @Post(':gameId/text-play/directions')
  @Public()
  async directions(
    @Param(new ZodValidationPipe(StoryTextExperienceParamsSchema))
    params: StoryTextExperienceParams,
    @Body(new ZodValidationPipe(StoryTextExperienceDirectionsSchema))
    body: StoryTextExperienceDirections,
  ) {
    return {
      code: 200,
      data: {
        directions: await this.textPlay.publishedDirections(
          params.gameId,
          body.contentVersion,
          body.count,
        ),
      },
    };
  }

  @Post(':gameId/text-play/start')
  @Public()
  async start(
    @Param(new ZodValidationPipe(StoryTextExperienceParamsSchema))
    params: StoryTextExperienceParams,
    @Body(new ZodValidationPipe(StoryTextExperienceStartSchema))
    body: StoryTextExperienceStart,
  ) {
    return {
      code: 200,
      data: await this.textPlay.startPublished(
        params.gameId,
        body.contentVersion,
        body.direction,
      ),
    };
  }

  @Post(':gameId/text-play/turn')
  @Public()
  async turn(
    @Param(new ZodValidationPipe(StoryTextExperienceParamsSchema))
    params: StoryTextExperienceParams,
    @Body(new ZodValidationPipe(StoryTextExperienceTurnSchema))
    body: StoryTextExperienceTurn,
  ) {
    const { contentVersion, ...request } = body;
    return {
      code: 200,
      data: await this.textPlay.turnPublished(
        params.gameId,
        contentVersion,
        request,
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
