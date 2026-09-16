import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiControlPlaneStatus, MediaAssetSource, Prisma } from '@prisma/client';
import {
  estimateProductModelPoints,
  type AiProductPricingPolicy,
} from '@repo/shared';
import { PrismaService } from '../../infra/db/db.module';
import { MediaModerationAdminService } from '../../media/media-moderation-admin.service';
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

const UNARCHIVED_BINDING_WHERE = {
  archivedAt: null,
  status: { not: AiControlPlaneStatus.archived },
} satisfies Prisma.AiProviderModelBindingWhereInput;

const ADMIN_MEDIA_ASSET_INCLUDE = {
  placements: {
    where: { deletedAt: null },
    orderBy: [{ role: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
  },
  variants: {
    where: { deletedAt: null },
    orderBy: [{ kind: 'asc' }, { variantKey: 'asc' }],
    include: {
      placements: {
        where: { deletedAt: null },
        orderBy: [{ role: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  },
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
} satisfies Prisma.MediaAssetInclude;

@Injectable()
export class AiModelOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaModeration: MediaModerationAdminService,
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai_provider_accounts WHERE id=${providerAccountId}::uuid FOR UPDATE`;
      const existing = await tx.aiProviderAccount.findFirst({
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

      const account = await tx.aiProviderAccount.update({
        where: { id: providerAccountId },
        data,
        include: providerAccountInclude(),
      });
      return serializeProviderAccount(account);
    });
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai_canonical_models WHERE id=${modelId}::uuid FOR UPDATE`;
      if (
        !(await tx.aiCanonicalModel.findFirst({
          where: { id: modelId, archivedAt: null },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Canonical model not found or archived.');
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
              entitlementPolicy:
                input.entitlementPolicy as Prisma.InputJsonValue,
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
      const model = await tx.aiCanonicalModel.update({
        where: { id: modelId },
        data,
        include: {
          _count: {
            select: { bindings: true, jobs: true },
          },
        },
      });
      return serializeCanonicalModel(model);
    });
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai_provider_accounts WHERE id=${input.providerAccountId}::uuid FOR UPDATE`;
      const providerAccount = await tx.aiProviderAccount.findFirst({
        where: { id: input.providerAccountId, archivedAt: null },
        select: { id: true, provider: true },
      });
      if (!providerAccount) {
        throw new NotFoundException('供应商账号不存在或已归档。');
      }

      const duplicate = await tx.aiProviderEndpoint.findFirst({
        where: {
          providerAccountId: input.providerAccountId,
          endpointId: input.endpointId,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException(`供应商端点已存在：${input.endpointId}`);
      }

      const endpoint = await tx.aiProviderEndpoint.create({
        data: {
          providerAccountId: providerAccount.id,
          provider: providerAccount.provider,
          endpointId: input.endpointId,
          displayName: input.displayName ?? null,
          modality: input.modality,
          status: input.status,
          healthStatus: input.healthStatus,
          supportedModes: input.supportedModes as Prisma.InputJsonValue,
          providerInputSchema:
            input.providerInputSchema as Prisma.InputJsonValue,
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
    });
  }

  async updateProviderEndpoint(
    endpointId: string,
    adminId: string,
    input: UpdateProviderEndpointInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai_provider_endpoints WHERE id=${endpointId}::uuid FOR UPDATE`;
      const existing = await tx.aiProviderEndpoint.findFirst({
        where: { id: endpointId, archivedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('供应商端点不存在或已归档。');

      const endpoint = await tx.aiProviderEndpoint.update({
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
            ? {
                catalogSnapshot: input.catalogSnapshot as Prisma.InputJsonValue,
              }
            : {}),
          ...(input.disabledReason !== undefined
            ? { disabledReason: input.disabledReason ?? null }
            : {}),
          updatedByAdminId: adminId,
        },
        include: providerEndpointInclude(),
      });
      return serializeProviderEndpoint(endpoint);
    });
  }

  async archiveProviderEndpoint(endpointId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai_provider_endpoints WHERE id=${endpointId}::uuid FOR UPDATE`;
      const endpoint = await tx.aiProviderEndpoint.findFirst({
        where: { id: endpointId, archivedAt: null },
        include: {
          _count: { select: { bindings: { where: UNARCHIVED_BINDING_WHERE } } },
        },
      });
      if (!endpoint) throw new NotFoundException('供应商端点不存在或已归档。');
      if (endpoint._count.bindings > 0) {
        throw new BadRequestException(
          '该端点仍存在 Provider 绑定，请先归档绑定后再删除端点。',
        );
      }

      const archived = await tx.aiProviderEndpoint.update({
        where: { id: endpointId },
        data: {
          status: AiControlPlaneStatus.archived,
          archivedAt: new Date(),
          updatedByAdminId: adminId,
        },
        include: providerEndpointInclude(),
      });
      return serializeProviderEndpoint(archived);
    });
  }

  async createProviderBinding(
    adminId: string,
    input: CreateProviderBindingInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT a.id FROM ai_provider_accounts a JOIN ai_provider_endpoints e ON e.provider_account_id=a.id WHERE e.id=${input.providerEndpointId}::uuid FOR SHARE OF a`;
      await tx.$queryRaw`SELECT id FROM ai_provider_endpoints WHERE id=${input.providerEndpointId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM ai_canonical_models WHERE id=${input.canonicalModelId}::uuid FOR SHARE`;
      const [endpoint, canonicalModel] = [
        await tx.aiProviderEndpoint.findUniqueOrThrow({
          where: { id: input.providerEndpointId },
          include: { providerAccount: true },
        }),
        await tx.aiCanonicalModel.findUniqueOrThrow({
          where: { id: input.canonicalModelId },
          select: { id: true, modality: true, archivedAt: true },
        }),
      ];
      if (
        endpoint.archivedAt ||
        endpoint.status === AiControlPlaneStatus.archived ||
        endpoint.providerAccount.archivedAt
      )
        throw new BadRequestException(
          'Cannot bind an archived provider endpoint or account.',
        );
      if (canonicalModel.archivedAt) {
        throw new BadRequestException(
          'Cannot bind an archived canonical model.',
        );
      }
      if (canonicalModel.modality !== endpoint.modality) {
        throw new BadRequestException(
          `Canonical model modality ${canonicalModel.modality} does not match endpoint modality ${endpoint.modality}.`,
        );
      }
      const existing = await tx.aiProviderModelBinding.findFirst({
        where: {
          providerAccountId: endpoint.providerAccountId,
          endpointId: endpoint.endpointId,
        },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(
          'This provider endpoint already has a binding. Edit or restore its existing route; historical bindings cannot be replaced.',
        );
      }
      const data = providerBindingDataFromEndpoint(endpoint, input, adminId);
      const binding = await tx.aiProviderModelBinding.create({
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
    });
  }

  async updateProviderBinding(
    bindingId: string,
    adminId: string,
    input: UpdateProviderBindingInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.aiProviderModelBinding.findUnique({
        where: { id: bindingId },
        select: {
          providerEndpointId: true,
          canonicalModelId: true,
          providerAccountId: true,
        },
      });
      if (!target)
        throw new NotFoundException('Provider binding not found or archived.');
      await tx.$queryRaw`SELECT id FROM ai_provider_accounts WHERE id=${target.providerAccountId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM ai_provider_endpoints WHERE id=${target.providerEndpointId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM ai_canonical_models WHERE id=${target.canonicalModelId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM ai_provider_model_bindings WHERE id=${bindingId}::uuid FOR UPDATE`;
      const current = await tx.aiProviderModelBinding.findFirst({
        where: { id: bindingId, archivedAt: null },
        include: {
          providerAccount: true,
          providerEndpoint: true,
          canonicalModel: true,
        },
      });
      if (!current)
        throw new NotFoundException('Provider binding not found or archived.');
      if (
        (input.status ?? current.status) !== AiControlPlaneStatus.archived &&
        (current.providerAccount.archivedAt ||
          current.providerAccount.status === AiControlPlaneStatus.archived ||
          current.providerEndpoint.archivedAt ||
          current.providerEndpoint.status === AiControlPlaneStatus.archived ||
          current.canonicalModel.archivedAt ||
          current.canonicalModel.status === AiControlPlaneStatus.archived)
      )
        throw new BadRequestException(
          'Cannot restore or edit a route whose provider, endpoint or model is archived.',
        );
      const binding = await tx.aiProviderModelBinding.update({
        where: { id: bindingId },
        data: {
          status: input.status,
          priority: input.priority,
          weight: input.weight,
          disabledReason:
            input.disabledReason !== undefined
              ? input.disabledReason
              : undefined,
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
    });
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
          select: {
            id: true,
            type: true,
            url: true,
            outputIndex: true,
            assetId: true,
          },
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
      include: ADMIN_MEDIA_ASSET_INCLUDE,
    });
    return {
      items: items.map((asset) => serializeMediaAsset(asset)),
    };
  }

  async updateAssetModeration(
    assetId: string,
    adminId: string,
    input: UpdateAdminAiMediaAssetModerationInput,
  ) {
    await this.mediaModeration.updateAssetModeration(assetId, adminId, input);
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: ADMIN_MEDIA_ASSET_INCLUDE,
    });
    if (!asset) throw new NotFoundException('资产不存在或已删除。');
    return serializeMediaAsset(asset);
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
    _count: { select: { bindings: { where: UNARCHIVED_BINDING_WHERE } } },
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
  unit: 'per_output' | 'per_character';
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
      unit: policy.mode === 'per_character' ? 'per_character' : 'per_output',
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
        for (const generateAudio of policy.videoOnlyPointsPerSecond
          ? [true, false]
          : [undefined]) {
          const estimate = estimateProductModelPoints({
            policy,
            numOutputs: 1,
            resolution,
            duration: seconds,
            generateAudio,
          });
          candidates.push({
            points: estimate.sellPoints,
            label: labelFromSelection(estimate.selection),
          });
        }
      }
    }
    return candidates;
  }

  if (policy.mode === 'per_character') {
    return [policy.minCharacters, policy.maxCharacters].map((characters) => {
      const estimate = estimateProductModelPoints({
        policy,
        numOutputs: 1,
        text: 'x'.repeat(characters),
      });
      return {
        points: estimate.sellPoints,
        label: labelFromSelection(estimate.selection),
      };
    });
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
  characters?: number;
}): string | null {
  return (
    [
      selection.resolution,
      selection.quality,
      selection.seconds !== undefined ? `${selection.seconds}s` : undefined,
      selection.characters !== undefined
        ? `${selection.characters} characters`
        : undefined,
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
    assetId: string | null;
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
    outputs: job.outputs.map(serializeJobOutput),
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
    outputs: Array.isArray(job.outputs)
      ? job.outputs.map((output) => serializeJobOutput(output))
      : job.outputs,
    costLedger: serializeCostLedger(job.costLedger),
  };
}

function serializeJobOutput(output: unknown) {
  if (!output || typeof output !== 'object') return output;
  const row = output as { assetId?: unknown; url?: unknown };
  return {
    ...row,
    url: typeof row.assetId === 'string' ? null : row.url,
  };
}

function serializeMediaAsset(asset: {
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
  placements: Array<{
    id: string;
    role: string;
    status: string;
    storageProvider: string;
    bucket: string | null;
    region: string | null;
    objectKey: string | null;
    externalUrl: string | null;
    publicBaseUrl: string | null;
    cdnProvider: string | null;
    cdnCacheKey: string | null;
    priority: number;
    metadata: unknown;
    lastVerifiedAt: Date | null;
    purgedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }>;
  variants: Array<{
    id: string;
    variantKey: string;
    kind: string;
    status: string;
    contentType: string;
    sizeBytes: bigint | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    checksumSha256: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    placements: Array<{
      id: string;
      role: string;
      status: string;
      storageProvider: string;
      bucket: string | null;
      region: string | null;
      objectKey: string | null;
      externalUrl: string | null;
      publicBaseUrl: string | null;
      cdnProvider: string | null;
      cdnCacheKey: string | null;
      priority: number;
      metadata: unknown;
      lastVerifiedAt: Date | null;
      purgedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }>;
  }>;
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
}) {
  return {
    ...asset,
    url: null,
    sizeBytes: asset.sizeBytes?.toString() ?? null,
    placements: asset.placements.map((placement) =>
      serializePlacement(placement),
    ),
    variants: asset.variants.map((variant) => ({
      ...variant,
      url: null,
      sizeBytes: variant.sizeBytes?.toString() ?? null,
      placements: variant.placements.map((placement) =>
        serializePlacement(placement),
      ),
    })),
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

function serializePlacement(placement: {
  sizeBytes?: never;
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  publicBaseUrl: string | null;
  [key: string]: unknown;
}) {
  return {
    ...placement,
    url: null,
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
