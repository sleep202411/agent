/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Partial model fixtures are intentionally structural casts. */
import type { AiModelDefinition } from '../ai-generation/types';
import { modelCompatibilityIssue } from './story-production-generation.service';

function model(overrides: Partial<AiModelDefinition>): AiModelDefinition {
  return {
    id: 'test-model',
    enabled: true,
    type: 'video',
    generationModes: [],
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        duration: { type: 'number' },
        referenceImages: { type: 'array', items: { type: 'string' } },
      },
      required: [],
    },
    ...overrides,
  } as unknown as AiModelDefinition;
}

function reference(kind: 'image' | 'video') {
  return { binding: { kind } } as never;
}

describe('modelCompatibilityIssue generation-mode authority', () => {
  it('rejects an i2v-only model for a text-only video request before quoting', () => {
    const klingMotion = model({
      id: 'kling-motion',
      generationModes: ['image_to_video'],
    });
    const issue = modelCompatibilityIssue(klingMotion, 'video', []);
    expect(issue).toEqual({
      code: 'STORY_GENERATION_MODEL_MODE_UNSUPPORTED',
      message: expect.stringContaining('image_to_video'),
    });
    expect(issue?.message).toContain('text-only video generation');
  });

  it('accepts an i2v-only model when an image reference resolves', () => {
    const klingMotion = model({
      id: 'kling-motion',
      generationModes: ['image_to_video'],
    });
    expect(
      modelCompatibilityIssue(klingMotion, 'video', [reference('image')]),
    ).toBeNull();
  });

  it('rejects a t2v-only model for an image-reference request', () => {
    const t2vOnly = model({
      id: 'quick-video',
      generationModes: ['text_to_video', 'multimodal_to_video'],
    });
    // multimodal_to_video can consume image references, so this passes.
    expect(
      modelCompatibilityIssue(t2vOnly, 'video', [reference('image')]),
    ).toBeNull();

    const strictlyT2v = model({ generationModes: ['text_to_video'] });
    expect(
      modelCompatibilityIssue(strictlyT2v, 'video', [reference('image')]),
    ).toEqual({
      code: 'STORY_GENERATION_MODEL_MODE_UNSUPPORTED',
      message: expect.stringContaining('image references'),
    });
  });

  it('keeps the schema-only checks for models without declared modes', () => {
    const undeclared = model({ generationModes: [] });
    expect(modelCompatibilityIssue(undeclared, 'video', [])).toBeNull();
  });

  it('still reports kind mismatch before mode mismatch', () => {
    const imageModel = model({
      type: 'image',
      generationModes: ['text_to_image'],
    });
    expect(modelCompatibilityIssue(imageModel, 'video', [])?.code).toBe(
      'STORY_GENERATION_MODEL_KIND_MISMATCH',
    );
  });
});
