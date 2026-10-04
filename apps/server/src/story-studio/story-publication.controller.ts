import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser, ViewerCookie, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StoryProjectIdParamsSchema, type StoryProjectIdParams } from './dto';
import {
  OfflineStoryPublicationSchema,
  SubmitStoryPublicationSchema,
  type SubmitStoryPublicationInput,
} from './story-publication.dto';
import { StoryPublicationService } from './story-publication.service';

/** Authenticated, capability-checked project management; no moderation API is exposed. */
@Controller('story-projects/:projectId/publication')
export class StoryPublicationController {
  constructor(private readonly publications: StoryPublicationService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async read(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.publications.read(user, params.projectId),
    };
  }

  @Post('submit')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async submit(
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(SubmitStoryPublicationSchema))
    body: SubmitStoryPublicationInput,
  ) {
    return {
      code: 200,
      data: await this.publications.submit(
        user,
        params.projectId,
        body,
        cookie,
      ),
    };
  }

  @Post('offline')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async offline(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(OfflineStoryPublicationSchema)) body: unknown,
  ) {
    void body;
    return {
      code: 200,
      data: await this.publications.offline(user, params.projectId),
    };
  }
}
