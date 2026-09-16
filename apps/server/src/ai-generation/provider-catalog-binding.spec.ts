import { AgnesCatalogService } from './providers/agnes/agnes-catalog.service';
import { BytePlusCatalogService } from './providers/byteplus/byteplus-catalog.service';
import { BytePlusSpeechCatalogService } from './providers/byteplus-speech/byteplus-speech-catalog.service';
import { GoogleVertexCatalogService } from './providers/google-vertex/google-vertex-catalog.service';
import { MiniMaxCatalogService } from './providers/minimax/minimax-catalog.service';
const catalogs = [
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
  '%s catalog binding consistency',
  (_name, Catalog, kind, primary, secondary) => {
    it('keeps the priority winner for canonical and duplicate endpoint lookups', async () => {
      const first = row(primary, kind, 10),
        second = row(primary, kind, 20);
      const catalog = new Catalog(
        config as never,
        {
          aiProviderModelBinding: {
            findMany: jest.fn().mockResolvedValue([first, second]),
          },
        } as never,
      );
      const models = await catalog.listModels();
      expect(models).toHaveLength(1);
      expect(models[0].ops?.providerBindingId).toBe(first.id);
      expect(
        (await catalog.getModel('fixture-model'))?.ops?.providerBindingId,
      ).toBe(first.id);
      expect(
        (await catalog.getRuntimeConfig('fixture-model'))?.queuePolicy
          .globalConcurrency,
      ).toBe(2);
      expect(
        (await catalog.getRuntimeConfig(primary))?.queuePolicy
          .globalConcurrency,
      ).toBe(2);
    });
    it('preserves secondary endpoint recovery without replacing the canonical runtime', async () => {
      const first = row(primary, kind, 10),
        second = row(secondary, kind, 20);
      const catalog = new Catalog(
        config as never,
        {
          aiProviderModelBinding: {
            findMany: jest.fn().mockResolvedValue([first, second]),
          },
        } as never,
      );
      expect(await catalog.listModels()).toHaveLength(1);
      expect((await catalog.getModel(secondary))?.deployment).toBe(secondary);
      expect(
        (await catalog.getRuntimeConfig('fixture-model'))?.endpointId,
      ).toBe(primary);
      expect((await catalog.getRuntimeConfig(secondary))?.endpointId).toBe(
        secondary,
      );
    });
  },
);
it.each([true, false])(
  'keeps MiniMax H3 aliases with H3 regardless of another model ordering (%s)',
  async (first) => {
    const h3 = row('MiniMax-H3', 'video', 10, 'minimax-h3'),
      other = row('MiniMax-other', 'video', 20, 'other-model');
    const rows = first ? [h3, other] : [other, h3];
    const catalog = new MiniMaxCatalogService(
      config as never,
      {
        aiProviderModelBinding: { findMany: jest.fn().mockResolvedValue(rows) },
      } as never,
    );
    expect((await catalog.getRuntimeConfig('minimax-h3'))?.endpointId).toBe(
      'MiniMax-H3',
    );
    expect((await catalog.getRuntimeConfig('MiniMax-H3'))?.endpointId).toBe(
      'MiniMax-H3',
    );
    expect((await catalog.getRuntimeConfig('other-model'))?.endpointId).toBe(
      'MiniMax-other',
    );
  },
);
