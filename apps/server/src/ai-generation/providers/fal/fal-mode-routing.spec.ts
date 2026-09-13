/**
 * Per-mode ContainerModel routing for multi-endpoint fal video models.
 *
 * NOTE (2026-07-02 Seedance cutover): the `bytedance/seedance-2.0/*` fixture
 * ids below are SYNTHETIC — fal no longer serves any Seedance binding
 * (byteplus-modelark is the sole provider). The suite remains because it pins
 * the GENERIC fal multi-endpoint dispatch machinery (mode→endpoint map,
 * sibling-endpoint poll registration, seedream /edit reverse-map), which
 * outlives the fixture family that motivated it.
 *
 * Covers the two dispatch blockers:
 * 1. submit must route to the mode's endpoint (not the alphabetical primary);
 * 2. the catalog cache must register EVERY active binding's endpointId so a
 *    poll decoded from providerJobId resolves sibling endpoints.
 */
import { FalCatalogService } from './fal-catalog.service';
import type { FalClient } from './fal-client';
import type { FalConfigService } from './fal-config.service';
import {
  FalProviderAdapter,
  videoGenerationModeFromPayload,
} from './fal-provider.adapter';
import type { FalModelRuntimeConfig } from './fal.types';
import type { PrismaService } from '../../../infra/db/db.module';
import type { ProviderGenerationContext } from '../../provider-adapter';

const T2V_ENDPOINT = 'bytedance/seedance-2.0/text-to-video';
const I2V_ENDPOINT = 'bytedance/seedance-2.0/image-to-video';
const R2V_ENDPOINT = 'bytedance/seedance-2.0/reference-to-video';

const SEEDANCE_MODE_ENDPOINTS: FalModelRuntimeConfig['modeEndpoints'] = {
  text_to_video: T2V_ENDPOINT,
  image_to_video: I2V_ENDPOINT,
  first_last_frame_to_video: I2V_ENDPOINT,
  multimodal_to_video: R2V_ENDPOINT,
};

describe('videoGenerationModeFromPayload', () => {
  it('derives text_to_video from a prompt-only payload', () => {
    expect(videoGenerationModeFromPayload({ prompt: 'a fox' })).toBe(
      'text_to_video',
    );
  });

  it('derives image_to_video from image_url', () => {
    expect(
      videoGenerationModeFromPayload({
        prompt: 'a fox',
        image_url: 'https://example.com/start.png',
      }),
    ).toBe('image_to_video');
  });

  it('derives first_last_frame_to_video from end_image_url', () => {
    expect(
      videoGenerationModeFromPayload({
        prompt: 'a fox',
        image_url: 'https://example.com/start.png',
        end_image_url: 'https://example.com/end.png',
      }),
    ).toBe('first_last_frame_to_video');
  });

  it.each([
    ['image_urls', { image_urls: ['https://example.com/ref.png'] }],
    ['video_urls', { video_urls: ['https://example.com/ref.mp4'] }],
    ['audio_urls', { audio_urls: ['https://example.com/ref.mp3'] }],
  ])('derives multimodal_to_video from %s', (_label, extra) => {
    expect(videoGenerationModeFromPayload({ prompt: 'a fox', ...extra })).toBe(
      'multimodal_to_video',
    );
  });

  it('ignores empty reference arrays and blank url strings', () => {
    expect(
      videoGenerationModeFromPayload({
        prompt: 'a fox',
        image_urls: [],
        video_urls: [],
        audio_urls: [],
        image_url: '  ',
        end_image_url: '',
      }),
    ).toBe('text_to_video');
  });
});

