import {
  AiProviderAssetGroupStatus,
  AiProviderAssetGroupType,
  AiProviderExternalAssetStatus,
  MediaAssetKind,
} from '@prisma/client';
import { MediaAssetProviderSyncService } from './media-asset-provider-sync.service';

const ASSET_ID = '0197f4a2-0800-7000-8000-000000000001';
const GROUP_ID = '0197f4a2-0800-7000-8000-000000000002';
const MIRROR_ID = '0197f4a2-0800-7000-8000-000000000003';

type QueueAddCall = [
  name: string,
  payload: { op: string; mirrorId: string },
  options: { jobId: string; priority?: number; delay?: number },
];

type MirrorUpdateCall = [
  input: {
    where: { id: string; status: AiProviderExternalAssetStatus };
    data: {
      status: AiProviderExternalAssetStatus;
      statusReason: string | null;
    };
  },
];

function mirror(
  status: AiProviderExternalAssetStatus,
  externalAssetId: string | null = null,
  kind: MediaAssetKind = MediaAssetKind.image,
) {
  return {
    id: MIRROR_ID,
    mediaAssetId: ASSET_ID,
    providerAssetGroupId: GROUP_ID,
    externalAssetId,
    status,
    statusReason:
      status === AiProviderExternalAssetStatus.failed ? 'provider_error' : null,
    providerResponse: null,
    lastSyncedAt: null,
    processingDeadline: new Date('2026-07-23T12:30:00.000Z'),
    createdAt: new Date('2026-07-23T12:00:00.000Z'),
    updatedAt: new Date('2026-07-23T12:00:00.000Z'),
    mediaAsset: {
      id: ASSET_ID,
      kind,
      createdByUserId: 'user-1',
      workspaceId: null,
    },
    assetGroup: {
      id: GROUP_ID,
      provider: 'byteplus-modelark',
      externalGroupId: 'provider-group-1',
      groupType: AiProviderAssetGroupType.aigc,
      projectName: 'test',
      status: AiProviderAssetGroupStatus.active,
    },
  };
}

function serviceFixture() {
  const add = jest.fn().mockResolvedValue({});
  const createAsset = jest.fn().mockResolvedValue({ Id: 'provider-asset-1' });
  const resolvePublicUrl = jest
    .fn()
    .mockReturnValue('https://cdn.example.com/asset');
  const tx = {
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue({ id: ASSET_ID, metadata: null }),
    },
    aiProviderMediaAssetGroup: {
      findFirst: jest.fn().mockResolvedValue({ id: GROUP_ID }),
    },
    aiProviderMediaAssetMirror: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ next_seq: 2n }]),
    aiEventOutbox: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue({ id: ASSET_ID }),
    },
    aiProviderMediaAssetGroup: {
      findUnique: jest.fn().mockResolvedValue({
        id: GROUP_ID,
        status: AiProviderAssetGroupStatus.active,
      }),
    },
    aiProviderMediaAssetMirror: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const service = new MediaAssetProviderSyncService(
    prisma as never,
    {
      config: {
        mediaAssetRegistrationEnabled: true,
        projectName: 'test',
      },
    } as never,
    { createAsset } as never,
    { resolvePublicUrl } as never,
  );
  Reflect.set(service, 'assetsQueue', { add });
  return { service, prisma, tx, add, createAsset, resolvePublicUrl };
}

