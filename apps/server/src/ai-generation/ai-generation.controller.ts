import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import { RequireQuota } from '../quota/quota.decorator';
import { QuotaGuard } from '../quota/quota.guard';
import { QuotaInterceptor } from '../quota/quota.interceptor';
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

  // Quota enforcement is opt-in **per route** here — no global APP_GUARD —
  // so StoryOS / chat / workflow controllers stay completely untouched.
  // The guard pre-consumes; the interceptor auto-refunds on a thrown
  // exception; the image worker additionally refunds on terminal job
  // failure (out-of-band of the HTTP request).
  @Post('jobs')
  @UseGuards(QuotaGuard)
  @UseInterceptors(QuotaInterceptor)
  @RequireQuota({
    dimension: 'image',
    reason: 'ai_job_create',
    // ai-generation dedupes submits by `body.idempotencyKey` — pull
    // the same key into the quota consume so a retry of the same
    // submission (which DB returns the existing job for) doesn't
    // double-charge the user.
    idempotencyFrom: 'body:idempotencyKey',
  })
  async submitJob(
    @CurrentUser() user: AuthUser,
    @Body() body: AiSubmitJobBody,
  ) {
    // QuotaGuard already pre-consumed (+ audit-logged) before we got
    // here. Image and video both bucket into the `image` dimension
    // — see worker for the per-tier split derived from the model id.
    const data = await this.service.submitJob(user, body);
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
