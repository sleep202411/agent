import { StoryProductionGenerationController } from './story-production-generation.controller';
import { StoryProductionPlanController } from './story-production-plan.controller';

const USER = { userId: 'creator-1' };
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000001';
const CHAPTER_ID = '0197f4a2-0800-7000-8000-000000000002';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000003';
const GENERATION_ID = '0197f4a2-0800-7000-8000-000000000004';
const SEQUENCE_ID = '0197f4a2-0800-7000-8000-000000000005';
const CLIP_ID = '0197f4a2-0800-7000-8000-000000000006';

describe('Story production API project scope', () => {
  it('manages Asset Specs without accepting Workspace identity', async () => {
    const list = [{ id: ASSET_ID }];
    const created = { id: ASSET_ID, version: 0 };
    const patched = { id: ASSET_ID, version: 3 };
    const archived = { id: ASSET_ID, version: 4, status: 'archived' };
    const production = {
      listAssetSpecs: jest.fn().mockResolvedValue(list),
      createAssetSpec: jest.fn().mockResolvedValue(created),
      patchAssetSpec: jest.fn().mockResolvedValue(patched),
      archiveAssetSpec: jest.fn().mockResolvedValue(archived),
    };
    const controller = new StoryProductionPlanController(production as never);
    const chapter = { projectId: PROJECT_ID, chapterId: CHAPTER_ID };
    const target = { ...chapter, assetSpecId: ASSET_ID };
    const create = {
      kind: 'location' as const,
      name: 'City Gate',
      imagePrompt: 'A rain-soaked city gate at night.',
    };
    const patch = { expectedVersion: 2, imagePrompt: 'A stable portrait.' };

    await expect(
      controller.listAssetSpecs(USER as never, chapter),
    ).resolves.toEqual({
      code: 200,
      data: list,
    });
    await expect(
      controller.createAssetSpec(
        USER as never,
        'create-key-1',
        chapter,
        create,
      ),
    ).resolves.toEqual({ code: 201, data: created });
    await expect(
      controller.patchAssetSpec(USER as never, 'patch-key-1', target, patch),
    ).resolves.toEqual({ code: 200, data: patched });
    await expect(
      controller.archiveAssetSpec(USER as never, 'archive-key-1', target, {
        expectedVersion: 3,
      }),
    ).resolves.toEqual({ code: 200, data: archived });
    expect(production.listAssetSpecs).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
    );
    expect(production.patchAssetSpec).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      ASSET_ID,
      'patch-key-1',
      patch,
    );
    expect(production.createAssetSpec).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      'create-key-1',
      create,
    );
    expect(production.archiveAssetSpec).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      ASSET_ID,
      'archive-key-1',
      { expectedVersion: 3 },
    );
  });

  it('creates and reads Asset generation state from project identity alone', async () => {
    const queued = { id: GENERATION_ID, status: 'in_queue' };
    const generations = {
      createAssetGeneration: jest.fn().mockResolvedValue(queued),
      getAssetGeneration: jest.fn().mockResolvedValue(queued),
    };
    const controller = new StoryProductionGenerationController(
      generations as never,
    );
    const target = {
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      assetSpecId: ASSET_ID,
    };
    const create = {
      expectedVersion: 2,
      outputKind: 'image' as const,
      options: {},
    };

    await expect(
      controller.createAssetGeneration(
        USER as never,
        'generate-key-1',
        target,
        create,
      ),
    ).resolves.toEqual({ code: 202, data: queued });
    await expect(
      controller.getAssetGeneration(USER as never, {
        ...target,
        generationId: GENERATION_ID,
      }),
    ).resolves.toEqual({ code: 200, data: queued });
    expect(generations.createAssetGeneration).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      ASSET_ID,
      'generate-key-1',
      create,
    );
    expect(generations.getAssetGeneration).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      ASSET_ID,
      GENERATION_ID,
    );
  });

  it('reads and edits Storyboard Specs without accepting Workspace identity', async () => {
    const state = { projectId: PROJECT_ID, chapterId: CHAPTER_ID };
    const storyboard = [{ id: SEQUENCE_ID }];
    const patched = { id: CLIP_ID, version: 3 };
    const production = {
      getProductionState: jest.fn().mockResolvedValue(state),
      getStoryboard: jest.fn().mockResolvedValue(storyboard),
      patchClip: jest.fn().mockResolvedValue(patched),
    };
    const controller = new StoryProductionPlanController(production as never);
    const chapter = { projectId: PROJECT_ID, chapterId: CHAPTER_ID };
    const target = { ...chapter, sequenceId: SEQUENCE_ID, clipId: CLIP_ID };
    const patch = { expectedVersion: 2, title: 'Closer shot' };

    await expect(
      controller.getProductionState(USER as never, chapter),
    ).resolves.toEqual({ code: 200, data: state });
    await expect(
      controller.getStoryboard(USER as never, chapter),
    ).resolves.toEqual({ code: 200, data: storyboard });
    await expect(
      controller.patchClip(USER as never, 'clip-patch-key-1', target, patch),
    ).resolves.toEqual({ code: 200, data: patched });
    expect(production.getProductionState).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
    );
    expect(production.getStoryboard).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
    );
    expect(production.patchClip).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      SEQUENCE_ID,
      CLIP_ID,
      'clip-patch-key-1',
      patch,
    );
  });

  it('creates and reads Storyboard generation state from project identity alone', async () => {
    const queued = { id: GENERATION_ID, status: 'in_queue' };
    const generations = {
      createStoryboardClipGeneration: jest.fn().mockResolvedValue(queued),
      getStoryboardClipGeneration: jest.fn().mockResolvedValue(queued),
    };
    const controller = new StoryProductionGenerationController(
      generations as never,
    );
    const target = {
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      sequenceId: SEQUENCE_ID,
      clipId: CLIP_ID,
    };
    const create = { expectedVersion: 2, options: {} };

    await expect(
      controller.createStoryboardClipGeneration(
        USER as never,
        'clip-generate-key-1',
        target,
        create,
      ),
    ).resolves.toEqual({ code: 202, data: queued });
    await expect(
      controller.getStoryboardClipGeneration(USER as never, {
        ...target,
        generationId: GENERATION_ID,
      }),
    ).resolves.toEqual({ code: 200, data: queued });
    expect(generations.createStoryboardClipGeneration).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      SEQUENCE_ID,
      CLIP_ID,
      'clip-generate-key-1',
      create,
    );
    expect(generations.getStoryboardClipGeneration).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      SEQUENCE_ID,
      CLIP_ID,
      GENERATION_ID,
    );
  });
});
