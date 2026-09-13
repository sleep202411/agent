import { AiGenerationWorkerService } from './worker.service';

it('stores dimensions from generated image bytes when the provider returns only a URL', async () => {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const store = {
    createAiOutputAsset: jest.fn().mockResolvedValue('asset-image-1'),
  };
  const storage = {
    upload: jest.fn().mockResolvedValue({
      url: 'https://media.example.test/image.png',
      provider: 's3_compatible',
      bucket: 'media',
      region: 'auto',
      storagePath: 'image.png',
      bytes: bytes.length,
    }),
  };
  const worker = new AiGenerationWorkerService(
    store as never,
    {} as never,
    {} as never,
    storage as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { enqueueAutomaticChecks: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const internals = worker as unknown as {
    uploadOutputs: (
      job: Record<string, unknown>,
      outputs: Array<Record<string, unknown>>,
    ) => Promise<unknown>;
  };
  await internals.uploadOutputs(
    {
      id: 'image-job',
      userId: 'user-1',
      type: 'image',
      provider: 'bailian',
      modelId: 'wan-image-2.7',
      createdAt: '2026-09-12T00:00:00Z',
    },
    [
      {
        index: 0,
        type: 'image',
        buffer: bytes,
        mimeType: 'image/png',
        ext: 'png',
      },
    ],
  );
  expect(store.createAiOutputAsset).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ width: 1, height: 1 }),
  );
});