describe('MediaAssetProviderSyncService manual media checks', () => {
  it('idempotently re-kicks a pending registration', async () => {
    const fixture = serviceFixture();
    fixture.prisma.aiProviderMediaAssetMirror.findUnique.mockResolvedValue(
      mirror(AiProviderExternalAssetStatus.pending),
    );

    await expect(
      fixture.service.requestAssetRegistration(ASSET_ID),
    ).resolves.toMatchObject({
      assetId: ASSET_ID,
      status: AiProviderExternalAssetStatus.pending,
    });
    const registerCall = fixture.add.mock.calls[0] as QueueAddCall;
    expect(registerCall[0]).toBe('register');
    expect(registerCall[1]).toEqual({
      op: 'register',
      mirrorId: MIRROR_ID,
    });
    // BullMQ rejects custom job ids containing ':' (Redis key separator) at
    // add time — a violation 500s the user-facing readiness request.
    expect(registerCall[2].jobId).not.toContain(':');
    expect(registerCall[2].jobId).toMatch(
      new RegExp(`^register-${MIRROR_ID}-manual-`),
    );
  });

  it('restarts a failed registration without a provider identity', async () => {
    const fixture = serviceFixture();
    const failed = mirror(AiProviderExternalAssetStatus.failed);
    const pending = {
      ...failed,
      status: AiProviderExternalAssetStatus.pending,
      statusReason: null,
      updatedAt: new Date('2026-07-23T12:01:00.000Z'),
    };
    fixture.tx.aiProviderMediaAssetMirror.findUnique.mockResolvedValue(failed);
    fixture.prisma.aiProviderMediaAssetMirror.findUnique
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(pending);

    await expect(
      fixture.service.requestAssetRegistration(ASSET_ID),
    ).resolves.toMatchObject({
      assetId: ASSET_ID,
      status: AiProviderExternalAssetStatus.pending,
      statusReason: null,
    });
    const updateCall = fixture.tx.aiProviderMediaAssetMirror.updateMany.mock
      .calls[0] as MirrorUpdateCall;
    expect(updateCall[0].where).toEqual({
      id: MIRROR_ID,
      status: AiProviderExternalAssetStatus.failed,
    });
    expect(updateCall[0].data).toMatchObject({
      status: AiProviderExternalAssetStatus.pending,
      statusReason: null,
    });
    expect(fixture.add).toHaveBeenCalledWith(
      'register',
      { op: 'register', mirrorId: MIRROR_ID },
      expect.any(Object),
    );
  });

  it('resumes polling when a failed check already has a provider identity', async () => {
    const fixture = serviceFixture();
    const failed = mirror(
      AiProviderExternalAssetStatus.failed,
      'provider-asset-1',
    );
    const processing = {
      ...failed,
      status: AiProviderExternalAssetStatus.processing,
      statusReason: null,
      updatedAt: new Date('2026-07-23T12:01:00.000Z'),
    };
    fixture.tx.aiProviderMediaAssetMirror.findUnique.mockResolvedValue(failed);
    fixture.prisma.aiProviderMediaAssetMirror.findUnique
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(processing);

    await expect(
      fixture.service.requestAssetRegistration(ASSET_ID),
    ).resolves.toMatchObject({
      status: AiProviderExternalAssetStatus.processing,
    });
    const pollCall = fixture.add.mock.calls[0] as QueueAddCall;
    expect(pollCall[0]).toBe('poll');
    expect(pollCall[1]).toEqual({ op: 'poll', mirrorId: MIRROR_ID });
    expect(pollCall[2].jobId).not.toContain(':');
    expect(pollCall[2].jobId).toMatch(new RegExp(`^poll-${MIRROR_ID}-manual-`));
  });

  it.each([
    [MediaAssetKind.image, 'Image'],
    [MediaAssetKind.video, 'Video'],
  ] as const)(
    'registers %s assets with the matching provider type',
    async (kind, assetType) => {
      const fixture = serviceFixture();
      const register = Reflect.get(fixture.service, 'register') as (
        row: ReturnType<typeof mirror>,
      ) => Promise<void>;

      await register.call(
        fixture.service,
        mirror(AiProviderExternalAssetStatus.pending, null, kind),
      );

      expect(fixture.createAsset).toHaveBeenCalledWith({
        groupId: 'provider-group-1',
        url: 'https://cdn.example.com/asset',
        assetType,
        name: ASSET_ID,
      });
    },
  );
});
