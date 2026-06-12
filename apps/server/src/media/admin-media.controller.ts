import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminAuthService,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  AdminMediaActionParamsSchema,
  AdminMediaAssetParamsSchema,
  AdminMediaProcessingJobParamsSchema,
  CreateAdminMediaProcessingJobSchema,
  ListAdminMediaAssetsQuerySchema,
  ListAdminMediaModerationActionsQuerySchema,
  ListAdminMediaProcessingJobsQuerySchema,
  type AdminMediaActionParams,
  type AdminMediaAssetParams,
  type AdminMediaProcessingJobParams,
  type CreateAdminMediaProcessingJobInput,
  type ListAdminMediaAssetsQuery,
  type ListAdminMediaModerationActionsQuery,
  type ListAdminMediaProcessingJobsQuery,
} from './admin-media.dto';
import { AdminMediaService } from './admin-media.service';

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/media')
export class AdminMediaController {
  constructor(
    private readonly media: AdminMediaService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.MediaRead)
  @Get('overview')
  async overview() {
    return { code: 200, data: await this.media.overview() };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.MediaRead)
  @Get('assets')
  async listAssets(
    @Query(new ZodValidationPipe(ListAdminMediaAssetsQuerySchema))
    query: ListAdminMediaAssetsQuery,
  ) {
    return { code: 200, data: await this.media.listAssets(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.MediaRead)
  @Get('moderation-actions')
  async listModerationActions(
    @Query(new ZodValidationPipe(ListAdminMediaModerationActionsQuerySchema))
    query: ListAdminMediaModerationActionsQuery,
  ) {
    return { code: 200, data: await this.media.listModerationActions(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Post('moderation-actions/:actionId/retry')
  async retryModerationAction(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminMediaActionParamsSchema))
    params: AdminMediaActionParams,
    @Req() request: Request,
  ) {
    const data = await this.media.retryModerationAction(params.actionId);
    await this.audit(
      admin,
      request,
      'admin.media.moderation_action.retry',
      'media_moderation_action',
      params.actionId,
      { actionType: data.actionType, assetId: data.assetId },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.MediaRead)
  @Get('processing-jobs')
  async listProcessingJobs(
    @Query(new ZodValidationPipe(ListAdminMediaProcessingJobsQuerySchema))
    query: ListAdminMediaProcessingJobsQuery,
  ) {
    return { code: 200, data: await this.media.listProcessingJobs(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Post('assets/:assetId/processing-jobs')
  async createProcessingJob(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminMediaAssetParamsSchema))
    params: AdminMediaAssetParams,
    @Body(new ZodValidationPipe(CreateAdminMediaProcessingJobSchema))
    body: CreateAdminMediaProcessingJobInput,
    @Req() request: Request,
  ) {
    const data = await this.media.createProcessingJob(
      params.assetId,
      admin.id,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.media.processing_job.create',
      'media_asset',
      params.assetId,
      { jobType: body.jobType, jobId: data.id },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Post('processing-jobs/:jobId/retry')
  async retryProcessingJob(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminMediaProcessingJobParamsSchema))
    params: AdminMediaProcessingJobParams,
    @Req() request: Request,
  ) {
    const data = await this.media.retryProcessingJob(params.jobId);
    await this.audit(
      admin,
      request,
      'admin.media.processing_job.retry',
      'media_processing_job',
      params.jobId,
      { jobType: data.jobType, assetId: data.assetId },
    );
    return { code: 200, data };
  }

  private async audit(
    admin: AdminActor,
    request: Request,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.adminAuth.writeAudit({
      actor: admin,
      action,
      resourceType,
      resourceId,
      metadata: metadata as Prisma.InputJsonObject,
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}
