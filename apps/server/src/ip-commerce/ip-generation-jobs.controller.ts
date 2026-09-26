import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { IpGenerationJobsService } from './ip-generation-jobs.service';

const Params = z.object({
  ipId: z.string().uuid(),
  templateId: z.string().uuid(),
});

const JobParams = z.object({
  ipId: z.string().uuid(),
  templateId: z.string().uuid(),
  jobId: z.string().uuid(),
});

const PreviewBodySchema = z
  .object({
    referenceImageAssetId: z.string().uuid().optional(),
  })
  .strict();

const RunBodySchema = z
  .object({
    referenceImageAssetId: z.string().uuid().optional(),
    viewerPrompt: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().trim().min(1).max(128),
  })
  .strict();

@Controller('ip-commerce')
export class IpGenerationJobsController {
  constructor(private readonly service: IpGenerationJobsService) {}

  @Post('ips/:ipId/generation-templates/:templateId/preview')
  async previewCost(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @Body(new ZodValidationPipe(PreviewBodySchema))
    body: z.infer<typeof PreviewBodySchema>,
  ) {
    return {
      code: 200,
      data: await this.service.previewCost(
        user,
        params.ipId,
        params.templateId,
        body,
      ),
    };
  }

  @Post('ips/:ipId/generation-templates/:templateId/run')
  async runJob(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @Body(new ZodValidationPipe(RunBodySchema))
    body: z.infer<typeof RunBodySchema>,
  ) {
    return {
      code: 200,
      data: await this.service.runJob(
        user,
        params.ipId,
        params.templateId,
        body,
      ),
    };
  }

  @Get('ips/:ipId/generation-templates/:templateId/jobs/:jobId')
  async getStatus(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(JobParams)) params: z.infer<typeof JobParams>,
  ) {
    return {
      code: 200,
      data: await this.service.getAudienceJobStatus(
        user,
        params.ipId,
        params.templateId,
        params.jobId,
      ),
    };
  }
}
