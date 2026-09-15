import { FalProviderAdapter } from './providers/fal/fal-provider.adapter';
import { BailianProviderAdapter } from './providers/bailian/bailian-provider.adapter';
import { FalCatalogService } from './providers/fal/fal-catalog.service';
import { BailianCatalogService } from './providers/bailian/bailian-catalog.service';
import { AgnesCatalogService } from './providers/agnes/agnes-catalog.service';
import { BytePlusCatalogService } from './providers/byteplus/byteplus-catalog.service';
import { BytePlusSpeechCatalogService } from './providers/byteplus-speech/byteplus-speech-catalog.service';
import { GoogleVertexCatalogService } from './providers/google-vertex/google-vertex-catalog.service';
import { MiniMaxCatalogService } from './providers/minimax/minimax-catalog.service';
const catalogs = [
  ['fal', FalCatalogService, 'image', 'fal-ai/flux/dev', 'fal-ai/flux/schnell'],
  ['bailian', BailianCatalogService, 'image', 'wan2.6-image', 'qwen-image'],
  ['agnes', AgnesCatalogService, 'image', 'fixture-image', 'other-image'],
  ['byteplus', BytePlusCatalogService, 'image', 'fixture-image', 'other-image'],
  [
    'byteplus-speech',
    BytePlusSpeechCatalogService,
    'audio',
    'seed-tts-2.0',
    'seed-audio-1.0',
  ],
  [
    'google-vertex',
    GoogleVertexCatalogService,
    'image',
    'gemini-fixture-image',
    'gemini-other-image',
  ],
  ['minimax', MiniMaxCatalogService, 'video', 'MiniMax-H3', 'MiniMax-fixture'],
] as const;
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

describe.each(catalogs)(
  '%s control-plane admission',
  (_name, Catalog, kind, primary, secondary) => {
    it.each(['disabled', 'draft', 'degraded', 'archived'])(
      'excludes %s endpoints from new work but retains recovery',
      async (status) => {
        const disabled = row(primary, kind, 10);
        disabled.providerEndpoint.status = status;
        const active = row(secondary, kind, 20);
        const catalog = new Catalog(
          config as never,
          {
            aiProviderModelBinding: {
              findMany: jest.fn().mockResolvedValue([disabled, active]),
            },
          } as never,
        );
        expect(
          (await catalog.listModels()).map((model) => model.deployment),
        ).toEqual([secondary]);
        expect(
          (
            await catalog.getRuntimeConfig('fixture-model', {
              forSubmission: true,
            })
          )?.endpointId,
        ).toBe(secondary);
        expect(
          await catalog.getRuntimeConfig(primary, { forSubmission: true }),
        ).toBeNull();
        expect((await catalog.getRuntimeConfig(primary))?.endpointId).toBe(
          primary,
        );
      },
    );
    it.each(['canonical', 'endpoint'])(
      'rejects archived %s while retaining accepted-job lookup',
      async (target) => {
        const record = row(primary, kind, 10);
        const parent =
          target === 'canonical'
            ? record.canonicalModel
            : record.providerEndpoint;
        Object.assign(parent, { archivedAt: new Date() });
        const catalog = new Catalog(
          config as never,
          {
            aiProviderModelBinding: {
              findMany: jest.fn().mockResolvedValue([record]),
            },
          } as never,
        );
        expect(await catalog.listModels()).toEqual([]);
        expect(await catalog.getModel('fixture-model')).toBeNull();
        expect(
          await catalog.getRuntimeConfig('fixture-model', {
            forSubmission: true,
          }),
        ).toBeNull();
        expect((await catalog.getRuntimeConfig(primary))?.endpointId).toBe(
          primary,
        );
      },
    );
  },
);
it.each([FalCatalogService, BailianCatalogService])(
  'does not advertise or route a disabled sibling mode',
  async (Catalog) => {
    const disabled = row('disabled-image-to-video', 'video', 10);
    disabled.providerEndpoint.status = 'disabled';
    disabled.supportedModes = ['image_to_video'];
    const active = row('active-text-to-video', 'video', 20);
    const catalog = new Catalog(
      config as never,
      {
        aiProviderModelBinding: {
          findMany: jest.fn().mockResolvedValue([disabled, active]),
        },
      } as never,
    );
    const runtime = await catalog.getRuntimeConfig('fixture-model', {
      forSubmission: true,
    });
    expect(runtime?.modeEndpoints).toEqual({
      text_to_video: 'active-text-to-video',
    });
    expect(
      (await catalog.getRuntimeConfig(disabled.endpointId))?.endpointId,
    ).toBe(disabled.endpointId);
  },
);

