import {
  ConfirmStoryGenerationBatchSchema,
  QuoteStoryAssetGenerationBatchSchema,
} from './story-generation-batch.schema';

describe('Story generation batch schemas', () => {
  const target = {
    id: '019a034d-31a5-7d7f-8329-a91739a701b0',
    expectedVersion: 2,
  };

  it('requires the model id and schema version as an atomic selection', () => {
    expect(
      QuoteStoryAssetGenerationBatchSchema.safeParse({
        targets: [target],
        modelId: 'image-model',
      }).success,
    ).toBe(false);
    expect(
      QuoteStoryAssetGenerationBatchSchema.safeParse({
        targets: [target],
        modelId: 'image-model',
        schemaVersion: 'v1',
      }).success,
    ).toBe(true);
  });

  it('caps a creator-confirmed batch at 500 targets', () => {
    const targets = Array.from({ length: 501 }, (_, index) => ({
      id: `019a034d-31a5-7d7f-8329-${String(index).padStart(12, '0')}`,
      expectedVersion: 0,
    }));
    expect(
      QuoteStoryAssetGenerationBatchSchema.safeParse({ targets }).success,
    ).toBe(false);
  });

  it('requires optimistic concurrency when confirming a quote', () => {
    expect(
      ConfirmStoryGenerationBatchSchema.safeParse({ expectedVersion: 0 })
        .success,
    ).toBe(true);
    expect(ConfirmStoryGenerationBatchSchema.safeParse({}).success).toBe(false);
  });
});
