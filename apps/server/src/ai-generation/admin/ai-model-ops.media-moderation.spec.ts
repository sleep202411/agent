import {
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaModerationCaseStatus,
  MediaObjectPlacementStatus,
} from '@prisma/client';
import { AiModelOpsService } from './ai-model-ops.service';

function serializedAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-7111-9111-111111111111',
    kind: 'image',
    storageProvider: 'azure_blob',
    bucket: 'foundry-outputs',
    region: 'eastus2',
    objectKey: 'path/output.png',
    externalUrl: null,
    contentType: 'image/png',
    sizeBytes: BigInt(1234),
    width: 1024,
    height: 1024,
    durationSeconds: null,
    checksumSha256: null,
    visibility: 'private',
    status: MediaAssetStatus.ready,
    source: 'ai_output',
    moderationStatus: MediaAssetModerationStatus.blocked,
    moderationReason: 'policy',
    moderatedByAdminId: 'admin-1',
    moderatedAt: new Date('2026-06-12T12:00:00.000Z'),
    workspaceId: null,
    createdByUserId: 'user-1',
    metadata: {},
    createdAt: new Date('2026-06-12T12:00:00.000Z'),
    updatedAt: new Date('2026-06-12T12:00:00.000Z'),
    placements: [],
    variants: [],
    aiJobOutputs: [],
    ...overrides,
  };
}

describe('AiModelOpsService media moderation', () => {
  it('records a moderation case/action and queues CDN purge actions when blocking', async () => {
    type CreateCaseArg = {
      data: {
        assetId: string;
        status: MediaModerationCaseStatus;
        reasonCode: string;
        openedByAdminId: string;
        assignedAdminId: string;
      };
      select: { id: true };
    };
    type CreateActionArg = {
      data: {
        caseId: string;
        assetId: string;
        actionType: MediaModerationActionType;
        status: MediaModerationActionStatus;
      };
    };
    const createCase: jest.MockedFunction<
      (arg: CreateCaseArg) => Promise<{ id: string }>
    > = jest.fn().mockResolvedValue({ id: 'case-1' });
    const createAction: jest.MockedFunction<
      (arg: CreateActionArg) => Promise<{ id: string }>
    > = jest.fn().mockResolvedValue({ id: 'action-1' });
    const purgeTargets = [
      {
        id: 'placement-1',
        cdnProvider: 'azure_cdn',
        cdnCacheKey: '/path/output.png',
      },
    ];
    const tx = {
      mediaAsset: {
        update: jest.fn().mockResolvedValue(serializedAsset()),
      },
      mediaModerationCase: {
        create: createCase,
      },
      mediaModerationAction: {
        create: createAction,
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      mediaObjectPlacement: {
        findMany: jest.fn().mockResolvedValue(purgeTargets),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue({
          id: '11111111-1111-7111-9111-111111111111',
          moderationStatus: MediaAssetModerationStatus.approved,
        }),
      },
      $transaction: jest.fn((callback: (inner: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    const service = new AiModelOpsService(
      prisma as never,
      {
        resolve: jest
          .fn()
          .mockReturnValue('https://cdn.example.com/output.png'),
      } as never,
    );

    await service.updateAssetModeration(
      '11111111-1111-7111-9111-111111111111',
      'admin-1',
      {
        moderationStatus: MediaAssetModerationStatus.blocked,
        reason: 'policy',
      },
    );

    const caseArg = createCase.mock.calls[0]?.[0];
    if (!caseArg) throw new Error('moderation case create call missing');
    expect(caseArg.data).toMatchObject({
      assetId: '11111111-1111-7111-9111-111111111111',
      status: MediaModerationCaseStatus.actioned,
      reasonCode: 'manual_blocked',
      openedByAdminId: 'admin-1',
      assignedAdminId: 'admin-1',
    });
    expect(caseArg.select).toEqual({ id: true });

    const actionArg = createAction.mock.calls[0]?.[0];
    if (!actionArg) throw new Error('moderation action create call missing');
    expect(actionArg.data).toMatchObject({
      caseId: 'case-1',
      assetId: '11111111-1111-7111-9111-111111111111',
      actionType: MediaModerationActionType.takedown,
      status: MediaModerationActionStatus.completed,
    });
    expect(tx.mediaObjectPlacement.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['placement-1'] } },
      data: { status: MediaObjectPlacementStatus.purging },
    });
    expect(tx.mediaModerationAction.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          caseId: 'case-1',
          assetId: '11111111-1111-7111-9111-111111111111',
          placementId: 'placement-1',
          actionType: MediaModerationActionType.purge_cdn,
          status: MediaModerationActionStatus.pending,
          provider: 'azure_cdn',
        }),
      ],
    });
  });
});
