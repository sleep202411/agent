import { planSingleModelSeed } from '../../prisma/seed/ai-catalog/seed-catalog';
import {
  ENTITLEMENT_POLICY_VERSION,
  EntitlementService,
  type EntitlementSnapshot,
} from '../entitlements';
import { AiGenerationRoutingService } from './routing.service';
import type { AiBillingPolicy, AiModelDefinition } from './types';

const NOW = '2026-06-12T12:00:00.000Z';

const freeBillingPolicy: AiBillingPolicy = {
  mode: 'free',
  unit: 'output',
  displayCurrency: 'COMPUTE_POINTS',
  finalCostSource: 'campaign',
  refundPolicy: 'no_refund',
};

function entitlement(
  overrides: Partial<EntitlementSnapshot> = {},
): EntitlementSnapshot {
  return {
    version: ENTITLEMENT_POLICY_VERSION,
    subject: { type: 'user', id: 'user-1' },
    planKey: 'team',
    rank: 40,
    source: 'billing_membership_plan',
    status: 'active',
    effectiveAt: NOW,
    limits: {
      queuePriority: 2,
      imageDaily: Number.POSITIVE_INFINITY,
      videoDaily: Number.POSITIVE_INFINITY,
      chatDaily: Number.POSITIVE_INFINITY,
      workflowDaily: Number.POSITIVE_INFINITY,
      uploadMB: 30_720,
      chatPerMinute: 80,
      concurrentJobs: 5,
      queuedJobs: 16,
    },
    ...overrides,
  };
}

function model(overrides: Partial<AiModelDefinition> = {}): AiModelDefinition {
  return {
    id: 'image-model',
    provider: 'test-provider',
    deployment: 'test/deployment',
    modelName: 'test',
    source: 'test',
    family: 'image',
    generationModes: ['text_to_image'],
    type: 'image',
    name: 'Image Model',
    description: 'Test model',
    enabled: true,
    schemaDialect: 'json-schema',
    schemaVersion: '2026-06-12',
    documentation: [],
    capability_matrix: {},
    availability: {},
    cost_estimate: {},
    observability: {},
    capabilities: { maxOutputs: 1 },
    input_schema: { type: 'object', properties: {} },
    output_schema: { type: 'object', properties: {} },
    ui_schema: {},
    queue: {
      queueName: 'ai-image-generation',
      globalConcurrency: 4,
      perUserRunning: 2,
      perUserQueued: 10,
    },
    entitlement: { requiredPlan: null },
    entitlement_policy: { requiredPlan: null },
    billing_policy: freeBillingPolicy,
    queue_policy: {
      queueName: 'ai-image-generation',
      globalConcurrency: 4,
      perUserRunning: 2,
      perUserQueued: 10,
      priority: 0,
    },
    ...overrides,
  } as unknown as AiModelDefinition;
}

function routingFor(testModel: AiModelDefinition) {
  const adapter = {
    provider: 'test-provider',
    getModel: jest.fn().mockResolvedValue(testModel),
  };
  const providers = {
    list: jest.fn(() => [adapter]),
  };
  const presets = {
    findConfiguredPreset: jest.fn(),
    findPresetRoute: jest.fn(),
    queuePolicyFor: jest.fn(() => testModel.queue_policy),
    queueNameFor: jest.fn((queueName: string) => queueName),
    billingPolicyFor: jest.fn(() => testModel.billing_policy),
    presetId: jest.fn(),
    listCampaigns: jest.fn(() => []),
  };
  const service = new AiGenerationRoutingService(
    providers as never,
    presets as never,
    new EntitlementService({} as never),
    { listModels: jest.fn() } as never,
  );
  return { service, adapter };
}