describe('FalProviderAdapter submit mode routing', () => {
  // Primary (alphabetical dedupe winner) is image-to-video — exactly the
  // misroute the fix targets for prompt-only and multimodal payloads.
  const runtime = {
    endpointId: I2V_ENDPOINT,
    type: 'video',
    enabled: true,
    modeEndpoints: SEEDANCE_MODE_ENDPOINTS,
    inputSchema: {
      properties: {
        prompt: {},
        startImage: {},
        endImage: {},
        referenceImages: {},
        referenceVideos: {},
        referenceAudios: {},
      },
    },
    providerInputMap: {
      prompt: { parameter: 'prompt' },
      startImage: {
        parameter: 'image_url',
        transform: 'mediaUrl',
        omitIfEmpty: true,
      },
      endImage: {
        parameter: 'end_image_url',
        transform: 'mediaUrl',
        omitIfEmpty: true,
      },
      referenceImages: {
        parameter: 'image_urls',
        transform: 'mediaArrayToUrls',
        omitIfEmpty: true,
      },
      referenceVideos: {
        parameter: 'video_urls',
        transform: 'mediaArrayToUrls',
        omitIfEmpty: true,
      },
      referenceAudios: {
        parameter: 'audio_urls',
        transform: 'mediaArrayToUrls',
        omitIfEmpty: true,
      },
    },
  } as unknown as FalModelRuntimeConfig;

  function buildAdapter(overrides: Partial<FalModelRuntimeConfig> = {}) {
    const submit = jest.fn().mockResolvedValue({ request_id: 'req-1' });
    const configService = {
      config: { enabled: true, pollDelayMs: 5_000 },
    } as unknown as FalConfigService;
    const catalog = {
      getRuntimeConfig: jest
        .fn()
        .mockResolvedValue({ ...runtime, ...overrides }),
    } as unknown as FalCatalogService;
    const client = { submit } as unknown as FalClient;
    return {
      adapter: new FalProviderAdapter(configService, catalog, client),
      submit,
    };
  }

  async function start(input: Record<string, unknown>) {
    const { adapter, submit } = buildAdapter();
    const result = await adapter.startGeneration(
      'seedance-2-0',
      input,
      {} as ProviderGenerationContext,
    );
    if (result.kind !== 'pending') throw new Error('expected pending start');
    return { result, submit };
  }

  it('routes a prompt-only payload to the text-to-video endpoint', async () => {
    const { result, submit } = await start({ prompt: 'a fox running' });
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      T2V_ENDPOINT,
      expect.objectContaining({ prompt: 'a fox running' }),
    );
    // providerJobId must encode the RESOLVED endpoint so poll decodes it.
    expect(result.providerJobId).toBe(`${T2V_ENDPOINT}::req-1`);
    expect(result.providerEndpoint).toBe(T2V_ENDPOINT);
  });

  it('rejects prompt-only input for an image-only route before calling fal', async () => {
    const { adapter, submit } = buildAdapter({
      modeEndpoints: { image_to_video: I2V_ENDPOINT },
    });
    await expect(
      adapter.startGeneration(
        'kling-motion',
        { prompt: 'A Storyboard shot', duration: '10' },
        {} as ProviderGenerationContext,
      ),
    ).rejects.toMatchObject({
      payload: { code: 'VALIDATION_ERROR', retryable: false },
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('routes image_url to the image-to-video endpoint', async () => {
    const { result, submit } = await start({
      prompt: 'animate this',
      startImage: { url: 'https://example.com/start.png' },
    });
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      I2V_ENDPOINT,
      expect.objectContaining({
        image_url: 'https://example.com/start.png',
      }),
    );
    expect(result.providerJobId).toBe(`${I2V_ENDPOINT}::req-1`);
    expect(result.providerEndpoint).toBe(I2V_ENDPOINT);
  });

  it('routes image_url + end_image_url to the image-to-video endpoint', async () => {
    const { result, submit } = await start({
      prompt: 'morph between frames',
      startImage: { url: 'https://example.com/start.png' },
      endImage: { url: 'https://example.com/end.png' },
    });
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      I2V_ENDPOINT,
      expect.objectContaining({
        image_url: 'https://example.com/start.png',
        end_image_url: 'https://example.com/end.png',
      }),
    );
    expect(result.providerJobId).toBe(`${I2V_ENDPOINT}::req-1`);
    expect(result.providerEndpoint).toBe(I2V_ENDPOINT);
  });

  it.each([
    [
      'image references',
      { referenceImages: [{ url: 'https://example.com/ref.png' }] },
    ],
    [
      'video references',
      { referenceVideos: [{ url: 'https://example.com/ref.mp4' }] },
    ],
    [
      'audio references',
      {
        referenceImages: [{ url: 'https://example.com/ref.png' }],
        referenceAudios: [{ url: 'https://example.com/ref.mp3' }],
      },
    ],
  ])('routes %s to the reference-to-video endpoint', async (_label, extra) => {
    const { result, submit } = await start({
      prompt: 'use @Image1 as the hero',
      ...extra,
    });
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      R2V_ENDPOINT,
      expect.anything(),
    );
    expect(result.providerJobId).toBe(`${R2V_ENDPOINT}::req-1`);
    expect(result.providerEndpoint).toBe(R2V_ENDPOINT);
  });
});

