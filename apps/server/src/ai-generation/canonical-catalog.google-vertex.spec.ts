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
});