describe('AiGenerationRoutingService concurrency policy', () => {
  it('freezes membership queue and concurrency limits into the routing snapshot', async () => {
    const { service } = routingFor(model());

    const decision = await service.resolve({
      entitlement: entitlement({
        subject: { type: 'workspace', id: 'workspace-1' },
        limits: {
          ...entitlement().limits,
          queuePriority: 2,
          concurrentJobs: 16,
          queuedJobs: 64,
        },
      }),
      body: { modelId: 'image-model' },
      now: NOW,
    });

    expect(decision.snapshot.policy.entitlement.queuePriority).toBe(2);
    expect(decision.snapshot.policy.concurrency).toMatchObject({
      subject: { type: 'workspace', id: 'workspace-1' },
      queueName: 'ai-image-generation',
      globalConcurrency: 4,
      perSubjectRunning: 16,
      perSubjectQueued: 64,
      perTypeRunning: 2,
      perUserRunning: 2,
      perUserQueued: 64,
    });
  });

  it('preserves unlimited enterprise subject caps while keeping model type caps', async () => {
    const { service } = routingFor(
      model({
        queue: {
          queueName: 'ai-image-generation',
          globalConcurrency: 4,
          perUserRunning: 3,
          perUserQueued: 10,
        },
        queue_policy: {
          queueName: 'ai-image-generation',
          globalConcurrency: 4,
          perUserRunning: 3,
          perUserQueued: 10,
          priority: 0,
        },
      } as Partial<AiModelDefinition>),
    );

    const decision = await service.resolve({
      entitlement: entitlement({
        planKey: 'team',
        limits: {
          ...entitlement().limits,
          queuePriority: 1,
          concurrentJobs: null,
          queuedJobs: null,
        },
      }),
      body: { modelId: 'image-model' },
      now: NOW,
    });

    expect(decision.snapshot.policy.concurrency.perSubjectRunning).toBeNull();
    expect(decision.snapshot.policy.concurrency.perSubjectQueued).toBeNull();
    expect(decision.snapshot.policy.concurrency.perTypeRunning).toBe(3);
    expect(decision.snapshot.policy.concurrency.perUserRunning).toBe(3);
    expect(decision.snapshot.policy.concurrency.perUserQueued).toBe(10);
  });
});

describe('H3 Max reference pricing at admission', () => {
  function quote(input: Record<string, unknown>) {
    const plan = planSingleModelSeed('minimax-h3-max');
    const { service } = routingFor(
      model({
        billing_policy: plan.canonical
          .billingPolicy as unknown as AiBillingPolicy,
        input_schema: {
          type: 'object',
          properties: {
            resolution: { type: 'string' },
            startFrame: { type: 'object', properties: {} },
            endFrame: { type: 'object', properties: {} },
            referenceImages: {
              type: 'array',
              items: { type: 'object', properties: {} },
            },
            referenceVideos: {
              type: 'array',
              items: { type: 'object', properties: {} },
            },
            referenceAudios: {
              type: 'array',
              items: { type: 'object', properties: {} },
            },
          },
        },
      }),
    );
    return service.resolve({
      entitlement: entitlement(),
      body: { modelId: 'image-model', input },
      now: NOW,
    });
  }
  const image = {
    assetId: 'image-1',
    url: 'https://cdn.example.com/image.png',
    referenceBillingFacts: { width: 2048, height: 2048 },
  };
  it('counts bindings before prompt compilation and deduplicates their input-array copies', async () => {
    const result = await quote({
      duration: '5',
      resolution: '768P',
      referenceBindings: [{ ...image, kind: 'image' }],
      referenceImages: [image],
      referenceVideos: [
        { assetId: 'video-1', referenceBillingFacts: { durationSeconds: 5 } },
      ],
    });
    expect(result.snapshot.policy.quota.cost).toBe(135);
  });
  it('ignores keyframes in the reference-token meter', async () => {
    const result = await quote({
      duration: '5',
      startFrame: image,
      endFrame: image,
    });
    expect(result.snapshot.policy.quota.cost).toBe(60);
  });
  it('rejects unverified media instead of quoting below the provider cost', async () => {
    await expect(
      quote({
        duration: '5',
        referenceImages: [
          { ...image, width: 1, height: 1, referenceBillingFacts: null },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'MODEL_PRICING_INVALID' } });
  });
});
