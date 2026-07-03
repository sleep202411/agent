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
