import { ExperienceStableIdSchema } from '@repo/shared/experience-runtime';
import { STORY_PLAYBACK_MAX_GAME_IDS } from '@repo/shared/story-playback';
import { z } from 'zod';

/**
 * `GET /admin/interactive-film-playback?gameIds=<csv>[&include=clips]`.
 * Ids are deduplicated in request order; Java may list non-UUID (legacy)
 * games, so any stable id is accepted and reported as unmanaged.
 */
export const StoryPlaybackOverviewQuerySchema = z
  .strictObject({
    gameIds: z
      .string()
      .transform((csv) => [
        ...new Set(
          csv
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ])
      .pipe(
        z
          .array(ExperienceStableIdSchema)
          .min(1)
          .max(STORY_PLAYBACK_MAX_GAME_IDS),
      ),
    include: z.literal('clips').optional(),
  })
  .superRefine((query, ctx) => {
    if (query.include === 'clips' && query.gameIds.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['include'],
        message: 'include=clips requires exactly one gameId',
      });
    }
  });
export type StoryPlaybackOverviewQuery = z.infer<
  typeof StoryPlaybackOverviewQuerySchema
>;

export const StoryPlaybackGameParamsSchema = z.strictObject({
  gameId: z.uuid(),
});
export type StoryPlaybackGameParams = z.infer<
  typeof StoryPlaybackGameParamsSchema
>;

/** Action endpoints take no input; an absent JSON body counts as `{}`. */
export const StoryPlaybackEmptyBodySchema = z.strictObject({}).default({});
