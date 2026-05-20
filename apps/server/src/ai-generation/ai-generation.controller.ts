import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth';
import { QuotaUsageLogService } from '../quota/quota-usage-log.service';
import { AiGenerationService } from './ai-generation.service';
import type { AiJobListQuery, AiSubmitJobBody } from './types';
import type { AuthUser } from '../auth';

@Controller('ai')
export class AiGenerationController {
  constructor(
    private readonly service: AiGenerationService,
    private readonly quotaLog: QuotaUsageLogService,
  ) {}

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
    const data = await this.service.submitJob(user, body);
    // Phase 1 observation only — log after the service accepted the
    // submission so we don't count rejections (validation / tier lock)
    // as usage. Image and video both bucket into the `image`
    // dimension here (same Foundry-style queue); the actual jobType
    // is resolved from the model and recorded by the worker in
    // ai-job rows, so we can split per-tier later without a schema
    // change.
    this.quotaLog.log({
      userId: user.userId,
      dimension: 'image',
      reason: 'ai_job_create',
      idempotencyKey: data?.request_id,
      metadata: { modelId: body.modelId, schemaVersion: body.schemaVersion },
    });
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
  async retryJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { code: 200, data: await this.service.retryJob(user, id) };
  }
}
