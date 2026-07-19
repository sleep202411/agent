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
    planKey: 'studio',
    rank: 40,
    quotaTier: 'VIP3',
    source: 'billing_membership_plan',
    status: 'active',
    effectiveAt: NOW,
    features: {
      aiGeneration: true,
      advancedModelAccess: true,
      advancedParameters: true,
      teamSharedCredits: false,
    },
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
    billingPolicyFor: jest.fn(() => freeBillingPolicy),
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
        planKey: 'enterprise',
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
