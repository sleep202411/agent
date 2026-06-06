import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiControlPlaneStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import type {
  CreateCanonicalModelInput,
  CreateProviderEndpointInput,
  CreateProviderBindingInput,
  ListAdminAiJobsQuery,
  ListAdminAiModelsQuery,
  ListAdminAiProviderBindingsQuery,
  ListAdminAiProviderEndpointsQuery,
  ListAdminAiProvidersQuery,
  UpdateAdminAiProviderInput,
  UpdateCanonicalModelInput,
  UpdateProviderEndpointInput,
  UpdateProviderBindingInput,
} from './ai-model-ops.dto';

@Injectable()
export class AiModelOpsService {
  constructor(private readonly prisma: PrismaService) {}

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
        ...(query.visibility ? { visibility: query.visibility } : {}),
      },
      orderBy: [{ modality: 'asc' }, { family: 'asc' }, { displayName: 'asc' }],
      take: query.limit,
      include: {
        _count: {
          select: { bindings: true, jobs: true },
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
      ...(input.visibility !== undefined
        ? { visibility: input.visibility }
        : {}),
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
        capabilities: input.capabilities as Prisma.InputJsonValue,
        providerInputSchema: input.providerInputSchema as Prisma.InputJsonValue,
        providerOutputSchema:
          input.providerOutputSchema as Prisma.InputJsonValue,
        providerPricing: input.providerPricing as Prisma.InputJsonValue,
        providerQuotaPolicy: input.providerQuotaPolicy as Prisma.InputJsonValue,
        catalogSnapshot: input.catalogSnapshot as Prisma.InputJsonValue,
        documentation: input.documentation as Prisma.InputJsonValue,
        schemaHash: hashJson({
          input: input.providerInputSchema,
          output: input.providerOutputSchema,
        }),
        pricingHash: hashJson(input.providerPricing),
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
      select: {
        id: true,
        providerInputSchema: true,
        providerOutputSchema: true,
        providerPricing: true,
      },
    });
    if (!existing) throw new NotFoundException('供应商端点不存在或已归档。');

    const nextInputSchema =
      input.providerInputSchema ?? existing.providerInputSchema;
    const nextOutputSchema =
      input.providerOutputSchema ?? existing.providerOutputSchema;
    const nextPricing = input.providerPricing ?? existing.providerPricing;

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
        ...(input.capabilities !== undefined
          ? { capabilities: input.capabilities as Prisma.InputJsonValue }
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
        ...(input.providerPricing !== undefined
          ? { providerPricing: input.providerPricing as Prisma.InputJsonValue }
          : {}),
        ...(input.providerQuotaPolicy !== undefined
          ? {
              providerQuotaPolicy:
                input.providerQuotaPolicy as Prisma.InputJsonValue,
            }
          : {}),
        ...(input.catalogSnapshot !== undefined
          ? { catalogSnapshot: input.catalogSnapshot as Prisma.InputJsonValue }
          : {}),
        ...(input.documentation !== undefined
          ? { documentation: input.documentation as Prisma.InputJsonValue }
          : {}),
        ...(input.disabledReason !== undefined
          ? { disabledReason: input.disabledReason ?? null }
          : {}),
        ...(input.providerInputSchema !== undefined ||
        input.providerOutputSchema !== undefined
          ? {
              schemaHash: hashJson({
                input: nextInputSchema,
                output: nextOutputSchema,
              }),
            }
          : {}),
        ...(input.providerPricing !== undefined
          ? { pricingHash: hashJson(nextPricing) }
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
        parameterMap:
          input.parameterMap !== undefined
            ? (input.parameterMap as Prisma.InputJsonValue)
            : undefined,
        pricingPolicy:
          input.pricingPolicy !== undefined
            ? (input.pricingPolicy as Prisma.InputJsonValue)
            : undefined,
        queuePolicy:
          input.queuePolicy !== undefined
            ? (input.queuePolicy as Prisma.InputJsonValue)
            : undefined,
        routingPolicy:
          input.routingPolicy !== undefined
            ? (input.routingPolicy as Prisma.InputJsonValue)
            : undefined,
        fallbackPolicy:
          input.fallbackPolicy !== undefined
            ? (input.fallbackPolicy as Prisma.InputJsonValue)
            : undefined,
        observabilityPolicy:
          input.observabilityPolicy !== undefined
            ? (input.observabilityPolicy as Prisma.InputJsonValue)
            : undefined,
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
        },
      },
    });
    return { items: items.map(serializeJobListItem) };
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
        outputs: { orderBy: { outputIndex: 'asc' } },
        costLedger: { orderBy: { createdAt: 'asc' } },
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
    visibility: input.visibility,
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
    providerPricing: unknown;
    catalogSnapshot: unknown;
    documentation: unknown;
    lastSyncedAt: Date | null;
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
    parameterMap: input.parameterMap as Prisma.InputJsonValue,
    providerPricing: endpoint.providerPricing as Prisma.InputJsonValue,
    pricingPolicy: input.pricingPolicy as Prisma.InputJsonValue,
    queuePolicy: input.queuePolicy as Prisma.InputJsonValue,
    routingPolicy: input.routingPolicy as Prisma.InputJsonValue,
    fallbackPolicy: input.fallbackPolicy as Prisma.InputJsonValue,
    observabilityPolicy: input.observabilityPolicy as Prisma.InputJsonValue,
    catalogSnapshot: endpoint.catalogSnapshot as Prisma.InputJsonValue,
    documentation: endpoint.documentation as Prisma.InputJsonValue,
    disabledReason: input.disabledReason ?? null,
    lastSyncedAt: endpoint.lastSyncedAt,
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
  capabilities: unknown;
  providerInputSchema: unknown;
  providerOutputSchema: unknown;
  providerPricing: unknown;
  providerQuotaPolicy: unknown;
  catalogSnapshot: unknown;
  documentation: unknown;
  schemaHash: string | null;
  pricingHash: string | null;
  disabledReason: string | null;
  lastSyncedAt: Date | null;
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
  visibility: string;
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
}) {
  return {
    ...model,
    bindingCount: model._count?.bindings ?? 0,
    jobCount: model._count?.jobs ?? 0,
    _count: undefined,
  };
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
  parameterMap: unknown;
  pricingPolicy: unknown;
  providerPricing: unknown;
  queuePolicy: unknown;
  routingPolicy: unknown;
  fallbackPolicy: unknown;
  observabilityPolicy: unknown;
  catalogSnapshot: unknown;
  documentation: unknown;
  disabledReason: string | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
  providerAccount?: { id: string; provider: string };
  providerEndpoint: {
    id: string;
    endpointId: string;
    status: string;
    healthStatus: string;
    schemaHash: string | null;
    pricingHash: string | null;
  };
  canonicalModel: { id: string; slug: string; displayName: string };
  _count?: { jobs: number };
}) {
  return {
    ...binding,
    jobCount: binding._count?.jobs ?? 0,
    _count: undefined,
  };
}

function hashJson(value: unknown): string {
  return createHash('sha256')
    .update(stableJson(value))
    .digest('hex')
    .slice(0, 40);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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
}) {
  return {
    ...job,
    prompt:
      job.prompt.length > 220 ? `${job.prompt.slice(0, 220)}...` : job.prompt,
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
    costLedger: job.costLedger.map((entry) => ({
      ...entry,
      amount: entry.amount.toString(),
      providerCostUsd: entry.providerCostUsd?.toString() ?? null,
      marginUsd: entry.marginUsd?.toString() ?? null,
    })),
  };
}
