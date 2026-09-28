import {
  describeGenerationRequestShape,
  generationRequestShape,
  modelSupportsRequest,
  modesServingRequest,
  parseCanonicalGenerationModes,
} from './generation-mode-capability';

describe('generation-mode-capability', () => {
  describe('generationRequestShape', () => {
    it('derives a text-only shape when no references resolve', () => {
      expect(generationRequestShape('video', [])).toEqual({
        kind: 'video',
        imageReferences: 0,
        videoReferences: 0,
      });
    });

    it('counts image and video references independently', () => {
      expect(
        generationRequestShape('video', ['image', 'image', 'video']),
      ).toEqual({
        kind: 'video',
        imageReferences: 2,
        videoReferences: 1,
      });
    });
  });

  describe('modelSupportsRequest', () => {
    it('rejects an i2v-only model for a text-only video request (kling-motion class)', () => {
      const shape = generationRequestShape('video', []);
      expect(modelSupportsRequest(['image_to_video'], shape)).toBe(false);
    });

    it('accepts a t2v-capable model for a text-only video request', () => {
      const shape = generationRequestShape('video', []);
      expect(
        modelSupportsRequest(['text_to_video', 'image_to_video'], shape),
      ).toBe(true);
    });

    it('accepts an i2v-only model when an image reference resolves', () => {
      const shape = generationRequestShape('video', ['image']);
      expect(modelSupportsRequest(['image_to_video'], shape)).toBe(true);
    });

    it('accepts multimodal or first-last-frame models for image references', () => {
      const shape = generationRequestShape('video', ['image']);
      expect(modelSupportsRequest(['multimodal_to_video'], shape)).toBe(true);
      expect(modelSupportsRequest(['first_last_frame_to_video'], shape)).toBe(
        true,
      );
    });

    it('rejects a t2v-only model for image-reference requests', () => {
      const shape = generationRequestShape('video', ['image']);
      expect(
        modelSupportsRequest(['text_to_video', 'multimodal_to_video'], shape),
      ).toBe(true); // multimodal_to_video can consume image references
      expect(modelSupportsRequest(['text_to_video'], shape)).toBe(false);
    });

    it('requires a video-consuming mode for video references', () => {
      const shape = generationRequestShape('video', ['video']);
      expect(modelSupportsRequest(['video_to_video'], shape)).toBe(true);
      expect(modelSupportsRequest(['multimodal_to_video'], shape)).toBe(true);
      expect(modelSupportsRequest(['image_to_video'], shape)).toBe(false);
      expect(modelSupportsRequest(['text_to_video'], shape)).toBe(false);
    });

    it('rejects a text-only image model for image-reference image requests', () => {
      const shape = generationRequestShape('image', ['image']);
      expect(modelSupportsRequest(['text_to_image'], shape)).toBe(false);
      expect(modelSupportsRequest(['image_to_image'], shape)).toBe(true);
      expect(modelSupportsRequest(['reference_image_generation'], shape)).toBe(
        true,
      );
    });

    it('treats an empty declaration as supporting nothing (callers skip the check)', () => {
      const shape = generationRequestShape('video', []);
      expect(modelSupportsRequest([], shape)).toBe(false);
    });
  });

  describe('modesServingRequest', () => {
    it('prefers video-reference modes over image-reference modes when both are present', () => {
      const shape = generationRequestShape('video', ['image', 'video']);
      const serving = modesServingRequest(shape);
      expect(serving.has('video_to_video')).toBe(true);
      expect(serving.has('image_to_video')).toBe(false);
    });
  });

  describe('describeGenerationRequestShape', () => {
    it('produces actionable copy for each shape', () => {
      expect(
        describeGenerationRequestShape(generationRequestShape('video', [])),
      ).toBe('text-only video generation');
      expect(
        describeGenerationRequestShape(
          generationRequestShape('video', ['image']),
        ),
      ).toBe('video generation with image references');
      expect(
        describeGenerationRequestShape(
          generationRequestShape('image', ['video']),
        ),
      ).toBe('image generation with video references');
    });
  });

  describe('parseCanonicalGenerationModes', () => {
    it('filters non-string entries out of the JSONB column', () => {
      expect(
        parseCanonicalGenerationModes([
          'text_to_video',
          42,
          null,
          'image_to_video',
        ]),
      ).toEqual(['text_to_video', 'image_to_video']);
    });

    it('returns an empty list for non-array payloads', () => {
      expect(parseCanonicalGenerationModes(null)).toEqual([]);
      expect(parseCanonicalGenerationModes('text_to_video')).toEqual([]);
    });
  });
});
