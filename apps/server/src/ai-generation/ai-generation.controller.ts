import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import { AiGenerationService } from './ai-generation.service';
import type { AiJobListQuery, AiSubmitJobBody } from './types';
import type { AuthUser } from '../auth';

@Controller('ai')
export class AiGenerationController {
  constructor(private readonly service: AiGenerationService) {}

  @Get('models')
  async listModels(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceHeader?: string,
  ) {
    return {
      code: 200,
      data: await this.service.listCatalog(
        user,
        normalizeHeaderValue(workspaceHeader),
      ),
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
    @Headers('x-fizz-workspace-id') workspaceHeader?: string,
  ) {
    const data = await this.service.submitJob(
      user,
      body,
      normalizeHeaderValue(workspaceHeader),
    );
    return { code: 200, data };
  }

  @Get('jobs')
  async listJobs(
    @CurrentUser() user: AuthUser,
    @Query() query: AiJobListQuery,
    @Headers('x-fizz-workspace-id') workspaceHeader?: string,
  ) {
    return {
      code: 200,
      data: await this.service.listJobs(
        user,
        query,
        normalizeHeaderValue(workspaceHeader),
      ),
    };
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

function normalizeHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  return normalized || undefined;
}
