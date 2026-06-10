import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AiControlPlaneStatus,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../../infra/storage/media-asset-url-resolver.service';
import {
  estimateProductModelPoints,
  type AiProductPricingPolicy,
} from '@repo/shared';
import type {
  CreateCanonicalModelInput,
  CreateProviderEndpointInput,
  CreateProviderBindingInput,
  ListAdminAiJobsQuery,
  ListAdminAiAssetsQuery,
  ListAdminAiModelsQuery,
  ListAdminAiProviderBindingsQuery,
  ListAdminAiProviderEndpointsQuery,
  ListAdminAiProvidersQuery,
  UpdateAdminAiProviderInput,
  UpdateAdminAiMediaAssetModerationInput,
  UpdateCanonicalModelInput,
  UpdateProviderEndpointInput,
  UpdateProviderBindingInput,
} from './ai-model-ops.dto';

@Injectable()
export class AiModelOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetUrls: MediaAssetUrlResolverService,
  ) {}

  async getOverview() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      providerAccounts,
      providerEndpoints,
      canonicalModels,
      providerBindings,
      recentJobs,
      failedJobs24h,
      queuedJobs,
      runningJobs,
      unprocessedEvents,
      deadOutboxEvents,
      costLedger24h,
    ] = await Promise.all([
      this.prisma.aiProviderAccount.count({ where: { archivedAt: null } }),
      this.prisma.aiProviderEndpoint.count({ where: { archivedAt: null } }),
      this.prisma.aiCanonicalModel.count({ where: { archivedAt: null } }),
      this.prisma.aiProviderModelBinding.count({ where: { archivedAt: null } }),
      this.prisma.aiJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          provider: true,
          modelId: true,
          providerJobId: true,
          status: true,
          stage: true,
          userId: true,
          createdAt: true,
          completedAt: true,
          canonicalModel: {
            select: { id: true, slug: true, displayName: true },
          },
          providerBinding: {
            select: { id: true, endpointId: true, status: true },
          },
        },
      }),
      this.prisma.aiJob.count({
        where: { status: 'failed', createdAt: { gte: since } },
      }),
      this.prisma.aiJob.count({ where: { status: 'in_queue' } }),
      this.prisma.aiJob.count({ where: { status: 'in_progress' } }),
      this.prisma.aiProviderEvent.count({ where: { processedAt: null } }),
      this.prisma.aiEventOutbox.count({ where: { deadAt: { not: null } } }),
      this.prisma.aiCostLedgerEntry.findMany({
        where: { createdAt: { gte: since } },
        select: {
          entryType: true,
          currency: true,
          amount: true,
          providerCostUsd: true,
          marginUsd: true,
        },
      }),
    ]);

    return {
      metrics: {
        providerAccounts,
        providerEndpoints,
        canonicalModels,
        providerBindings,
        queuedJobs,
        runningJobs,
        failedJobs24h,
        unprocessedEvents,
        deadOutboxEvents,
      },
      cost24h: summarizeCost(costLedger24h),
      recentJobs: recentJobs.map(serializeJobSummary),
    };
  }

  async listProviders(query: ListAdminAiProvidersQuery) {
    const where: Prisma.AiProviderAccountWhereInput = {
      archivedAt: null,
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const items = await this.prisma.aiProviderAccount.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: query.limit,
      include: providerAccountInclude(),
    });
    return { items: items.map(serializeProviderAccount) };
  }

  async updateProviderAccount(
    providerAccountId: string,
    adminId: string,
    input: UpdateAdminAiProviderInput,
  ) {
    const existing = await this.prisma.aiProviderAccount.findFirst({
      where: { id: providerAccountId, archivedAt: null },
      select: {
        id: true,
        provider: true,
      },
    });
    if (!existing) throw new NotFoundException('供应商账号不存在或已归档。');

    const data: Prisma.AiProviderAccountUpdateInput = {
      updatedByAdminId: adminId,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.rateLimitPolicy !== undefined
        ? { rateLimitPolicy: input.rateLimitPolicy as Prisma.InputJsonValue }
        : {}),
      ...(input.quotaPolicy !== undefined
        ? { quotaPolicy: input.quotaPolicy as Prisma.InputJsonValue }
        : {}),
    };

    const account = await this.prisma.aiProviderAccount.update({
      where: { id: providerAccountId },
      data,
      include: providerAccountInclude(),
    });
    return serializeProviderAccount(account);
  }

  async listCanonicalModels(query: ListAdminAiModelsQuery) {
    const items = await this.prisma.aiCanonicalModel.findMany({
      where: {
        archivedAt: null,
        ...(query.modality ? { modality: query.modality } : {}),
        ...(query.family ? { family: query.family } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ modality: 'asc' }, { family: 'asc' }, { displayName: 'asc' }],
      take: query.limit,
      include: {
        _count: {
          select: { bindings: true, jobs: true },
        },
        bindings: {
          where: { archivedAt: null },
          select: {
            priority: true,
            status: true,
          },
          orderBy: { priority: 'asc' },
        },
      },
    });
    return { items: items.map(serializeCanonicalModel) };
  }

  async createCanonicalModel(
    adminId: string,
    input: CreateCanonicalModelInput,
  ) {
    const model = await this.prisma.aiCanonicalModel.create({
      data: canonicalModelCreateData(input, adminId),
      include: {
        _count: {
          select: { bindings: true, jobs: true },
        },
      },
    });
    return serializeCanonicalModel(model);
  }

  async updateCanonicalModel(
    modelId: string,
    adminId: string,
    input: UpdateCanonicalModelInput,
  ) {
    const data: Prisma.AiCanonicalModelUpdateInput = {
      updatedByAdminId: adminId,
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
      ...(input.family !== undefined ? { family: input.family } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.generationModes !== undefined
        ? { generationModes: input.generationModes as Prisma.InputJsonValue }
        : {}),
      ...(input.parameterPolicy !== undefined
        ? { parameterPolicy: input.parameterPolicy as Prisma.InputJsonValue }
        : {}),
      ...(input.outputPolicy !== undefined
        ? { outputPolicy: input.outputPolicy as Prisma.InputJsonValue }
        : {}),
      ...(input.entitlementPolicy !== undefined
        ? {
            entitlementPolicy: input.entitlementPolicy as Prisma.InputJsonValue,
          }
        : {}),
      ...(input.billingPolicy !== undefined
        ? { billingPolicy: input.billingPolicy as Prisma.InputJsonValue }
        : {}),
      ...(input.queuePolicy !== undefined
        ? { queuePolicy: input.queuePolicy as Prisma.InputJsonValue }
        : {}),
      ...(input.uiPolicy !== undefined
        ? { uiPolicy: input.uiPolicy as Prisma.InputJsonValue }
        : {}),
      ...(input.observabilityPolicy !== undefined
        ? {
            observabilityPolicy:
              input.observabilityPolicy as Prisma.InputJsonValue,
          }
        : {}),
      ...(input.metadata !== undefined
        ? { metadata: input.metadata as Prisma.InputJsonValue }
        : {}),
    };
    const model = await this.prisma.aiCanonicalModel.update({
      where: { id: modelId },
      data,
      include: {
        _count: {
          select: { bindings: true, jobs: true },
        },
      },
    });
    return serializeCanonicalModel(model);
  }

  async listProviderBindings(query: ListAdminAiProviderBindingsQuery) {
    const items = await this.prisma.aiProviderModelBinding.findMany({
      where: {
        archivedAt: null,
        ...(query.provider ? { provider: query.provider } : {}),
        ...(query.endpointId
          ? { endpointId: { contains: query.endpointId } }
          : {}),
        ...(query.canonicalModelId
          ? { canonicalModelId: query.canonicalModelId }
          : {}),
        ...(query.modality ? { modality: query.modality } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [
        { status: 'asc' },
        { provider: 'asc' },
        { priority: 'asc' },
        { endpointId: 'asc' },
      ],
      take: query.limit,
      include: {
        providerAccount: true,
        providerEndpoint: true,
        canonicalModel: true,
        _count: { select: { jobs: true } },
      },
    });
    return { items: items.map(serializeProviderBinding) };
  }

  async listProviderEndpoints(query: ListAdminAiProviderEndpointsQuery) {
    const items = await this.prisma.aiProviderEndpoint.findMany({
      where: {
        archivedAt: null,
        ...(query.providerAccountId
          ? { providerAccountId: query.providerAccountId }
          : {}),
        ...(query.provider ? { provider: query.provider } : {}),
        ...(query.endpointId
          ? { endpointId: { contains: query.endpointId } }
          : {}),
        ...(query.modality ? { modality: query.modality } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.healthStatus ? { healthStatus: query.healthStatus } : {}),
      },
      orderBy: [{ status: 'asc' }, { provider: 'asc' }, { endpointId: 'asc' }],
      take: query.limit,
      include: providerEndpointInclude(),
    });
    return { items: items.map(serializeProviderEndpoint) };
  }

  async createProviderEndpoint(
    adminId: string,
    input: CreateProviderEndpointInput,
  ) {
    const providerAccount = await this.prisma.aiProviderAccount.findFirst({
      where: { id: input.providerAccountId, archivedAt: null },
      select: { id: true, provider: true },
    });
    if (!providerAccount) {
      throw new NotFoundException('供应商账号不存在或已归档。');
    }

    const duplicate = await this.prisma.aiProviderEndpoint.findFirst({
      where: {
        providerAccountId: input.providerAccountId,
        endpointId: input.endpointId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(`供应商端点已存在：${input.endpointId}`);
    }

    const endpoint = await this.prisma.aiProviderEndpoint.create({
      data: {
        providerAccountId: providerAccount.id,
        provider: providerAccount.provider,
        endpointId: input.endpointId,
        displayName: input.displayName ?? null,
        modality: input.modality,
        status: input.status,
        healthStatus: input.healthStatus,
        supportedModes: input.supportedModes as Prisma.InputJsonValue,
        providerInputSchema: input.providerInputSchema as Prisma.InputJsonValue,
        providerOutputSchema:
          input.providerOutputSchema as Prisma.InputJsonValue,
        maxConcurrentRequests: input.maxConcurrentRequests ?? null,
        maxRequestsPerMinute: input.maxRequestsPerMinute ?? null,
        requestTimeoutSeconds: input.requestTimeoutSeconds ?? null,
        cooldownSeconds: input.cooldownSeconds ?? null,
        failureThreshold: input.failureThreshold ?? null,
        catalogSnapshot: input.catalogSnapshot as Prisma.InputJsonValue,
        disabledReason: input.disabledReason ?? null,
        createdByAdminId: adminId,
        updatedByAdminId: adminId,
      },
      include: providerEndpointInclude(),
    });
    return serializeProviderEndpoint(endpoint);
  }

  async updateProviderEndpoint(
    endpointId: string,
    adminId: string,
    input: UpdateProviderEndpointInput,
  ) {
    const existing = await this.prisma.aiProviderEndpoint.findFirst({
      where: { id: endpointId, archivedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('供应商端点不存在或已归档。');

    const endpoint = await this.prisma.aiProviderEndpoint.update({
      where: { id: endpointId },
      data: {
        ...(input.displayName !== undefined
          ? { displayName: input.displayName ?? null }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.healthStatus !== undefined
          ? { healthStatus: input.healthStatus }
          : {}),
        ...(input.supportedModes !== undefined
          ? { supportedModes: input.supportedModes as Prisma.InputJsonValue }
          : {}),
        ...(input.providerInputSchema !== undefined
          ? {
              providerInputSchema:
                input.providerInputSchema as Prisma.InputJsonValue,
            }
          : {}),
        ...(input.providerOutputSchema !== undefined
          ? {
              providerOutputSchema:
                input.providerOutputSchema as Prisma.InputJsonValue,
            }
          : {}),
        ...(input.maxConcurrentRequests !== undefined
          ? { maxConcurrentRequests: input.maxConcurrentRequests }
          : {}),
        ...(input.maxRequestsPerMinute !== undefined
          ? { maxRequestsPerMinute: input.maxRequestsPerMinute }
          : {}),
        ...(input.requestTimeoutSeconds !== undefined
          ? { requestTimeoutSeconds: input.requestTimeoutSeconds }
          : {}),
        ...(input.cooldownSeconds !== undefined
          ? { cooldownSeconds: input.cooldownSeconds }
          : {}),
        ...(input.failureThreshold !== undefined
          ? { failureThreshold: input.failureThreshold }
          : {}),
        ...(input.catalogSnapshot !== undefined
          ? { catalogSnapshot: input.catalogSnapshot as Prisma.InputJsonValue }
          : {}),
        ...(input.disabledReason !== undefined
          ? { disabledReason: input.disabledReason ?? null }
          : {}),
        updatedByAdminId: adminId,
      },
      include: providerEndpointInclude(),
    });
    return serializeProviderEndpoint(endpoint);
  }

  async archiveProviderEndpoint(endpointId: string, adminId: string) {
    const endpoint = await this.prisma.aiProviderEndpoint.findFirst({
      where: { id: endpointId, archivedAt: null },
      include: { _count: { select: { bindings: true } } },
    });
    if (!endpoint) throw new NotFoundException('供应商端点不存在或已归档。');
    if (endpoint._count.bindings > 0) {
      throw new BadRequestException(
        '该端点仍存在 Provider 绑定，请先归档绑定后再删除端点。',
      );
    }

    const archived = await this.prisma.aiProviderEndpoint.update({
      where: { id: endpointId },
      data: {
        status: AiControlPlaneStatus.archived,
        archivedAt: new Date(),
        updatedByAdminId: adminId,
      },
      include: providerEndpointInclude(),
    });
    return serializeProviderEndpoint(archived);
  }

  async createProviderBinding(
    adminId: string,
    input: CreateProviderBindingInput,
  ) {
    const [endpoint, canonicalModel] = await Promise.all([
      this.prisma.aiProviderEndpoint.findUniqueOrThrow({
        where: { id: input.providerEndpointId },
        include: { providerAccount: true },
      }),
      this.prisma.aiCanonicalModel.findUniqueOrThrow({
        where: { id: input.canonicalModelId },
        select: { id: true, modality: true, archivedAt: true },
      }),
    ]);
    if (canonicalModel.archivedAt) {
      throw new BadRequestException('Cannot bind an archived canonical model.');
    }
    if (canonicalModel.modality !== endpoint.modality) {
      throw new BadRequestException(
        `Canonical model modality ${canonicalModel.modality} does not match endpoint modality ${endpoint.modality}.`,
      );
    }
    const existing = await this.prisma.aiProviderModelBinding.findFirst({
      where: {
        providerAccountId: endpoint.providerAccountId,
        endpointId: endpoint.endpointId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'This provider endpoint is already bound. Archive the existing binding before creating a new route.',
      );
    }
    const data = providerBindingDataFromEndpoint(endpoint, input, adminId);
    const binding = await this.prisma.aiProviderModelBinding.create({
      data: {
        ...data,
        createdByAdminId: adminId,
      },
      include: {
        providerAccount: true,
        providerEndpoint: true,
        canonicalModel: true,
        _count: { select: { jobs: true } },
      },
    });
    return serializeProviderBinding(binding);
  }

  async updateProviderBinding(
    bindingId: string,
    adminId: string,
    input: UpdateProviderBindingInput,
  ) {
    const binding = await this.prisma.aiProviderModelBinding.update({
      where: { id: bindingId },
      data: {
        status: input.status,
        priority: input.priority,
        weight: input.weight,
        disabledReason:
          input.disabledReason !== undefined ? input.disabledReason : undefined,
        updatedByAdminId: adminId,
      },
      include: {
        providerAccount: true,
        providerEndpoint: true,
        canonicalModel: true,
        _count: { select: { jobs: true } },
      },
    });
    return serializeProviderBinding(binding);
  }

  async listJobs(query: ListAdminAiJobsQuery) {
    const items = await this.prisma.aiJob.findMany({
      where: {
        deletedAt: null,
        ...(query.provider ? { provider: query.provider } : {}),
        ...(query.modelId ? { modelId: query.modelId } : {}),
        ...(query.providerJobId ? { providerJobId: query.providerJobId } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        canonicalModel: true,
        providerBinding: true,
        attempts: {
          orderBy: { attemptNumber: 'desc' },
          take: 1,
        },
        outputs: {
          where: { deletedAt: null },
          orderBy: { outputIndex: 'asc' },
          take: 4,
          include: { asset: true },
        },
        costLedger: {
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
    });
    return { items: items.map(serializeJobListItem) };
  }

  async listAssets(query: ListAdminAiAssetsQuery) {
    const items = await this.prisma.mediaAsset.findMany({
      where: {
        deletedAt: null,
        source: query.source ?? MediaAssetSource.ai_output,
        ...(query.moderationStatus
          ? { moderationStatus: query.moderationStatus }
          : {}),
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.userId ? { createdByUserId: query.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        aiJobOutputs: {
          where: { deletedAt: null },
          orderBy: { outputIndex: 'asc' },
          take: 4,
          include: {
            job: {
              select: {
                id: true,
                prompt: true,
                provider: true,
                modelId: true,
                deployment: true,
                status: true,
                stage: true,
                userId: true,
                workspaceId: true,
                createdAt: true,
                canonicalModel: {
                  select: { id: true, slug: true, displayName: true },
                },
                providerBinding: {
                  select: { id: true, endpointId: true, provider: true },
                },
              },
            },
          },
        },
      },
    });
    return {
      items: items.map((asset) => serializeMediaAsset(asset, this.assetUrls)),
    };
  }

  async updateAssetModeration(
    assetId: string,
    adminId: string,
    input: UpdateAdminAiMediaAssetModerationInput,
  ) {
    const existing = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('资产不存在或已删除。');

    const asset = await this.prisma.mediaAsset.update({
      where: { id: assetId },
      data: {
        moderationStatus: input.moderationStatus,
        moderationReason: input.reason ?? null,
        moderatedByAdminId: adminId,
        moderatedAt: new Date(),
        status:
          input.moderationStatus === MediaAssetModerationStatus.blocked
            ? MediaAssetStatus.ready
            : undefined,
      },
      include: {
        aiJobOutputs: {
          where: { deletedAt: null },
          orderBy: { outputIndex: 'asc' },
          take: 4,
          include: {
            job: {
              select: {
                id: true,
                prompt: true,
                provider: true,
                modelId: true,
                deployment: true,
                status: true,
                stage: true,
                userId: true,
                workspaceId: true,
                createdAt: true,
                canonicalModel: {
                  select: { id: true, slug: true, displayName: true },
                },
                providerBinding: {
                  select: { id: true, endpointId: true, provider: true },
                },
              },
            },
          },
        },
      },
    });
    return serializeMediaAsset(asset, this.assetUrls);
  }

  async getJob(jobId: string) {
    const job = await this.prisma.aiJob.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        canonicalModel: true,
        providerBinding: {
          include: { providerAccount: true },
        },
        attempts: { orderBy: { attemptNumber: 'asc' } },
        outputs: {
          orderBy: { outputIndex: 'asc' },
          include: { asset: true },
        },
        costLedger: { orderBy: { createdAt: 'asc' } },
        traceEvents: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    return serializeJobDetail(job);
  }
}

function summarizeCost(
  rows: Array<{
    entryType: string;
    currency: string;
    amount: Prisma.Decimal;
    providerCostUsd: Prisma.Decimal | null;
    marginUsd: Prisma.Decimal | null;
  }>,
) {
  const byCurrency = new Map<string, number>();
  let providerCostUsd = 0;
  let marginUsd = 0;
  for (const row of rows) {
    byCurrency.set(
      row.currency,
      (byCurrency.get(row.currency) ?? 0) + row.amount.toNumber(),
    );
    providerCostUsd += row.providerCostUsd?.toNumber() ?? 0;
    marginUsd += row.marginUsd?.toNumber() ?? 0;
  }
  return {
    byCurrency: Array.from(byCurrency.entries()).map(([currency, amount]) => ({
      currency,
      amount: Number(amount.toFixed(6)),
    })),
    providerCostUsd: Number(providerCostUsd.toFixed(6)),
    marginUsd: Number(marginUsd.toFixed(6)),
  };
}

function canonicalModelCreateData(
  input: CreateCanonicalModelInput,
  adminId: string,
): Prisma.AiCanonicalModelCreateInput {
  return {
    slug: input.slug,
    displayName: input.displayName,
    modality: input.modality,
    family: input.family,
    generationModes: input.generationModes as Prisma.InputJsonValue,
    status: input.status,
    description: input.description ?? null,
    parameterPolicy: input.parameterPolicy as Prisma.InputJsonValue,
    outputPolicy: input.outputPolicy as Prisma.InputJsonValue,
    entitlementPolicy: input.entitlementPolicy as Prisma.InputJsonValue,
    billingPolicy: input.billingPolicy as Prisma.InputJsonValue,
    queuePolicy: input.queuePolicy as Prisma.InputJsonValue,
    uiPolicy: input.uiPolicy as Prisma.InputJsonValue,
    observabilityPolicy: input.observabilityPolicy as Prisma.InputJsonValue,
    metadata: input.metadata as Prisma.InputJsonValue,
    createdByAdminId: adminId,
    updatedByAdminId: adminId,
  };
}

function providerBindingDataFromEndpoint(
  endpoint: {
    id: string;
    providerAccountId: string;
    provider: string;
    endpointId: string;
    displayName: string | null;
    modality: string;
    supportedModes: unknown;
    providerInputSchema: unknown;
    providerOutputSchema: unknown;
    maxConcurrentRequests: number | null;
    maxRequestsPerMinute: number | null;
    requestTimeoutSeconds: number | null;
    cooldownSeconds: number | null;
    failureThreshold: number | null;
    catalogSnapshot: unknown;
  },
  input: CreateProviderBindingInput,
  adminId: string,
): Prisma.AiProviderModelBindingUncheckedCreateInput {
  return {
    providerAccountId: endpoint.providerAccountId,
    providerEndpointId: endpoint.id,
    canonicalModelId: input.canonicalModelId,
    provider: endpoint.provider,
    endpointId: endpoint.endpointId,
    displayName: endpoint.displayName,
    modality:
      endpoint.modality as Prisma.AiProviderModelBindingUncheckedCreateInput['modality'],
    status: input.status,
    priority: input.priority,
    weight: input.weight,
    supportedModes: endpoint.supportedModes as Prisma.InputJsonValue,
    inputSchema: endpoint.providerInputSchema as Prisma.InputJsonValue,
    outputSchema: endpoint.providerOutputSchema as Prisma.InputJsonValue,
    providerInputSchema: endpoint.providerInputSchema as Prisma.InputJsonValue,
    providerOutputSchema:
      endpoint.providerOutputSchema as Prisma.InputJsonValue,
    catalogSnapshot: endpoint.catalogSnapshot as Prisma.InputJsonValue,
    disabledReason: input.disabledReason ?? null,
    updatedByAdminId: adminId,
  };
}

function providerAccountInclude() {
  return {
    _count: {
      select: {
        bindings: true,
        endpoints: true,
      },
    },
  } satisfies Prisma.AiProviderAccountInclude;
}

function providerEndpointInclude() {
  return {
    providerAccount: true,
    _count: { select: { bindings: true } },
  } satisfies Prisma.AiProviderEndpointInclude;
}

function serializeProviderAccount(account: {
  id: string;
  provider: string;
  status: string;
  rateLimitPolicy: unknown;
  quotaPolicy: unknown;
  createdAt: Date;
  updatedAt: Date;
  _count?: { bindings: number; endpoints?: number };
}) {
  return {
    ...account,
    endpointCount: account._count?.endpoints ?? 0,
    bindingCount: account._count?.bindings ?? 0,
    _count: undefined,
  };
}

function serializeProviderEndpoint(endpoint: {
  id: string;
  providerAccountId: string;
  provider: string;
  endpointId: string;
  displayName: string | null;
  modality: string;
  status: string;
  healthStatus: string;
  supportedModes: unknown;
  providerInputSchema: unknown;
  providerOutputSchema: unknown;
  maxConcurrentRequests: number | null;
  maxRequestsPerMinute: number | null;
  requestTimeoutSeconds: number | null;
  cooldownSeconds: number | null;
  failureThreshold: number | null;
  catalogSnapshot: unknown;
  disabledReason: string | null;
  updatedAt: Date;
  providerAccount?: { id: string; provider: string };
  _count?: { bindings: number };
}) {
  return {
    ...endpoint,
    bindingCount: endpoint._count?.bindings ?? 0,
    _count: undefined,
  };
}

function serializeCanonicalModel(model: {
  id: string;
  slug: string;
  displayName: string;
  modality: string;
  family: string;
  generationModes: unknown;
  status: string;
  description: string | null;
  parameterPolicy: unknown;
  outputPolicy: unknown;
  entitlementPolicy: unknown;
  billingPolicy: unknown;
  queuePolicy: unknown;
  uiPolicy: unknown;
  observabilityPolicy: unknown;
  metadata: unknown;
  updatedAt: Date;
  _count?: { bindings: number; jobs: number };
  bindings?: Array<{ priority: number; status: string }>;
}) {
  const billingPolicy = recordValue(model.billingPolicy);
  const priceBand = summarizeProductPricing(billingPolicy?.productPricing);
  return {
    ...model,
    bindingCount: model._count?.bindings ?? 0,
    jobCount: model._count?.jobs ?? 0,
    priceBand,
    bindings: undefined,
    _count: undefined,
  };
}

type ProductPriceBand = {
  minPoints: number;
  maxPoints: number;
  defaultPoints: number;
  currency: string;
  pricingVersion: string;
  unit: 'per_output';
  minLabel: string | null;
  maxLabel: string | null;
  defaultLabel: string | null;
  referenceImageSurchargePoints: number | null;
  extraReferenceImagePoints: number | null;
  maskSurchargePoints: number | null;
};

function summarizeProductPricing(value: unknown): ProductPriceBand | null {
  const policy = recordValue(value) as unknown as AiProductPricingPolicy | null;
  if (!policy) return null;

  try {
    const defaultEstimate = estimateProductModelPoints({
      policy,
      numOutputs: 1,
    });
    const candidates = priceBandCandidates(policy);
    if (candidates.length === 0) return null;
    const min = candidates.reduce((best, item) =>
      item.points < best.points ? item : best,
    );
    const max = candidates.reduce((best, item) =>
      item.points > best.points ? item : best,
    );
    return {
      minPoints: min.points,
      maxPoints: max.points,
      defaultPoints: defaultEstimate.sellPoints,
      currency: policy.currency,
      pricingVersion: policy.version,
      unit: 'per_output',
      minLabel: min.label,
      maxLabel: max.label,
      defaultLabel: labelFromSelection(defaultEstimate.selection),
      referenceImageSurchargePoints: numberOrNull(
        policy.referenceImageSurchargePoints,
      ),
      extraReferenceImagePoints: numberOrNull(policy.extraReferenceImagePoints),
      maskSurchargePoints: numberOrNull(policy.maskSurchargePoints),
    };
  } catch {
    return null;
  }
}

function priceBandCandidates(policy: AiProductPricingPolicy) {
  if (policy.mode === 'fixed_per_output') {
    const estimate = estimateProductModelPoints({ policy, numOutputs: 1 });
    return [{ points: estimate.sellPoints, label: null as string | null }];
  }

  if (policy.mode === 'per_second_matrix') {
    // Band = cheapest resolution at minSeconds → priciest at maxSeconds.
    const candidates: Array<{ points: number; label: string | null }> = [];
    for (const resolution of Object.keys(policy.pointsPerSecond)) {
      for (const seconds of [policy.minSeconds, policy.maxSeconds]) {
        const estimate = estimateProductModelPoints({
          policy,
          numOutputs: 1,
          resolution,
          duration: seconds,
        });
        candidates.push({
          points: estimate.sellPoints,
          label: labelFromSelection(estimate.selection),
        });
      }
    }
    return candidates;
  }

  const candidates: Array<{ points: number; label: string | null }> = [];
  for (const [resolution, qualities] of Object.entries(policy.matrix)) {
    for (const quality of Object.keys(qualities)) {
      const estimate = estimateProductModelPoints({
        policy,
        numOutputs: 1,
        resolution,
        quality,
      });
      candidates.push({
        points: estimate.sellPoints,
        label: labelFromSelection(estimate.selection),
      });
    }
  }
  return candidates;
}

function labelFromSelection(selection: {
  resolution?: string;
  quality?: string;
  seconds?: number;
}): string | null {
  return (
    [
      selection.resolution,
      selection.quality,
      selection.seconds !== undefined ? `${selection.seconds}s` : undefined,
    ]
      .filter(Boolean)
      .join(' / ') || null
  );
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function serializeProviderBinding(binding: {
  id: string;
  providerEndpointId: string;
  provider: string;
  endpointId: string;
  displayName: string | null;
  modality: string;
  status: string;
  priority: number;
  weight: number;
  supportedModes: unknown;
  inputSchema: unknown;
  outputSchema: unknown;
  catalogSnapshot: unknown;
  disabledReason: string | null;
  updatedAt: Date;
  providerAccount?: { id: string; provider: string };
  providerEndpoint: {
    id: string;
    endpointId: string;
    status: string;
    healthStatus: string;
  };
  canonicalModel: {
    id: string;
    slug: string;
    displayName: string;
  };
  _count?: { jobs: number };
}) {
  return {
    ...binding,
    jobCount: binding._count?.jobs ?? 0,
    _count: undefined,
  };
}

function serializeJobSummary(job: {
  id: string;
  provider: string;
  modelId: string;
  providerJobId: string | null;
  status: string;
  stage: string;
  userId: string;
  createdAt: Date;
  completedAt: Date | null;
  canonicalModel: { id: string; slug: string; displayName: string } | null;
  providerBinding: { id: string; endpointId: string; status: string } | null;
}) {
  return job;
}

function serializeJobListItem(job: {
  id: string;
  provider: string;
  modelId: string;
  providerJobId: string | null;
  status: string;
  stage: string;
  userId: string;
  prompt: string;
  createdAt: Date;
  completedAt: Date | null;
  cost: unknown;
  metrics: unknown;
  error: unknown;
  canonicalModel: { id: string; slug: string; displayName: string } | null;
  providerBinding: { id: string; endpointId: string; status: string } | null;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    providerRequestId: string | null;
    providerStatus: number | null;
    runDurationMs: number | null;
    completedAt: Date | null;
  }>;
  outputs: Array<{
    id: string;
    type: string;
    url: string;
    outputIndex: number;
  }>;
  costLedger: Array<{
    amount: Prisma.Decimal;
    providerCostUsd: Prisma.Decimal | null;
    marginUsd: Prisma.Decimal | null;
    [key: string]: unknown;
  }>;
}) {
  return {
    ...job,
    prompt:
      job.prompt.length > 220 ? `${job.prompt.slice(0, 220)}...` : job.prompt,
    costLedger: serializeCostLedger(job.costLedger),
  };
}

function serializeJobDetail(job: {
  costLedger: Array<{
    amount: Prisma.Decimal;
    providerCostUsd: Prisma.Decimal | null;
    marginUsd: Prisma.Decimal | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}) {
  return {
    ...job,
    costLedger: serializeCostLedger(job.costLedger),
  };
}

function serializeMediaAsset(
  asset: {
    id: string;
    kind: string;
    storageProvider: string;
    bucket: string | null;
    region: string | null;
    objectKey: string | null;
    externalUrl: string | null;
    contentType: string;
    sizeBytes: bigint | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    checksumSha256: string | null;
    visibility: string;
    status: string;
    source: string;
    moderationStatus: string;
    moderationReason: string | null;
    moderatedByAdminId: string | null;
    moderatedAt: Date | null;
    workspaceId: string | null;
    createdByUserId: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
    aiJobOutputs: Array<{
      id: string;
      outputIndex: number;
      job: {
        id: string;
        prompt: string;
        provider: string;
        modelId: string;
        deployment: string;
        status: string;
        stage: string;
        userId: string;
        workspaceId: string | null;
        createdAt: Date;
        canonicalModel: {
          id: string;
          slug: string;
          displayName: string;
        } | null;
        providerBinding: {
          id: string;
          endpointId: string;
          provider: string;
        } | null;
      };
    }>;
  },
  assetUrls: MediaAssetUrlResolverService,
) {
  let resolvedUrl: string | null = null;
  try {
    resolvedUrl = assetUrls.resolve(asset);
  } catch {
    resolvedUrl = asset.externalUrl;
  }
  return {
    ...asset,
    url: resolvedUrl,
    sizeBytes: asset.sizeBytes?.toString() ?? null,
    aiJobOutputs: asset.aiJobOutputs.map((output) => ({
      id: output.id,
      outputIndex: output.outputIndex,
      job: {
        ...output.job,
        prompt:
          output.job.prompt.length > 220
            ? `${output.job.prompt.slice(0, 220)}...`
            : output.job.prompt,
      },
    })),
  };
}

function serializeCostLedger(
  entries: Array<{
    amount: Prisma.Decimal;
    providerCostUsd: Prisma.Decimal | null;
    marginUsd: Prisma.Decimal | null;
    [key: string]: unknown;
  }>,
) {
  return entries.map((entry) => ({
    ...entry,
    amount: entry.amount.toString(),
    providerCostUsd: entry.providerCostUsd?.toString() ?? null,
    marginUsd: entry.marginUsd?.toString() ?? null,
    provider: stringFromUnknown(metadataField(entry.metadata, 'provider')),
    endpointId: stringFromUnknown(metadataField(entry.metadata, 'endpointId')),
    providerRequestId: stringFromUnknown(
      metadataField(entry.metadata, 'requestId'),
    ),
    billableUnits: numberFromUnknown(
      metadataField(entry.metadata, 'billableUnits'),
    ),
    unitPrice: numberFromUnknown(metadataField(entry.metadata, 'unitPrice')),
    unit: stringFromUnknown(metadataField(entry.metadata, 'unit')),
  }));
}

function metadataField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return (value as Record<string, unknown>)[key];
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
