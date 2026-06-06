import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminAuthService,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../../admin-auth';
import { Public } from '../../auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import {
  AdminAiModelParamsSchema,
  AdminAiJobParamsSchema,
  AdminAiProviderParamsSchema,
  AdminAiProviderBindingParamsSchema,
  AdminAiProviderEndpointParamsSchema,
  CreateCanonicalModelSchema,
  CreateProviderEndpointSchema,
  CreateProviderBindingSchema,
  ListAdminAiJobsQuerySchema,
  ListAdminAiModelsQuerySchema,
  ListAdminAiProviderBindingsQuerySchema,
  ListAdminAiProviderEndpointsQuerySchema,
  ListAdminAiProvidersQuerySchema,
  UpdateCanonicalModelSchema,
  UpdateAdminAiProviderSchema,
  UpdateProviderEndpointSchema,
  UpdateProviderBindingSchema,
  type AdminAiModelParams,
  type AdminAiJobParams,
  type AdminAiProviderParams,
  type AdminAiProviderBindingParams,
  type AdminAiProviderEndpointParams,
  type CreateCanonicalModelInput,
  type CreateProviderEndpointInput,
  type CreateProviderBindingInput,
  type ListAdminAiJobsQuery,
  type ListAdminAiModelsQuery,
  type ListAdminAiProviderBindingsQuery,
  type ListAdminAiProviderEndpointsQuery,
  type ListAdminAiProvidersQuery,
  type UpdateAdminAiProviderInput,
  type UpdateCanonicalModelInput,
  type UpdateProviderEndpointInput,
  type UpdateProviderBindingInput,
} from './ai-model-ops.dto';
import { AiModelOpsService } from './ai-model-ops.service';

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/ai-model-ops')
export class AiModelOpsController {
  constructor(
    private readonly modelOps: AiModelOpsService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get('overview')
  async overview() {
    return { code: 200, data: await this.modelOps.getOverview() };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get('providers')
  async listProviders(
    @Query(new ZodValidationPipe(ListAdminAiProvidersQuerySchema))
    query: ListAdminAiProvidersQuery,
  ) {
    return { code: 200, data: await this.modelOps.listProviders(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Patch('providers/:providerAccountId')
  async updateProvider(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminAiProviderParamsSchema))
    params: AdminAiProviderParams,
    @Body(new ZodValidationPipe(UpdateAdminAiProviderSchema))
    body: UpdateAdminAiProviderInput,
    @Req() request: Request,
  ) {
    const data = await this.modelOps.updateProviderAccount(
      params.providerAccountId,
      admin.id,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.ai_model_ops.provider.update',
      'ai_provider_account',
      params.providerAccountId,
      {
        status: body.status,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get('models')
  async listModels(
    @Query(new ZodValidationPipe(ListAdminAiModelsQuerySchema))
    query: ListAdminAiModelsQuery,
  ) {
    return { code: 200, data: await this.modelOps.listCanonicalModels(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Post('models')
  async createModel(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateCanonicalModelSchema))
    body: CreateCanonicalModelInput,
    @Req() request: Request,
  ) {
    const data = await this.modelOps.createCanonicalModel(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.ai_model_ops.model.create',
      'ai_canonical_model',
      data.id,
      { slug: body.slug, modality: body.modality, status: body.status },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Patch('models/:modelId')
  async updateModel(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminAiModelParamsSchema))
    params: AdminAiModelParams,
    @Body(new ZodValidationPipe(UpdateCanonicalModelSchema))
    body: UpdateCanonicalModelInput,
    @Req() request: Request,
  ) {
    const data = await this.modelOps.updateCanonicalModel(
      params.modelId,
      admin.id,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.ai_model_ops.model.update',
      'ai_canonical_model',
      params.modelId,
      body,
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get('bindings')
  async listBindings(
    @Query(new ZodValidationPipe(ListAdminAiProviderBindingsQuerySchema))
    query: ListAdminAiProviderBindingsQuery,
  ) {
    return { code: 200, data: await this.modelOps.listProviderBindings(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get('endpoints')
  async listEndpoints(
    @Query(new ZodValidationPipe(ListAdminAiProviderEndpointsQuerySchema))
    query: ListAdminAiProviderEndpointsQuery,
  ) {
    return {
      code: 200,
      data: await this.modelOps.listProviderEndpoints(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Post('endpoints')
  async createEndpoint(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateProviderEndpointSchema))
    body: CreateProviderEndpointInput,
    @Req() request: Request,
  ) {
    const data = await this.modelOps.createProviderEndpoint(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.ai_model_ops.endpoint.create',
      'ai_provider_endpoint',
      data.id,
      {
        providerAccountId: body.providerAccountId,
        endpointId: body.endpointId,
        modality: body.modality,
        status: body.status,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Patch('endpoints/:endpointId')
  async updateEndpoint(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminAiProviderEndpointParamsSchema))
    params: AdminAiProviderEndpointParams,
    @Body(new ZodValidationPipe(UpdateProviderEndpointSchema))
    body: UpdateProviderEndpointInput,
    @Req() request: Request,
  ) {
    const data = await this.modelOps.updateProviderEndpoint(
      params.endpointId,
      admin.id,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.ai_model_ops.endpoint.update',
      'ai_provider_endpoint',
      params.endpointId,
      {
        displayName: body.displayName,
        status: body.status,
        healthStatus: body.healthStatus,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Delete('endpoints/:endpointId')
  async archiveEndpoint(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminAiProviderEndpointParamsSchema))
    params: AdminAiProviderEndpointParams,
    @Req() request: Request,
  ) {
    const data = await this.modelOps.archiveProviderEndpoint(
      params.endpointId,
      admin.id,
    );
    await this.audit(
      admin,
      request,
      'admin.ai_model_ops.endpoint.archive',
      'ai_provider_endpoint',
      params.endpointId,
      {
        endpointId: data.endpointId,
        provider: data.provider,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Post('bindings')
  async createBinding(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateProviderBindingSchema))
    body: CreateProviderBindingInput,
    @Req() request: Request,
  ) {
    const data = await this.modelOps.createProviderBinding(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.ai_model_ops.binding.create',
      'ai_provider_model_binding',
      data.id,
      {
        canonicalModelId: body.canonicalModelId,
        providerEndpointId: body.providerEndpointId,
        status: body.status,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsWrite)
  @Patch('bindings/:bindingId')
  async updateBinding(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminAiProviderBindingParamsSchema))
    params: AdminAiProviderBindingParams,
    @Body(new ZodValidationPipe(UpdateProviderBindingSchema))
    body: UpdateProviderBindingInput,
    @Req() request: Request,
  ) {
    const data = await this.modelOps.updateProviderBinding(
      params.bindingId,
      admin.id,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.ai_model_ops.binding.update',
      'ai_provider_model_binding',
      params.bindingId,
      {
        status: body.status,
        priority: body.priority,
        weight: body.weight,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get('jobs')
  async listJobs(
    @Query(new ZodValidationPipe(ListAdminAiJobsQuerySchema))
    query: ListAdminAiJobsQuery,
  ) {
    return { code: 200, data: await this.modelOps.listJobs(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiModelOpsRead)
  @Get('jobs/:jobId')
  async getJob(
    @Param(new ZodValidationPipe(AdminAiJobParamsSchema))
    params: AdminAiJobParams,
  ) {
    return { code: 200, data: await this.modelOps.getJob(params.jobId) };
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
      metadata: toAuditJsonObject(metadata),
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

function toAuditJsonObject(
  value: Record<string, unknown>,
): Prisma.InputJsonObject {
  const output: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    output[key] = toAuditJsonValue(entry);
  }
  return output as Prisma.InputJsonObject;
}

function toAuditJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return value as Prisma.InputJsonValue;
  }
  if (Array.isArray(value)) return value.map((item) => toAuditJsonValue(item));
  if (typeof value === 'object') {
    return toAuditJsonObject(value as Record<string, unknown>);
  }
  if (typeof value === 'bigint') return value.toString();
  return null;
}
