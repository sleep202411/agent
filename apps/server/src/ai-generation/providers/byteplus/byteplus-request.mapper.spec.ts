import {
  mapBytePlusProviderRequest,
  mapBytePlusVideoProviderRequest,
  resolveBytePlusWatermark,
} from './byteplus-request.mapper';
import type { BytePlusImageRuntimeConfig } from './byteplus-runtime';
import type { AiJsonValue } from '../../types';

/** Minimal runtime config — the mapper reads endpointId + outputPolicy. */
function runtimeConfig(outputPolicy?: AiJsonValue): BytePlusImageRuntimeConfig {
  return {
    endpointId: 'seedance-1-5-pro-250528',
    outputPolicy,
  } as unknown as BytePlusImageRuntimeConfig;
}

function seedance25Runtime(): BytePlusImageRuntimeConfig {
  return {
    endpointId: 'dreamina-seedance-2-5-260628',
  } as unknown as BytePlusImageRuntimeConfig;
}

/** A reference entry as character expansion stamps it (characterId present). */
const characterStampedReference = {
  url: 'https://cdn.example.com/characters/hero-front.png',
  refId: 'char-1::1',
  label: 'Hero',
  assetId: 'asset-1',
  groupRefId: 'char-1',
  characterId: '4f8a4f6a-2f6f-4e5a-9a63-0a4a3d2f1b0c',
};

describe('resolveBytePlusWatermark', () => {
  it('defaults to false when outputPolicy is unset (legacy behavior)', () => {
    expect(resolveBytePlusWatermark(runtimeConfig(), {})).toBe(false);
  });

  it('is false when outputPolicy.watermark is explicitly false', () => {
    expect(
      resolveBytePlusWatermark(runtimeConfig({ watermark: false }), {}),
    ).toBe(false);
  });

  it('is false when outputPolicy.watermark is not a boolean', () => {
    expect(
      resolveBytePlusWatermark(runtimeConfig({ watermark: 'yes' }), {}),
    ).toBe(false);
  });

  it('follows outputPolicy.watermark=true with no character references', () => {
    expect(
      resolveBytePlusWatermark(runtimeConfig({ watermark: true }), {
        referenceImages: ['https://cdn.example.com/plain-ref.png'],
      }),
    ).toBe(true);
  });

  it('does NOT force watermark for plain (unstamped) reference entries', () => {
    expect(
      resolveBytePlusWatermark(runtimeConfig(), {
        referenceImages: [
          'https://cdn.example.com/plain-ref.png',
          { url: 'https://cdn.example.com/object-ref.png' },
        ],
      }),
    ).toBe(false);
  });

  it('forces watermark when a referenceImages entry is character-stamped', () => {
    expect(
      resolveBytePlusWatermark(runtimeConfig({ watermark: false }), {
        referenceImages: [
          'https://cdn.example.com/plain-ref.png',
          characterStampedReference,
        ],
      }),
    ).toBe(true);
  });

  it('forces watermark for stamped referenceVideos / referenceAudios too', () => {
    expect(
      resolveBytePlusWatermark(runtimeConfig(), {
        referenceVideos: [characterStampedReference],
      }),
    ).toBe(true);
    expect(
      resolveBytePlusWatermark(runtimeConfig(), {
        referenceAudios: [characterStampedReference],
      }),
    ).toBe(true);
  });
});

describe('mapBytePlusVideoProviderRequest watermark', () => {
  it('emits watermark:false for a plain job on a policy-less model', () => {
    const body = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'a quiet harbor at dawn',
    });
    expect(body.watermark).toBe(false);
  });

  it('emits watermark:true when the canonical outputPolicy enables it', () => {
    const body = mapBytePlusVideoProviderRequest(
      runtimeConfig({ watermark: true }),
      { prompt: 'a quiet harbor at dawn' },
    );
    expect(body.watermark).toBe(true);
  });

  it('forces watermark:true for character-expanded reference inputs', () => {
    const body = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'hero walks through the harbor',
      referenceImages: [characterStampedReference],
    });
    expect(body.watermark).toBe(true);
    // The stamped entry still flows into content[] as a reference image.
    expect(body.content).toContainEqual({
      type: 'image_url',
      image_url: { url: characterStampedReference.url },
      role: 'reference_image',
    });
  });
});

