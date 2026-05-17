import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth';
import { AiGenerationService } from './ai-generation.service';
import type { AiJobListQuery, AiSubmitJobBody } from './types';
import type { AuthUser } from '../auth';

@Controller('foundry')
export class AiGenerationController {
  constructor(private readonly foundry: AiGenerationService) {}

  @Get('models')
  async listModels(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      data: { models: await this.foundry.listModels(user) },
    };
  }

  @Post('jobs')
  async submitJob(
    @CurrentUser() user: AuthUser,
    @Body() body: AiSubmitJobBody,
  ) {
    return { code: 200, data: await this.foundry.submitJob(user, body) };
  }

  @Get('jobs')
  listJobs(@CurrentUser() user: AuthUser, @Query() query: AiJobListQuery) {
    return { code: 200, data: this.foundry.listJobs(user, query) };
  }

  @Get('jobs/:id/status')
  getStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { code: 200, data: this.foundry.getStatus(user, id) };
  }

  @Get('jobs/:id')
  getJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { code: 200, data: this.foundry.getJob(user, id) };
  }

  @Post('jobs/:id/cancel')
  cancelJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { code: 200, data: this.foundry.cancelJob(user, id) };
  }

  @Post('jobs/:id/retry')
  async retryJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { code: 200, data: await this.foundry.retryJob(user, id) };
  }
}
