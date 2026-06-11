/**
 * Declarative catalog of canonical AI video models (mirror of image-models.ts).
 *
 * One clean entry per canonical ContainerModel; no policy boilerplate (that
 * lives in defaults.ts + seed-catalog.ts). Modes are the union the model
 * supports; the studio param panel filters per selected mode. Each `providers`
 * entry seeds an AiProviderEndpoint + a runtime-valid AiProviderModelBinding
 * (modality 'video').
 */
import type { AiGenerationMode } from '@repo/shared';

import {
  SEEDANCE_2_0_FAST_PRODUCT_PRICING,
  SEEDANCE_2_0_PARAMETER_POLICY,
  SEEDANCE_2_0_PRODUCT_PRICING,
} from './defaults';
import type { ImageModelSeed, ProviderEntry } from './image-models';

/** Video ContainerModel seed — structurally identical to ImageModelSeed. */
export type VideoModelSeed = ImageModelSeed;

const T2V: AiGenerationMode = 'text_to_video';
const I2V: AiGenerationMode = 'image_to_video';
const FLF2V: AiGenerationMode = 'first_last_frame_to_video';
const MM2V: AiGenerationMode = 'multimodal_to_video'; // 全能参考 / omni reference

/** Fal video result: a single mp4 (audio muxed in) + echoed seed. */
const PROVIDER_VIDEO_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['video'],
  properties: {
    video: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        content_type: { type: 'string' },
        file_name: { type: 'string' },
        file_size: { type: 'integer' },
      },
    },
    seed: { type: 'integer' },
  },
};

/** The 3 fal endpoints behind a Seedance 2.0 ContainerModel (std or fast). */
function seedanceProviders(prefix: string): ProviderEntry[] {
  return [
    {
      provider: 'fal-ai',
      endpointId: `${prefix}/text-to-video`,
      modes: [T2V],
      providerOutputSchema: PROVIDER_VIDEO_OUTPUT_SCHEMA,
      requestTimeoutSeconds: 2700,
      priority: 100,
    },
    {
      provider: 'fal-ai',
      endpointId: `${prefix}/image-to-video`,
      modes: [I2V, FLF2V],
      providerOutputSchema: PROVIDER_VIDEO_OUTPUT_SCHEMA,
      requestTimeoutSeconds: 2700,
      priority: 100,
    },
    {
      provider: 'fal-ai',
      endpointId: `${prefix}/reference-to-video`,
      modes: [MM2V],
      providerOutputSchema: PROVIDER_VIDEO_OUTPUT_SCHEMA,
      requestTimeoutSeconds: 2700,
      priority: 100,
    },
  ];
}

const SEEDANCE_MODES: AiGenerationMode[] = [T2V, I2V, FLF2V, MM2V];

export const VIDEO_MODELS: VideoModelSeed[] = [
  {
    slug: 'seedance-2-0',
    displayName: 'Seedance 2.0',
    family: 'seedance',
    description:
      'ByteDance Seedance 2.0 video — text/image/first-last-frame and omni reference, with native synced audio.',
    modes: SEEDANCE_MODES,
    tier: 'vip',
    cost: 600,
    parameterPolicy: SEEDANCE_2_0_PARAMETER_POLICY,
    productPricing: SEEDANCE_2_0_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 10,
    recommended: true,
    providers: seedanceProviders('bytedance/seedance-2.0'),
    providerAliases: ['bytedance/seedance-2.0'],
  },
  {
    slug: 'seedance-2-0-fast',
    displayName: 'Seedance 2.0 Fast',
    family: 'seedance',
    description:
      'ByteDance Seedance 2.0 Fast — same modes at a lower cost / faster turnaround (720p).',
    modes: SEEDANCE_MODES,
    tier: 'vip',
    cost: 484,
    parameterPolicy: SEEDANCE_2_0_PARAMETER_POLICY,
    productPricing: SEEDANCE_2_0_FAST_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 20,
    recommended: false,
    providers: seedanceProviders('bytedance/seedance-2.0/fast'),
    providerAliases: ['bytedance/seedance-2.0/fast'],
  },
];