describe('mapBytePlusVideoProviderRequest wire contract (ModelArk doc 1520757)', () => {
  it('maps reference videos and audios to role-tagged content parts', () => {
    const body = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'match the motion of Video 1 with the voice of Audio 1',
      referenceImages: [{ url: 'https://cdn.example.com/face.png' }],
      referenceVideos: [{ url: 'https://cdn.example.com/motion.mp4' }],
      referenceAudios: [{ url: 'https://cdn.example.com/voice.wav' }],
    });
    expect(body.content).toContainEqual({
      type: 'video_url',
      video_url: { url: 'https://cdn.example.com/motion.mp4' },
      role: 'reference_video',
    });
    expect(body.content).toContainEqual({
      type: 'audio_url',
      audio_url: { url: 'https://cdn.example.com/voice.wav' },
      role: 'reference_audio',
    });
  });

  it('supports Seedance 2.5 audio-only reference without an empty text part', () => {
    const body = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      referenceAudios: [{ url: 'https://cdn.example.com/voice.wav' }],
    });
    expect(body.content).toEqual([
      {
        type: 'audio_url',
        audio_url: { url: 'https://cdn.example.com/voice.wav' },
        role: 'reference_audio',
      },
    ]);
  });

  it('passes asset:// (provider-hosted likeness) URLs through verbatim', () => {
    const body = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'Image 1 waves at the camera',
      referenceImages: [
        {
          ...characterStampedReference,
          url: 'asset://asset-20260222234430-mxpgh',
        },
      ],
    });
    expect(body.content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'asset://asset-20260222234430-mxpgh' },
      role: 'reference_image',
    });
    // Likeness references force the compliance watermark.
    expect(body.watermark).toBe(true);
  });

  it("maps duration 'auto' to -1 (model-chosen length), not omission", () => {
    const auto = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'a quiet harbor at dawn',
      duration: 'auto',
    });
    expect(auto.duration).toBe(-1);
    const fixed = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'a quiet harbor at dawn',
      duration: '8',
    });
    expect(fixed.duration).toBe(8);
  });

  it('sends generate_audio only when the user made an explicit choice', () => {
    const noChoice = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'a quiet harbor at dawn',
    });
    expect(noChoice).not.toHaveProperty('generate_audio');
    const optOut = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'a quiet harbor at dawn',
      generateAudio: false,
    });
    expect(optOut.generate_audio).toBe(false);
  });

  it('maps the Seedance 2.5 output container format', () => {
    const body = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'extend this clip while preserving its audio',
      outputFormat: 'mov',
    });
    expect(body.output_format).toBe('mov');
  });

  it('asks for the generated last frame only when opted in (shot chaining)', () => {
    const off = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'a quiet harbor at dawn',
    });
    expect(off).not.toHaveProperty('return_last_frame');
    const on = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'a quiet harbor at dawn',
      returnLastFrame: true,
    });
    expect(on.return_last_frame).toBe(true);
  });

  it('emits frame roles alone for the first/last-frame scenario', () => {
    const body = mapBytePlusVideoProviderRequest(runtimeConfig(), {
      prompt: 'the ink line grows northward',
      startFrame: { url: 'https://cdn.example.com/a-last.png' },
      endFrame: { url: 'https://cdn.example.com/b-end.png' },
    });
    const content = body.content as Array<Record<string, unknown>>;
    expect(content.map((part) => part.role)).toEqual([
      undefined,
      'first_frame',
      'last_frame',
    ]);
  });

  it('requires adaptive ratio for Seedance 2.5 frame-guided tasks', () => {
    expect(() =>
      mapBytePlusVideoProviderRequest(seedance25Runtime(), {
        prompt: 'move toward the final composition',
        startFrame: { url: 'https://cdn.example.com/start.png' },
        aspectRatio: '16:9',
      }),
    ).toThrow(/requires aspectRatio=auto/);

    expect(() =>
      mapBytePlusVideoProviderRequest(seedance25Runtime(), {
        prompt: 'move toward the final composition',
        startFrame: { url: 'https://cdn.example.com/start.png' },
        aspectRatio: 'auto',
      }),
    ).not.toThrow();
  });
});

