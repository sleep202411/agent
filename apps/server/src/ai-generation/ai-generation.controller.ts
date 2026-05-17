import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth';
import { AiGenerationService } from './ai-generation.service';
import type { AiJobListQuery, AiSubmitJobBody } from './types';
import type { AuthUser } from '../auth';

@Controller('ai')
export class AiGenerationController {
  constructor(private readonly service: AiGenerationService) {}

  @Get('models')
  async listModels(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      data: { models: await this.service.listModels(user) },
    };
  }

  @Post('jobs')
  async submitJob(
    @CurrentUser() user: AuthUser,
    @Body() body: AiSubmitJobBody,
  ) {
    return { code: 200, data: await this.service.submitJob(user, body) };
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
  async retryJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { code: 200, data: await this.service.retryJob(user, id) };
  }
}