it('rejects a disabled image sibling instead of synthesizing its legacy edit endpoint', async () => {
  const disabled = row('openai/gpt-image-2/edit', 'image', 10);
  disabled.providerEndpoint.status = 'disabled';
  disabled.supportedModes = ['image_to_image'];
  const active = row('openai/gpt-image-2', 'image', 20);
  const catalog = new FalCatalogService(
    config as never,
    {
      aiProviderModelBinding: {
        findMany: jest.fn().mockResolvedValue([disabled, active]),
      },
    } as never,
  );
  const submit = jest.fn();
  const adapter = new FalProviderAdapter(config as never, catalog, {
    submit,
  } as never);
  const runtime = await catalog.getRuntimeConfig('fixture-model', {
    forSubmission: true,
  });
  expect(() =>
    adapter['resolveSubmitEndpoint'](runtime!, {
      image_urls: ['https://example.com/image.png'],
    }),
  ).toThrow(/does not support image_to_image/);
  expect(submit).not.toHaveBeenCalled();
});

it('rejects a disabled Bailian video mode instead of falling back to the text endpoint', async () => {
  const disabled = row('wan2.6-i2v', 'video', 10);
  disabled.providerEndpoint.status = 'disabled';
  disabled.supportedModes = ['image_to_video'];
  const active = row('wan2.6-t2v', 'video', 20);
  const catalog = new BailianCatalogService(
    config as never,
    {
      aiProviderModelBinding: {
        findMany: jest.fn().mockResolvedValue([disabled, active]),
      },
    } as never,
  );
  const submit = jest.fn();
  const adapter = new BailianProviderAdapter(config as never, catalog, {
    submit,
  } as never);
  await expect(
    adapter.startGeneration(
      'fixture-model',
      {
        prompt: 'Animate',
        startFrame: { url: 'https://example.com/image.png' },
      },
      {} as never,
    ),
  ).rejects.toThrow(/does not support image_to_video/);
  expect(submit).not.toHaveBeenCalled();
});

it.each([FalCatalogService, BailianCatalogService])(
  'attributes explicit secondary bindings and capacity tiers within their canonical',
  async (Catalog) => {
    const primary = row('primary-video', 'video', 10);
    const secondary = row('secondary-video', 'video', 20);
    secondary.supportedModes = ['image_to_video'];
    secondary.providerEndpoint.catalogSnapshot = {
      capacityTiers: { resolution: { '4k': { maxConcurrentRequests: 1 } } },
    };
    const other = row('other-video', 'video', 30, 'other-canonical');
    const catalog = new Catalog(
      config as never,
      {
        aiProviderModelBinding: {
          findMany: jest.fn().mockResolvedValue([primary, secondary, other]),
        },
      } as never,
    );
    expect(
      await catalog.getExecutionBinding('fixture-model', 'secondary-video'),
    ).toMatchObject({
      deployment: 'secondary-video',
      ops: {
        providerBindingId: secondary.id,
        providerEndpointId: secondary.providerEndpointId,
        providerCapacity: { maxConcurrentRequests: 4 },
        providerCapacityTiers: {
          resolution: { '4k': { maxConcurrentRequests: 1 } },
        },
      },
    });
    expect(
      await catalog.getExecutionBinding('fixture-model', 'other-video'),
    ).toBeNull();
    expect(
      await catalog.getExecutionBinding('fixture-model', 'missing'),
    ).toBeNull();
  },
);

it.each([
  [FalCatalogService, FalProviderAdapter],
  [BailianCatalogService, BailianProviderAdapter],
] as const)(
  'resolves the normalized video mode before any provider call',
  async (Catalog, Adapter) => {
    const primary = row('primary-video', 'video', 10);
    const secondary = row('secondary-video', 'video', 20);
    secondary.supportedModes = ['image_to_video'];
    const catalog = new Catalog(
      config as never,
      {
        aiProviderModelBinding: {
          findMany: jest.fn().mockResolvedValue([primary, secondary]),
        },
      } as never,
    );
    const submit = jest.fn();
    const adapter = new Adapter(
      config as never,
      catalog as never,
      { submit } as never,
    );
    const binding = await adapter.resolveExecutionBinding('fixture-model', {
      prompt: 'Animate',
      startFrame: { url: 'https://example.com/image.png' },
    });
    expect(binding).toMatchObject({
      deployment: 'secondary-video',
      ops: { providerBindingId: secondary.id },
    });
    expect(submit).not.toHaveBeenCalled();
  },
);