// ModelArk doc 1520757: "Image to video - first frame, image to video - first
// and last frames, Multimodal reference video generation ... are three mutually
// exclusive scenarios and cannot be mixed." A mixed request earns HTTP 400
// `InvalidParameter: first/last frame content cannot be mixed with reference
// media content`, so it must never leave our worker.
describe('mapBytePlusVideoProviderRequest scenario exclusivity', () => {
  const frame = { url: 'https://cdn.example.com/frame.png' };
  const reference = { url: 'https://cdn.example.com/ref.png' };

  it.each([
    ['referenceImages', { referenceImages: [reference] }],
    ['referenceVideos', { referenceVideos: [{ url: 'https://x/v.mp4' }] }],
    ['referenceAudios', { referenceAudios: [{ url: 'https://x/a.mp3' }] }],
  ])('rejects a start frame combined with %s', (field, extra) => {
    expect(() =>
      mapBytePlusVideoProviderRequest(runtimeConfig(), {
        prompt: 'mixed request',
        startFrame: frame,
        ...extra,
      }),
    ).toThrow(new RegExp(field));
  });

  it('rejects an end frame combined with reference media', () => {
    expect(() =>
      mapBytePlusVideoProviderRequest(runtimeConfig(), {
        prompt: 'mixed request',
        endFrame: frame,
        referenceImages: [reference],
      }),
    ).toThrow(/cannot be combined/);
  });

  it('allows references with no frames, and frames with no references', () => {
    expect(() =>
      mapBytePlusVideoProviderRequest(runtimeConfig(), {
        prompt: 'multimodal only',
        referenceImages: [reference],
      }),
    ).not.toThrow();
    expect(() =>
      mapBytePlusVideoProviderRequest(runtimeConfig(), {
        prompt: 'frames only',
        startFrame: frame,
        endFrame: frame,
      }),
    ).not.toThrow();
  });

  it('ignores empty reference arrays so frames still pass', () => {
    expect(() =>
      mapBytePlusVideoProviderRequest(runtimeConfig(), {
        prompt: 'frames with emptied slots',
        startFrame: frame,
        referenceImages: [],
        referenceVideos: [],
      }),
    ).not.toThrow();
  });
});

describe('mapBytePlusProviderRequest watermark', () => {
  it('emits watermark:false for a plain job on a policy-less model', () => {
    const body = mapBytePlusProviderRequest(runtimeConfig(), {
      prompt: 'poster art',
      imageSize: '1:1',
    });
    expect(body.watermark).toBe(false);
  });

  it('emits watermark:true when the canonical outputPolicy enables it', () => {
    const body = mapBytePlusProviderRequest(
      runtimeConfig({ watermark: true }),
      { prompt: 'poster art', imageSize: '1:1' },
    );
    expect(body.watermark).toBe(true);
  });

  it('forces watermark:true for character-expanded reference inputs', () => {
    const body = mapBytePlusProviderRequest(
      runtimeConfig({ watermark: false }),
      {
        prompt: 'hero portrait, cinematic light',
        imageSize: '1:1',
        referenceImages: [characterStampedReference],
      },
    );
    expect(body.watermark).toBe(true);
    expect(body.image).toBe(characterStampedReference.url);
  });
});
