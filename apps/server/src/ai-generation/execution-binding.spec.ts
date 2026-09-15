import { FalCatalogService } from './providers/fal/fal-catalog.service';
import { BailianCatalogService } from './providers/bailian/bailian-catalog.service';
import { FalProviderAdapter } from './providers/fal/fal-provider.adapter';
import { BailianProviderAdapter } from './providers/bailian/bailian-provider.adapter';
import type { AiExecutionBindingIdentity } from './types';
const row = (
  endpointId: string,
  modality: string,
  priority: number,
  slug = 'fixture-model',
) => ({
  id: `binding-${priority}-${endpointId}`,
  providerAccountId: 'account',
  providerEndpointId: `endpoint-${endpointId}`,
  canonicalModelId: slug,
  endpointId,
  modality,
  priority,
  weight: 1,
  status: 'active',
  archivedAt: null,
  supportedModes: [
    modality === 'audio'
      ? 'text_to_speech'
      : modality === 'video'
        ? 'text_to_video'
        : 'text_to_image',
  ],
  catalogSnapshot: {},
  billingPolicy: {},
  canonicalModel: {
    id: slug,
    slug,
    displayName: slug,
    description: 'Fixture',
    status: 'active',
    archivedAt: null,
    queuePolicy: { globalConcurrency: 12 },
    entitlementPolicy: {},
    parameterPolicy: {},
    outputPolicy: {},
    billingPolicy: {
      mode: 'free',
      productPricing: {
        kind: 'matrix',
        dimensions: ['resolution'],
        tiers: [{ match: { resolution: '720p' }, cost: 1 }],
      },
    },
  },
  providerAccount: { id: 'account', status: 'active', archivedAt: null },
  providerEndpoint: {
    id: `endpoint-${endpointId}`,
    status: 'active',
    archivedAt: null,
    maxConcurrentRequests: priority === 10 ? 2 : 4,
    maxRequestsPerMinute: null,
    requestTimeoutSeconds: null,
    cooldownSeconds: null,
    failureThreshold: null,
    catalogSnapshot: {},
  },
});
const config = {
  config: {
    enabled: true,
    apiKey: 'fixture-only',
    catalogRefreshMs: 10000,
    pollDelayMs: 1000,
    imageLocation: 'global',
    videoLocation: 'fixture',
  },
};

describe.each([
  ['fal', FalCatalogService, FalProviderAdapter],
  ['bailian', BailianCatalogService, BailianProviderAdapter],
] as const)('%s queued binding fence', (_name, Catalog, Adapter) => {
  async function setup() {
    const record = row('fixture-video', 'video', 10);
    const catalog = new Catalog(
      config as never,
      {
        aiProviderModelBinding: {
          findMany: jest.fn().mockResolvedValue([record]),
        },
      } as never,
    );
    const submit = jest.fn().mockResolvedValue({
      request_id: 'request-1',
      output: { task_id: 'request-1' },
    });
    const adapter = new Adapter(
      config as never,
      catalog as never,
      { submit } as never,
    );
    const binding = await adapter.resolveExecutionBinding('fixture-model', {
      prompt: 'A scene',
    });
    if (!binding) throw new Error('Fixture binding missing');
    const expected: AiExecutionBindingIdentity = {
      deployment: binding.deployment,
      canonicalModelId: binding.ops.canonicalModelId,
      providerAccountId: binding.ops.providerAccountId,
      providerBindingId: binding.ops.providerBindingId,
      providerEndpointId: binding.ops.providerEndpointId,
    };
    return { adapter, catalog, submit, binding, expected };
  }
  it.each([
    'deployment',
    'canonicalModelId',
    'providerAccountId',
    'providerBindingId',
    'providerEndpointId',
    'missing',
  ] as const)(
    'rejects a changed %s before provider submission',
    async (field) => {
      const { adapter, catalog, submit, binding, expected } = await setup();
      const actual = structuredClone(binding);
      if (field === 'deployment') actual.deployment = 'replacement';
      else if (field !== 'missing') actual.ops[field] = 'replacement';
      jest
        .spyOn(catalog, 'getExecutionBinding')
        .mockResolvedValue(field === 'missing' ? null : actual);
      await expect(
        adapter.startGeneration(
          'fixture-model',
          { prompt: 'A scene' },
          { jobId: 'job', userId: 'user', expectedExecutionBinding: expected },
        ),
      ).rejects.toMatchObject({
        payload: { code: 'VALIDATION_ERROR', retryable: false },
      });
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it('submits the matching binding and preserves old jobs without frozen identities', async () => {
    const { adapter, catalog, submit, expected } = await setup();
    await expect(
      adapter.startGeneration(
        'fixture-model',
        { prompt: 'A scene' },
        { jobId: 'job', userId: 'user', expectedExecutionBinding: expected },
      ),
    ).resolves.toMatchObject({ kind: 'pending' });
    const lookup = jest
      .spyOn(catalog, 'getExecutionBinding')
      .mockResolvedValue(null);
    await expect(
      adapter.startGeneration(
        'fixture-model',
        { prompt: 'A scene' },
        { jobId: 'old-job', userId: 'user' },
      ),
    ).resolves.toMatchObject({ kind: 'pending' });
    expect(lookup).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
