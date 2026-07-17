import { BadRequestException } from '@nestjs/common';
import { StoryTrailerProductionController } from './story-trailer-production.controller';
import { StoryTrailerProductionService } from './story-trailer-production.service';
import {
  CreateStoryTrailerVideoGenerationSchema,
  PutStoryTrailerVideoSelectionSchema,
} from './story-video-production.schema';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000003';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000004';

describe('StoryTrailerProductionService', () => {
  it('is a thin facade over the unified project video service', async () => {
    const production = {
      getTrailerSummary: jest.fn().mockResolvedValue({ selectionVersion: 0 }),
      createTrailerGeneration: jest
        .fn()
        .mockResolvedValue({ id: 'generation' }),
      putTrailerCurrentVideo: jest
        .fn()
        .mockResolvedValue({ selectionVersion: 1 }),
    };
    const service = new StoryTrailerProductionService(production as never);
    const recipe = CreateStoryTrailerVideoGenerationSchema.parse({
      expectedSelectionVersion: 0,
      prompt: 'Reveal the title over the moonlit garden.',
      modelId: 'seedance-2-0',
      mode: 'multimodal_to_video',
      durationMs: 10_000,
      references: [],
    });
    const selection = PutStoryTrailerVideoSelectionSchema.parse({
      expectedSelectionVersion: 0,
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
    });

    await service.getTrailer(USER, WORKSPACE_ID, PROJECT_ID);
    await service.createGeneration(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      recipe,
      'request-1',
    );
    await service.putCurrentVideo(USER, WORKSPACE_ID, PROJECT_ID, selection);

    expect(production.getTrailerSummary).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
    );
    expect(production.createTrailerGeneration).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      recipe,
      'request-1',
    );
    expect(production.putTrailerCurrentVideo).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      selection,
    );
  });
});

describe('StoryTrailerProductionController', () => {
  const recipe = CreateStoryTrailerVideoGenerationSchema.parse({
    expectedSelectionVersion: 0,
    prompt: 'Reveal the title over the moonlit garden.',
    modelId: 'seedance-2-0',
    mode: 'multimodal_to_video',
    durationMs: 10_000,
    references: [],
  });

  it('requires an explicit workspace and idempotency key', async () => {
    const service = { createGeneration: jest.fn() };
    const controller = new StoryTrailerProductionController(service as never);

    await expect(
      controller.createGeneration(
        USER,
        undefined,
        'request-1',
        { projectId: PROJECT_ID },
        recipe,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.createGeneration(
        USER,
        WORKSPACE_ID,
        undefined,
        { projectId: PROJECT_ID },
        recipe,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.createGeneration).not.toHaveBeenCalled();
  });

  it('passes the direct recipe to the trailer facade unchanged', async () => {
    const service = {
      createGeneration: jest.fn().mockResolvedValue({ id: 'generation-1' }),
    };
    const controller = new StoryTrailerProductionController(service as never);

    await expect(
      controller.createGeneration(
        USER,
        [WORKSPACE_ID],
        ['request-1'],
        { projectId: PROJECT_ID },
        recipe,
      ),
    ).resolves.toEqual({ code: 200, data: { id: 'generation-1' } });
    expect(service.createGeneration).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      recipe,
      'request-1',
    );
  });
});