describe('FalProviderAdapter seedream image edit routing', () => {
  // Seedream names its image-to-image variant as a SIBLING of text-to-image
  // (`.../v4.5/edit`), not a child (`.../text-to-image/edit`). Regression for the
  // 404 where the adapter appended `/edit` to the full text-to-image endpoint.
  const SEEDREAM_T2I = 'fal-ai/bytedance/seedream/v4.5/text-to-image';
  const SEEDREAM_EDIT = 'fal-ai/bytedance/seedream/v4.5/edit';

  const runtime = {
    endpointId: SEEDREAM_T2I,
    type: 'image',
    enabled: true,
    inputSchema: { properties: { prompt: {}, referenceImages: {} } },
    providerInputMap: {
      prompt: { parameter: 'prompt' },
      referenceImages: {
        parameter: 'image_urls',
        transform: 'mediaArrayToUrls',
        omitIfEmpty: true,
      },
    },
    parameterPolicy: { providerFamily: 'seedream' },
  } as unknown as FalModelRuntimeConfig;

  function buildAdapter() {
    const submit = jest.fn().mockResolvedValue({ request_id: 'req-1' });
    const configService = {
      config: { enabled: true, pollDelayMs: 5_000 },
    } as unknown as FalConfigService;
    const catalog = {
      getRuntimeConfig: jest.fn().mockResolvedValue(runtime),
    } as unknown as FalCatalogService;
    const client = { submit } as unknown as FalClient;
    return {
      adapter: new FalProviderAdapter(configService, catalog, client),
      submit,
    };
  }

  async function start(input: Record<string, unknown>) {
    const { adapter, submit } = buildAdapter();
    const result = await adapter.startGeneration(
      'seedream-4-5',
      input,
      {} as ProviderGenerationContext,
    );
    if (result.kind !== 'pending') throw new Error('expected pending start');
    return { result, submit };
  }

  it('routes a prompt-only payload to the text-to-image endpoint', async () => {
    const { result, submit } = await start({ prompt: 'a quiet study' });
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      SEEDREAM_T2I,
      expect.anything(),
    );
    expect(result.providerJobId).toBe(`${SEEDREAM_T2I}::req-1`);
    expect(result.providerEndpoint).toBe(SEEDREAM_T2I);
  });

  it('routes reference images to the sibling /edit endpoint (not text-to-image/edit)', async () => {
    const { result, submit } = await start({
      prompt: 'edit the scene',
      referenceImages: [{ url: 'https://example.com/ref.png' }],
    });
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      SEEDREAM_EDIT,
      expect.objectContaining({
        image_urls: ['https://example.com/ref.png'],
      }),
    );
    // The endpoint that 404'd before the fix.
    expect(submit).not.toHaveBeenCalledWith(
      expect.anything(),
      `${SEEDREAM_T2I}/edit`,
      expect.anything(),
    );
    expect(result.providerJobId).toBe(`${SEEDREAM_EDIT}::req-1`);
    expect(result.providerEndpoint).toBe(SEEDREAM_EDIT);
  });
});

describe('FalProviderAdapter edit-endpoint config reverse-map', () => {
  it('resolves a seedream /edit endpoint back to its text-to-image config on poll', async () => {
    const getRuntimeConfig = jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'fal-ai/bytedance/seedream/v4.5/text-to-image'
          ? { endpointId: key, type: 'image', enabled: true }
          : null,
      );
    const adapter = new FalProviderAdapter(
      { config: { enabled: true } } as unknown as FalConfigService,
      { getRuntimeConfig } as unknown as FalCatalogService,
      {
        status: jest
          .fn()
          .mockResolvedValue({ status: 'IN_PROGRESS', logs: [] }),
      } as unknown as FalClient,
    );

    await adapter.pollStatus('fal-ai/bytedance/seedream/v4.5/edit::req-1');

    // First tries the edit endpoint, then falls back to the text-to-image key.
    expect(getRuntimeConfig).toHaveBeenCalledWith(
      'fal-ai/bytedance/seedream/v4.5/edit',
    );
    expect(getRuntimeConfig).toHaveBeenCalledWith(
      'fal-ai/bytedance/seedream/v4.5/text-to-image',
    );
  });
});

