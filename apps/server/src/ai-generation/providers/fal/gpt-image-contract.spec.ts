import Ajv from 'ajv';
import { BadRequestException } from '@nestjs/common';
import { AiGenerationValidatorService } from '../../validator.service';
import type { MediaAssetFactsService } from '../../../media/media-asset-facts.service';
import { estimateProductModelPoints } from '@repo/shared';
import { IMAGE_MODELS } from '../../../../prisma/seed/ai-catalog/image-models';
import { GPT_IMAGE_2_PRODUCT_PRICING } from '../../../../prisma/seed/ai-catalog/defaults';
import { planSingleModelSeed } from '../../../../prisma/seed/ai-catalog/seed-catalog';
import { FalCatalogService } from './fal-catalog.service';
import { FalProviderAdapter } from './fal-provider.adapter';
import { mapFalProviderRequest } from './fal-request.mapper';
import type { FalConfigService } from './fal-config.service';
import type { FalClient } from './fal-client';
import type { PrismaService } from '../../../infra/db/db.module';
import type { ProviderGenerationContext } from '../../provider-adapter';

const ajv = new Ajv({ strict: false });
const models = IMAGE_MODELS.filter((m) => m.family === 'gpt-image');
const validator = new AiGenerationValidatorService(
  {} as MediaAssetFactsService,
);
const references = Array.from({ length: 16 }, (_, i) => ({
  url: `https://example.com/ref-${i}.png`,
}));
function setup(slug: string) {
  const plan = planSingleModelSeed(slug);
  const rows = plan.providers.map((entry) => ({
    ...entry.binding,
    id: entry.endpoint.endpointId,
    canonicalModelId: slug,
    canonicalModel: { ...plan.canonical, id: slug },
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
  const status = jest.fn().mockResolvedValue({ status: 'COMPLETED' });
  const response = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: {},
    body: {
      images: [
        {
          url: 'https://example.com/result.png',
          content_type: 'image/png',
          width: 1024,
          height: 768,
        },
      ],
    },
  });
  const adapter = new FalProviderAdapter(config, catalog, {
    submit,
    status,
    response,
    requestByEndpoint: jest.fn().mockResolvedValue({ requests: [] }),
  } as unknown as FalClient);
  return { catalog, adapter, submit, status, response };
}

describe.each(models)('$slug end-to-end catalog contract', (model) => {
  it('rejects a mask without an original image before provider submission', async () => {
    const { catalog } = setup(model.slug);
    const runtime = (await catalog.getRuntimeConfig(model.slug))!;
    for (const referenceImages of [undefined, []]) {
      expect(() =>
        validator.normalizeInput(runtime.inputSchema, {
          prompt: 'Edit this area',
          maskImage: { url: 'https://example.com/mask.png' },
          ...(referenceImages ? { referenceImages } : {}),
        }),
      ).toThrow(BadRequestException);
    }
  });

  it('exposes 16 references and rejects 17 through the shared validation kernel', async () => {
    const { catalog } = setup(model.slug);
    const runtime = (await catalog.getRuntimeConfig(model.slug))!;
    expect(runtime).not.toBeNull();
    expect(runtime.inputSchema.properties.referenceImages).toMatchObject({
      maxItems: 16,
    });
    const normalized = validator.normalizeInput(runtime.inputSchema, {
      prompt: 'edit',
      referenceImages: references,
    });
    expect(normalized.referenceImages).toEqual(references);
    expect(() =>
      validator.normalizeInput(runtime.inputSchema, {
        prompt: 'edit',
        referenceImages: [...references, references[0]],
      }),
    ).toThrow();
    const list = await catalog.listModels();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(model.slug);
    if (model.slug.includes('2.5')) {
      expect(list[0].capability_matrix?.limits).toMatchObject({
        maxOutputs: 10,
        maxPromptCharacters: 32000,
      });
      expect(() =>
        validator.normalizeInput(runtime.inputSchema, {
          prompt: 'x'.repeat(32000),
          quality: 'xhigh',
          numOutputs: 10,
        }),
      ).not.toThrow();
      expect(() =>
        validator.normalizeInput(runtime.inputSchema, {
          prompt: 'x'.repeat(32001),
        }),
      ).toThrow();
      expect(() =>
        validator.normalizeInput(runtime.inputSchema, {
          prompt: 'test',
          numOutputs: 11,
        }),
      ).toThrow();
    }
  });

  it.each(['text', 'edit', 'mask'])(
    'submits %s to the correct endpoint, retaining references and poll routing',
    async (mode) => {
      const { catalog, adapter, submit, status, response } = setup(model.slug);
      const is25 = model.slug.includes('2.5');
      const base = model.providers[0].endpointId;
      const expectedEndpoint =
        mode === 'text'
          ? base
          : is25
            ? base.replace('/text-to-image', '/edit')
            : `${base}/edit`;
      const input = {
        prompt: 'A precise scene',
        imageSize: '4:3',
        resolution: '2K',
        quality: is25 ? 'max' : 'high',
        numOutputs: is25 ? 10 : 4,
        outputFormat: 'webp',
        ...(mode !== 'text' ? { referenceImages: references } : {}),
        ...(mode === 'mask'
          ? { maskImage: { url: 'https://example.com/mask.png' } }
          : {}),
      };
      const result = await adapter.startGeneration(
        model.slug,
        validator.normalizeInput(
          (await catalog.getRuntimeConfig(model.slug))!.inputSchema,
          input,
        ),
        {} as ProviderGenerationContext,
      );
      expect(result.kind).toBe('pending');
      if (result.kind !== 'pending') throw new Error('Expected pending');
      expect(result.providerJobId).toBe(`${expectedEndpoint}::request-1`);
      expect(submit).toHaveBeenCalledWith(
        expect.anything(),
        expectedEndpoint,
        expect.objectContaining({
          image_size: { width: 2048, height: 1536 },
          quality: input.quality,
          num_images: input.numOutputs,
          output_format: 'webp',
        }),
      );
      const body = submit.mock.calls[0][2];
      if (is25) {
        const binding = model.providers.find(
          (p) => p.endpointId === expectedEndpoint,
        )!;
        const validate = ajv.compile(binding.providerInputSchema!);
        expect({ valid: validate(body), errors: validate.errors }).toEqual({
          valid: true,
          errors: null,
        });
      }
      if (mode !== 'text')
        expect(body.image_urls).toEqual(references.map((ref) => ref.url));
      else expect(body.image_urls).toBeUndefined();
      if (mode === 'mask')
        expect(body.mask_url).toBe('https://example.com/mask.png');
      if (is25)
        expect(await catalog.getRuntimeConfig(expectedEndpoint)).not.toBeNull();
      const polled = await adapter.pollStatus(result.providerJobId);
      expect(polled.kind).toBe('completed');
      if (polled.kind === 'completed')
        expect(polled.outputs).toEqual([
          expect.objectContaining({
            providerUrl: 'https://example.com/result.png',
            width: 1024,
            height: 768,
          }),
        ]);
      expect(status).toHaveBeenCalledWith(
        expect.anything(),
        expectedEndpoint,
        'request-1',
        undefined,
      );
      expect(response).toHaveBeenCalledWith(
        expect.anything(),
        expectedEndpoint,
        'request-1',
        undefined,
      );
    },
  );

  it('keeps every advertised aspect/resolution within fal pixel bounds after quantization', async () => {
    const { catalog } = setup(model.slug);
    const runtime = (await catalog.getRuntimeConfig(model.slug))!;
    for (const imageSize of [
      '1:1',
      '4:3',
      '3:4',
      '16:9',
      '9:16',
      '3:2',
      '2:3',
      '21:9',
    ]) {
      for (const resolution of ['1K', '2K', '4K']) {
        const body = mapFalProviderRequest(runtime, { imageSize, resolution });
        const { width, height } = body.image_size as {
          width: number;
          height: number;
        };
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
        expect(width * height).toBeGreaterThanOrEqual(655360);
        expect(width * height).toBeLessThanOrEqual(8294400);
        const [a, b] = imageSize.split(':').map(Number);
        expect(Math.abs(width / height / (a / b) - 1)).toBeLessThan(0.025);
      }
    }
  });
});

describe('GPT Image product pricing', () => {
  it('discounts Image 2 base rates independently while retaining reference charges and final rounding', () => {
    const policy = GPT_IMAGE_2_PRODUCT_PRICING;
    if (policy.mode !== 'parameter_matrix') throw new Error('Expected matrix');
    const oldRates = {
      '1K': [20, 60, 120],
      '2K': [30, 90, 180],
      '4K': [45, 140, 280],
    };
    for (const [resolution, rates] of Object.entries(oldRates)) {
      ['low', 'medium', 'high'].forEach((quality, index) => {
        expect(policy.matrix[resolution][quality]).toBeCloseTo(
          rates[index] * 0.5,
        );
        for (const count of [0, 1, 16]) {
          const quote = estimateProductModelPoints({
            policy,
            resolution,
            quality,
            referenceImageCount: count,
          });
          const total =
            rates[index] * 0.5 + (count > 0 ? 10.5 + (count - 1) * 3.5 : 0);
          expect(quote.sellPoints).toBe(Math.ceil(total));
        }
      });
    }
  });
  it.each(models.filter((m) => m.slug.includes('2.5')))(
    '$slug has an explicit price for every quality/resolution and ten outputs',
    (model) => {
      const policy = model.productPricing;
      if (policy.mode !== 'parameter_matrix')
        throw new Error('Expected matrix');
      for (const resolution of policy.resolutionOptions ?? [])
        for (const quality of policy.qualityOptions ?? []) {
          expect(policy.matrix[resolution][quality]).toBeGreaterThan(0);
          const quote = estimateProductModelPoints({
            policy,
            resolution,
            quality,
            numOutputs: 10,
          });
          expect(quote.sellPoints).toBe(
            Math.ceil(policy.matrix[resolution][quality] * 10),
          );
        }
      expect(estimateProductModelPoints({ policy }).sellPoints).toBe(
        model.cost,
      );
      expect(policy.matrix['1K']).toEqual({
        low: 14,
        medium: 42,
        high: 84,
        xhigh: 168,
        max: 336,
      });
    },
  );
});
