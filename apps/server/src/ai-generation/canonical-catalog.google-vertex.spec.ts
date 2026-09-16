import { AiCanonicalCatalogService } from './canonical-catalog.service';
import type { AiModelDefinition } from './types';

describe('AiCanonicalCatalogService Google Vertex routing', () => {
  it('surfaces an active Google binding through the canonical catalog', async () => {
    const googleModel = {
      id: 'nano-banana-2',
      enabled: true,
      ui_policy: { defaultMode: 'simple' },
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    } as unknown as AiModelDefinition;
    const prisma = {
      aiCanonicalModel: {
        findMany: jest.fn().mockResolvedValue([
          {
            slug: 'nano-banana-2',
            vendor: 'Google',
            uiPolicy: { group: 'recommended', sortOrder: 70 },
            bindings: [{ provider: 'google-vertex' }],
          },
        ]),
      },
    };
    const emptyCatalog = { getModel: jest.fn().mockResolvedValue(null) };
    const googleCatalog = {
      getModel: jest.fn().mockResolvedValue(googleModel),
    };
    const service = new AiCanonicalCatalogService(
      prisma as never,
      emptyCatalog as never,
      emptyCatalog as never,
      emptyCatalog as never,
      emptyCatalog as never,
      googleCatalog as never,
      emptyCatalog as never,
      emptyCatalog as never,
    );

    await expect(service.listModels()).resolves.toEqual([
      expect.objectContaining({ id: 'nano-banana-2', vendor: 'Google' }),
    ]);
    expect(googleCatalog.getModel).toHaveBeenCalledWith('nano-banana-2');
  });

  it('grafts the canonical generation_modes as the single capability authority', async () => {
    // The provider mapper infers a wide mode set from its binding; the
    // admin-curated canonical says i2v-only. The canonical must win — a
    // mis-declared binding must never widen what a model can be quoted for.
    const providerModel = {
      id: 'kling-motion',
      enabled: true,
      generationModes: ['text_to_video', 'image_to_video'],
      input_schema: { type: 'object', properties: {}, required: [] },
    } as unknown as AiModelDefinition;
    const prisma = {
      aiCanonicalModel: {
        findMany: jest.fn().mockResolvedValue([
          {
            slug: 'kling-motion',
            generationModes: ['image_to_video'],
            bindings: [{ provider: 'fal-ai' }],
          },
        ]),
      },
    };
    const emptyCatalog = { getModel: jest.fn().mockResolvedValue(null) };
    const falCatalog = {
      getModel: jest.fn().mockResolvedValue(providerModel),
    };
    const service = new AiCanonicalCatalogService(
      prisma as never,
      falCatalog as never,
      emptyCatalog as never,
      emptyCatalog as never,
      emptyCatalog as never,
      emptyCatalog as never,
      emptyCatalog as never,
      emptyCatalog as never,
    );

    const models = await service.listModels();
    expect(models).toHaveLength(1);
    expect(models[0].generationModes).toEqual(['image_to_video']);
  });
});
