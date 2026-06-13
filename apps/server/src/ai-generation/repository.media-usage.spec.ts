import { MediaAssetUsageRole, MediaAssetUsageSurface } from '@prisma/client';
import { AiGenerationRepository } from './repository';

describe('AiGenerationRepository media usage', () => {
  it('replaces output usage rows when replacing AI outputs', async () => {
    const tx = {
      aiJob: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-1',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          sourceSurface: 'fizzstudio-canvas',
        }),
      },
      mediaAssetVariant: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'variant-1', assetId: 'asset-1' }]),
      },
      mediaAssetUsage: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      aiJobOutput: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (inner: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    const repository = new AiGenerationRepository(prisma as never);

    await (
      repository as unknown as {
        replaceOutputs: (
          jobId: string,
          outputs: Array<Record<string, unknown>>,
        ) => Promise<void>;
      }
    ).replaceOutputs('11111111-1111-7111-9111-111111111111', [
      {
        id: 'output-1',
        assetId: 'asset-1',
        type: 'image',
        url: 'https://cdn.example.com/output.png',
        storagePath: 'path/output.png',
        contentHash: 'abc123',
        width: 1024,
        height: 1024,
        mimeType: 'image/png',
        bytes: 1234,
        outputIndex: 0,
        createdAt: '2026-06-12T12:00:00.000Z',
      },
    ]);

    expect(tx.mediaAssetUsage.deleteMany).toHaveBeenCalledWith({
      where: {
        aiJobId: '11111111-1111-7111-9111-111111111111',
        role: MediaAssetUsageRole.output,
      },
    });
    expect(tx.mediaAssetUsage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          assetId: 'asset-1',
          variantId: 'variant-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          aiJobId: '11111111-1111-7111-9111-111111111111',
          aiJobOutputId: 'output-1',
          surface: MediaAssetUsageSurface.canvas,
          sourceSurface: 'fizzstudio-canvas',
          role: MediaAssetUsageRole.output,
          idempotencyKey:
            'ai-output:11111111-1111-7111-9111-111111111111:output-1',
        }),
      ],
    });
  });
});
