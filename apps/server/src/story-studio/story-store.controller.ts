import { Controller, Get, Param } from '@nestjs/common';
import { ExperienceStableIdSchema } from '@repo/shared/experience-runtime';
import { z } from 'zod';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StoryStoreService } from './story-store.service';

const GameIdParamsSchema = z
  .object({ gameId: ExperienceStableIdSchema })
  .strict();

/**
 * /aurora/story-store/:gameId — the PUBLIC store listing read behind the web
 * 影游 store dialog. New releases use the Story Project UUID; historical
 * Java works may use other stable IDs. Anonymous callers are served; unreleased or unlisted projects and
 * projects without a frozen public introduction resolve to `data: null` so the web
 * dialog can fall back to catalogue metadata without extra signalling.
 */
@Controller('story-store')
export class StoryStoreController {
  constructor(private readonly store: StoryStoreService) {}

  @Get(':gameId')
  @Public()
  async listing(
    @Param(new ZodValidationPipe(GameIdParamsSchema))
    params: z.infer<typeof GameIdParamsSchema>,
  ) {
    return { code: 200, data: await this.store.getListing(params.gameId) };
  }
}