describe('FalCatalogService multi-endpoint registration', () => {
  function seedanceRow(
    endpointId: string,
    supportedModes: string[],
  ): Record<string, unknown> {
    return {
      id: `binding-${endpointId}`,
      provider: 'fal-ai',
      endpointId,
      supportedModes,
      modality: 'video',
      priority: 100,
      weight: 1,
      displayName: null,
      disabledReason: null,
      providerAccountId: 'acct-1',
      providerEndpointId: `ep-${endpointId}`,
      canonicalModelId: 'cm-seedance-2-0',
      canonicalModel: {
        id: 'cm-seedance-2-0',
        slug: 'seedance-2-0',
        displayName: 'Seedance 2.0',
        description: 'ByteDance Seedance 2.0 video.',
        queuePolicy: {},
        entitlementPolicy: {},
        parameterPolicy: {},
        billingPolicy: {
          mode: 'charge',
          productPricing: {
            kind: 'matrix',
            dimensions: ['resolution'],
            tiers: [{ match: { resolution: '720p' }, cost: 304 }],
          },
        },
      },
      providerAccount: { id: 'acct-1', status: 'active' },
      providerEndpoint: {
        maxConcurrentRequests: null,
        maxRequestsPerMinute: null,
        requestTimeoutSeconds: 2700,
        cooldownSeconds: null,
        failureThreshold: null,
      },
    };
  }

  function buildService() {
    // Rows arrive in the DB orderBy (priority asc, weight desc, endpointId
    // asc) — image-to-video is the alphabetical dedupe winner.
    const rows = [
      seedanceRow(I2V_ENDPOINT, [
        'image_to_video',
        'first_last_frame_to_video',
      ]),
      seedanceRow(R2V_ENDPOINT, ['multimodal_to_video']),
      seedanceRow(T2V_ENDPOINT, ['text_to_video']),
    ];
    const prisma = {
      aiProviderModelBinding: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    } as unknown as PrismaService;
    const configService = {
      config: { enabled: true, catalogRefreshMs: 60_000, pollDelayMs: 5_000 },
    } as unknown as FalConfigService;
    return new FalCatalogService(configService, prisma);
  }

  it('emits ONE catalog model per canonical with the union of modes', async () => {
    const service = buildService();
    const models = await service.listModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('seedance-2-0');
    expect(models[0].generationModes).toEqual(
      expect.arrayContaining([
        'text_to_video',
        'image_to_video',
        'first_last_frame_to_video',
        'multimodal_to_video',
      ]),
    );
  });

  it('registers EVERY seedance endpointId for runtime lookups (poll path)', async () => {
    const service = buildService();
    for (const endpointId of [T2V_ENDPOINT, I2V_ENDPOINT, R2V_ENDPOINT]) {
      const runtime = await service.getRuntimeConfig(endpointId);
      expect(runtime).not.toBeNull();
      expect(runtime?.endpointId).toBe(endpointId);
      // 'fal/'-prefixed alias resolves too.
      expect(
        await service.getRuntimeConfig(`fal/${endpointId}`),
      ).not.toBeNull();
    }
  });

  it('builds the mode->endpoint map and shares it across every sibling runtime', async () => {
    const service = buildService();
    const primary = await service.getRuntimeConfig('seedance-2-0');
    expect(primary?.endpointId).toBe(I2V_ENDPOINT);
    expect(primary?.modeEndpoints).toEqual(SEEDANCE_MODE_ENDPOINTS);

    const siblings = await Promise.all(
      [T2V_ENDPOINT, I2V_ENDPOINT, R2V_ENDPOINT].map((endpointId) =>
        service.getRuntimeConfig(endpointId),
      ),
    );
    for (const sibling of siblings) {
      expect(sibling?.modeEndpoints).toBe(primary?.modeEndpoints);
    }
  });
});
