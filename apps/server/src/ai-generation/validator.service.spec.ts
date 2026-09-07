import { BadRequestException } from '@nestjs/common';
import type { MediaAssetFacts } from '../media/media-asset-facts.service';
import type { AiInputSchema } from './types';
import { AiGenerationValidatorService } from './validator.service';
import { createBytePlusVideoRuntimeConfig } from './providers/byteplus/byteplus-runtime';
import type { AiBillingPolicy, AiJsonValue } from './types';

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

describe('Seedance 2.5 omni-reference task-type rules', () => {
  const runtime = createBytePlusVideoRuntimeConfig({
    provider: 'byteplus-modelark',
    endpointId: 'dreamina-seedance-2-5-260628',
    name: 'Seedance 2.5',
    description: 'Seedance 2.5 test runtime',
    generationModes: [
      'text_to_video',
      'image_to_video',
      'first_last_frame_to_video',
      'multimodal_to_video',
    ],
    enabled: true,
    requiredPlan: null,
    queueName: 'ai-video-generation',
    globalConcurrency: 10,
    perUserRunning: 3,
    perUserQueued: 10,
    billingPolicy: {} as AiBillingPolicy,
    parameterPolicy: {
      defaultDurationSeconds: '5',
      durationOptions: ['auto', '4', '5', '8'],
      defaultAspectRatio: 'auto',
      supportedAspectRatios: ['auto', '16:9', '9:16'],
      defaultOmniReferenceTaskType: 'auto',
      omniReferenceTaskTypes: ['auto', 'reference', 'edit', 'extend'],
      referenceInputs: {
        enabled: true,
        images: { min: 0, max: 30 },
        videos: {
          min: 0,
          max: 10,
          minItemDurationSeconds: 2,
          maxItemDurationSeconds: 30,
        },
        audios: { min: 0, max: 10 },
        maxTotalFiles: 50,
        audioRequiresVisual: false,
      },
    } as AiJsonValue,
  });

  const sourceVideo = [
    {
      url: 'https://cdn.example.com/source.mp4',
      durationSeconds: 8,
    },
  ];

  /** The validator throws BadRequestException with the rule message in
   *  `getResponse().msg` — `err.message` is just the generic NestJS text. */
  function normalizationError(input: Record<string, unknown>): string {
    try {
      validatorWith().normalizeInput(runtime.inputSchema, input);
    } catch (err) {
      const response = (
        err as { getResponse?: () => { msg?: string } }
      ).getResponse?.();
      return response?.msg ?? String(err);
    }
    return '';
  }

  it('rejects edit without a reference video', () => {
    expect(
      normalizationError({
        prompt: 'edit Video 1',
        omniReferenceTaskType: 'edit',
        aspectRatio: 'auto',
        duration: 'auto',
      }),
    ).toMatch(/Video editing requires at least one reference video/);
  });

  it('rejects edit/extend with a pinned aspect ratio', () => {
    expect(
      normalizationError({
        prompt: 'extend Video 1',
        omniReferenceTaskType: 'extend',
        aspectRatio: '16:9',
        referenceVideos: sourceVideo,
      }),
    ).toMatch(/aspect ratio to Auto/);
  });

  it('rejects edit with a pinned duration, including the schema default', () => {
    // Explicit fixed duration:
    expect(
      normalizationError({
        prompt: 'edit Video 1',
        omniReferenceTaskType: 'edit',
        aspectRatio: 'auto',
        duration: '8',
        referenceVideos: sourceVideo,
      }),
    ).toMatch(/duration to Auto/);
    // Absent duration → schema default '5' is applied first, so the lock
    // still fails loud instead of silently shipping a non-(-1) duration.
    expect(
      normalizationError({
        prompt: 'edit Video 1',
        omniReferenceTaskType: 'edit',
        aspectRatio: 'auto',
        referenceVideos: sourceVideo,
      }),
    ).toMatch(/duration to Auto/);
  });

  it('accepts a fully locked edit request and preserves the task type', () => {
    const normalized = validatorWith().normalizeInput(runtime.inputSchema, {
      prompt: 'edit Video 1',
      omniReferenceTaskType: 'edit',
      aspectRatio: 'auto',
      duration: 'auto',
      referenceVideos: sourceVideo,
    });
    expect(normalized.omniReferenceTaskType).toBe('edit');
  });

  it('fails loud on a task type left over after switching modes', () => {
    // The composer resets the type on mode switch; a stale persisted input
    // (or a caller that skips that step) surfaces the same actionable rule
    // instead of silently dropping the edit intent.
    expect(
      normalizationError({
        prompt: 'a quiet harbor at dawn',
        omniReferenceTaskType: 'edit',
      }),
    ).toMatch(/Video editing requires at least one reference video/);
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
