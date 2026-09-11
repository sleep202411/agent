/** fal queue OpenAPI snapshots, verified 2026-09-11 for both Flare/Sunburst.
 * https://fal.ai/models/openai/gpt-image-2.5/flare/edit/api
 * Documentation/examples omitted; local refs expanded for standalone use.
 */
import type { Prisma } from '@prisma/client';

export const GPT_IMAGE_25_TEXT_SCHEMA = {
  properties: {
    sync_mode: {
      type: 'boolean',
      default: false,
    },
    quality: {
      type: 'string',
      enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
      default: 'high',
    },
    image_size: {
      anyOf: [
        {
          properties: {
            height: {
              exclusiveMinimum: 0,
              maximum: 14142,
              type: 'integer',
              default: 512,
            },
            width: {
              exclusiveMinimum: 0,
              maximum: 14142,
              type: 'integer',
              default: 512,
            },
          },
          type: 'object',
        },
        {
          type: 'string',
          enum: [
            'square_hd',
            'square',
            'portrait_4_3',
            'portrait_16_9',
            'landscape_4_3',
            'landscape_16_9',
            'auto',
          ],
        },
      ],
      default: 'landscape_4_3',
    },
    output_format: {
      type: 'string',
      enum: ['jpeg', 'png', 'webp'],
      default: 'png',
    },
    num_images: {
      maximum: 10,
      type: 'integer',
      minimum: 1,
      default: 1,
    },
    prompt: {
      maxLength: 32000,
      type: 'string',
      minLength: 1,
    },
    output_compression: {
      anyOf: [
        {
          maximum: 100,
          type: 'integer',
          minimum: 0,
        },
        {
          type: 'null',
        },
      ],
    },
    background: {
      type: 'string',
      enum: ['auto', 'transparent', 'opaque'],
      default: 'auto',
    },
  },
  required: ['prompt'],
  type: 'object',
} as const satisfies Prisma.InputJsonObject;

// The edit contract adds reference/mask inputs and changes only the size default.
export const GPT_IMAGE_25_EDIT_SCHEMA = {
  ...GPT_IMAGE_25_TEXT_SCHEMA,
  properties: {
    ...GPT_IMAGE_25_TEXT_SCHEMA.properties,
    image_size: {
      ...GPT_IMAGE_25_TEXT_SCHEMA.properties.image_size,
      default: 'auto',
    },
    image_urls: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    mask_url: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['prompt', 'image_urls'],
} as const satisfies Prisma.InputJsonObject;

export const GPT_IMAGE_25_OUTPUT_SCHEMA = {
  properties: {
    images: {
      type: 'array',
      items: {
        properties: {
          content_type: {
            anyOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          height: {
            anyOf: [
              {
                type: 'integer',
              },
              {
                type: 'null',
              },
            ],
          },
          file_size: {
            anyOf: [
              {
                type: 'integer',
              },
              {
                type: 'null',
              },
            ],
          },
          file_name: {
            anyOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          url: {
            type: 'string',
          },
          width: {
            anyOf: [
              {
                type: 'integer',
              },
              {
                type: 'null',
              },
            ],
          },
        },
        required: ['url'],
        type: 'object',
      },
    },
  },
  required: ['images'],
  type: 'object',
} as const satisfies Prisma.InputJsonObject;
