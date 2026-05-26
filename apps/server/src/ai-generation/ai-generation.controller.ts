import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth';
import { GeoContext, type RequestGeoContext } from '../common/region';
import { AiGenerationService } from './ai-generation.service';
import type { AiJobListQuery, AiSubmitJobBody } from './types';
import type { AuthUser } from '../auth';

@Controller('ai')
export class AiGenerationController {
  constructor(private readonly service: AiGenerationService) {}

  @Get('models')
  async listModels(
    @CurrentUser() user: AuthUser,
    @GeoContext() geo: RequestGeoContext,
  ) {
    return {
      code: 200,
      data: await this.service.listCatalog(user, geo),
    };
  }

  // Quota is enforced inside AiGenerationService after routing has
  // selected the model/policy. This is required for campaign/free
  // models and future preset-based routing. StoryOS / chat / workflow
  // controllers remain untouched.
  @Post('jobs')
  async submitJob(
    @CurrentUser() user: AuthUser,
    @Body() body: AiSubmitJobBody,
    @GeoContext() geo: RequestGeoContext,
  ) {
    const data = await this.service.submitJob(user, body, geo);
    return { code: 200, data };
  }

  @Get('jobs')
  async listJobs(
    @CurrentUser() user: AuthUser,
    @Query() query: AiJobListQuery,
  ) {
    return { code: 200, data: await this.service.listJobs(user, query) };
  }

  @Get('jobs/:id/status')
  async getStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { code: 200, data: await this.service.getStatus(user, id) };
  }

  @Get('jobs/:id')
  async getJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { code: 200, data: await this.service.getJob(user, id) };
  }

  @Post('jobs/:id/cancel')
  async cancelJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { code: 200, data: await this.service.cancelJob(user, id) };
  }

  @Post('jobs/:id/retry')
  async retryJob(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @GeoContext() geo: RequestGeoContext,
  ) {
    return { code: 200, data: await this.service.retryJob(user, id, geo) };
  }
}
