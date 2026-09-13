import { planSingleModelSeed } from '../../../../prisma/seed/ai-catalog/seed-catalog';
import { FalCatalogService } from './fal-catalog.service';
import { FalProviderAdapter } from './fal-provider.adapter';
import type { FalConfigService } from './fal-config.service';
import type { FalClient } from './fal-client';
import type { PrismaService } from '../../../infra/db/db.module';
import type { ProviderGenerationContext } from '../../provider-adapter';
import { AiGenerationValidatorService } from '../../validator.service';
import type { MediaAssetFactsService } from '../../../media/media-asset-facts.service';

function setup() {
  const plan = planSingleModelSeed('minimax-h3-max');
  const rows = plan.providers.map((entry) => ({
    ...entry.binding,
    id: entry.endpoint.endpointId,
    canonicalModelId: 'minimax-h3-max',
    canonicalModel: { ...plan.canonical, id: 'minimax-h3-max' },
    providerAccount: { id: 'fal', status: 'active' },
    providerEndpoint: entry.endpoint,
  }));
  const config = {
    config: { enabled: true, catalogRefreshMs: 60000, pollDelayMs: 5000 },
  } as unknown as FalConfigService;
  const catalog = new FalCatalogService(config, {
    aiProviderModelBinding: { findMany: jest.fn().mockResolvedValue(rows) },
  } as unknown as PrismaService);
  const submit = jest
    .fn<ReturnType<FalClient['submit']>, Parameters<FalClient['submit']>>()
    .mockResolvedValue({ request_id: 'request-1' });
  const adapter = new FalProviderAdapter(config, catalog, {
    submit,
  } as unknown as FalClient);
  const validator = new AiGenerationValidatorService(
    {} as MediaAssetFactsService,
  );
  async function start(input: Record<string, unknown>) {
    const runtime = (await catalog.getRuntimeConfig('minimax-h3-max'))!;
    const normalized = validator.normalizeInput(runtime.inputSchema, input);
    return adapter.startGeneration(
      'minimax-h3-max',
      normalized,
      {} as ProviderGenerationContext,
    );
  }
  return { catalog, adapter, submit, start };
}

// Provider fields pinned to fal's H3 Max OpenAPI: 5–15 integer seconds,
// balanced prompt expansion, and separate keyframe/reference endpoints.
describe('H3 Max catalog to provider contract', () => {
  it('sends the fast defaults to text-to-video and persists its endpoint for polling', async () => {
    const { start, submit } = setup();
    const result = await start({ prompt: 'A bird takes flight' });
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      'minimax/h3-max/text-to-video',
      expect.objectContaining({
        prompt: 'A bird takes flight',
        duration: 5,
        resolution: '768P',
        prompt_expansion_mode: 'balanced',
        enable_safety_checker: true,
        sync_mode: false,
      }),
    );
    expect(result).toMatchObject({
      kind: 'pending',
      providerJobId: 'minimax/h3-max/text-to-video::request-1',
    });
  });

  it('routes first and last frames without an unsupported aspect ratio', async () => {
    const { start, submit } = setup();
    await start({
      prompt: 'A bird takes flight',
      duration: '15',
      startFrame: { url: 'https://example.com/start.png' },
      endFrame: { url: 'https://example.com/end.png' },
    });
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      'minimax/h3-max/image-to-video',
      expect.objectContaining({
        duration: 15,
        image_url: 'https://example.com/start.png',
        end_image_url: 'https://example.com/end.png',
      }),
    );
    expect(submit.mock.calls[0]?.[2]).not.toHaveProperty('aspect_ratio');
  });

  it('routes storyboard reference media to the reference endpoint with official field names', async () => {
    const { start, submit } = setup();
    await start({
      prompt: 'Image 1 walks across Image 2',
      referenceImages: [
        { url: 'https://example.com/hero.png' },
        { url: 'https://example.com/scene.png' },
      ],
      referenceVideos: [
        {
          url: 'https://example.com/motion.mp4',
          durationSeconds: 5,
          bytes: 1024,
        },
      ],
      referenceAudios: [
        {
          url: 'https://example.com/voice.mp3',
          durationSeconds: 5,
          bytes: 1024,
        },
      ],
    });
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      'minimax/h3-max/reference-to-video',
      expect.objectContaining({
        reference_image_urls: [
          'https://example.com/hero.png',
          'https://example.com/scene.png',
        ],
        reference_video_urls: ['https://example.com/motion.mp4'],
        reference_audio_urls: ['https://example.com/voice.mp3'],
      }),
    );
    expect(submit.mock.calls[0]?.[2]).not.toHaveProperty('image_urls');
  });

  it.each(['4', '16', '5.5'])(
    'rejects duration %s before provider submission',
    async (duration) => {
      const { start, submit } = setup();
      await expect(start({ prompt: 'A bird', duration })).rejects.toThrow();
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it('rejects mixed keyframes and references before provider submission', async () => {
    const { start, submit } = setup();
    await expect(
      start({
        prompt: 'A bird',
        startFrame: { url: 'https://example.com/start.png' },
        referenceImages: [{ url: 'https://example.com/ref.png' }],
      }),
    ).rejects.toMatchObject({
      payload: {
        code: 'VALIDATION_ERROR',
        retryable: false,
        message: 'H3 Max cannot mix keyframes with reference media.',
      },
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
