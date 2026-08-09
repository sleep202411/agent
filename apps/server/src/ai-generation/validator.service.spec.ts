import { BadRequestException } from '@nestjs/common';
import type { MediaAssetFacts } from '../media/media-asset-facts.service';
import type { AiInputSchema } from './types';
import { AiGenerationValidatorService } from './validator.service';

function validatorWith(
  facts: Record<string, MediaAssetFacts> = {},
): AiGenerationValidatorService {
  const factsById = new Map(Object.entries(facts));
  return new AiGenerationValidatorService({
    ensureFacts: jest.fn(() => Promise.resolve(factsById)),
  } as never);
}

/** A reference array shaped the way every provider declares it. */
function referenceSchema(): AiInputSchema {
  return {
    type: 'object',
    required: [],
    properties: {
      referenceImages: {
        type: 'array',
        title: 'Reference images',
        items: {
          type: 'object',
          properties: { url: { type: 'string', format: 'uri' } },
          required: ['url'],
          additionalProperties: true,
        },
        'x-ui': { control: 'image_upload', group: 'reference', order: 1 },
      },
    },
  } as unknown as AiInputSchema;
}

describe('normalizeField string coercion', () => {
  it('rejects an object where the schema declares a string', () => {
    // MiniMax-H3 declared its reference arrays as strings; `String({url})`
    // produced "[object Object]", which survived every downstream check and
    // only failed at the provider after a paid call.
    const schema = {
      type: 'object',
      required: [],
      properties: { startFrame: { type: 'string', title: 'Start frame' } },
    } as unknown as AiInputSchema;

    expect(() =>
      validatorWith().normalizeInput(schema, {
        startFrame: { url: 'https://cdn.example.com/a.png' },
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts an object reference against an object item schema', () => {
    const normalized = validatorWith().normalizeInput(referenceSchema(), {
      referenceImages: [
        { url: 'https://cdn.example.com/a.png', assetId: 'asset-1' },
      ],
    });
    expect(normalized.referenceImages).toEqual([
      { url: 'https://cdn.example.com/a.png', assetId: 'asset-1' },
    ]);
  });
});

describe('applyTrustedMediaFacts', () => {
  it('replaces client-claimed facts with the values behind assetId', async () => {
    const validator = validatorWith({
      'asset-1': { durationSeconds: 12, bytes: 2_048 },
    });

    const result = await validator.applyTrustedMediaFacts({
      referenceVideos: [
        {
          url: 'https://cdn.example.com/a.mp4',
          assetId: 'asset-1',
          durationSeconds: 1,
          bytes: 1,
        },
      ],
    });

    expect(result.referenceVideos).toEqual([
      {
        url: 'https://cdn.example.com/a.mp4',
        assetId: 'asset-1',
        durationSeconds: 12,
        bytes: 2_048,
      },
    ]);
  });

  it('keeps client facts when no durable asset backs the reference', async () => {
    // A canvas output wired into a reference slot carries a client-probed
    // duration and no assetId. Catalog duration rules fail closed, so dropping
    // that value would reject a legitimate submit — and there is no
    // server-side source that could refill it.
    const result = await validatorWith().applyTrustedMediaFacts({
      referenceVideos: [
        { url: 'https://cdn.example.com/a.mp4', durationSeconds: 7 },
      ],
    });

    expect(result.referenceVideos).toEqual([
      { url: 'https://cdn.example.com/a.mp4', durationSeconds: 7 },
    ]);
  });

  it('falls back to the client value when a probe could not resolve one', async () => {
    // ensureFacts swallows probe failures and reports null. Degrading to the
    // client's number beats turning an ffprobe timeout into a hard 400.
    const validator = validatorWith({
      'asset-1': { durationSeconds: null, bytes: null },
    });

    const result = await validator.applyTrustedMediaFacts({
      referenceVideos: [
        { url: 'https://x/a.mp4', assetId: 'asset-1', durationSeconds: 9 },
      ],
    });

    expect(result.referenceVideos).toEqual([
      { url: 'https://x/a.mp4', assetId: 'asset-1', durationSeconds: 9 },
    ]);
  });
});
