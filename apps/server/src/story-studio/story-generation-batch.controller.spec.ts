import { StoryGenerationBatchController } from './story-generation-batch.controller';

const USER = { userId: 'creator-1' };
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000001';
const CHAPTER_ID = '0197f4a2-0800-7000-8000-000000000002';
const BATCH_ID = '0197f4a2-0800-7000-8000-000000000003';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000004';

describe('StoryGenerationBatchController project scope', () => {
  it('quotes from project and chapter identity without a Workspace header', async () => {
    const result = { id: BATCH_ID, status: 'awaiting_confirmation' };
    const service = { quoteAssets: jest.fn().mockResolvedValue(result) };
    const controller = new StoryGenerationBatchController(service as never);
    const body = {
      targets: [{ id: ASSET_ID, expectedVersion: 2 }],
      outputKind: 'image' as const,
      options: {},
    };

    await expect(
      controller.quoteAssets(
        USER as never,
        'quote-key-1',
        { projectId: PROJECT_ID, chapterId: CHAPTER_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: result });
    expect(service.quoteAssets).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      'quote-key-1',
      body,
    );
  });

  it('reads a batch without accepting client Workspace identity as authority', async () => {
    const result = { id: BATCH_ID, status: 'running' };
    const service = { get: jest.fn().mockResolvedValue(result) };
    const controller = new StoryGenerationBatchController(service as never);

    await expect(
      controller.get(USER as never, {
        projectId: PROJECT_ID,
        chapterId: CHAPTER_ID,
        batchId: BATCH_ID,
      }),
    ).resolves.toEqual({ code: 200, data: result });
    expect(service.get).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
      BATCH_ID,
    );
  });

  it('still requires an idempotency key for quote creation', async () => {
    const service = { quoteAssets: jest.fn() };
    const controller = new StoryGenerationBatchController(service as never);

    await expect(
      controller.quoteAssets(
        USER as never,
        undefined,
        { projectId: PROJECT_ID, chapterId: CHAPTER_ID },
        {
          targets: [{ id: ASSET_ID, expectedVersion: 2 }],
          outputKind: 'image',
          options: {},
        },
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'REQUIRED_HEADER_MISSING',
        message: 'Idempotency-Key is required.',
      },
    });
    expect(service.quoteAssets).not.toHaveBeenCalled();
  });
});
