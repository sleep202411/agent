import type { WalletAccount } from '@prisma/client';
import { enqueueStoryBatchesResumableIfFunded } from './story-generation-batch-resumable-realtime';

function account(overrides: Partial<WalletAccount>): WalletAccount {
  return {
    id: 'account-1',
    ownerType: 'workspace',
    ownerId: 'workspace-1',
    currency: 'compute_point',
    balanceKind: 'consumable',
    availableBalance: 10_000n,
    heldBalance: 0n,
    version: 3,
    ...overrides,
  } as unknown as WalletAccount;
}

function makeTx(batches: unknown[]) {
  return {
    storyGenerationBatch: {
      findMany: jest.fn().mockResolvedValue(batches),
    },
  };
}

// The outbox enqueue is module-level; spy on its side effects through the
// tx boundary instead by stubbing the outbox table write the service makes.
jest.mock('../ai-generation/outbox.service', () => ({
  enqueueRealtimeEvent: jest.fn(),
}));

import { enqueueRealtimeEvent } from '../ai-generation/outbox.service';
const enqueueRealtimeEventMock = enqueueRealtimeEvent as jest.MockedFunction<
  typeof enqueueRealtimeEvent
>;

describe('enqueueStoryBatchesResumableIfFunded', () => {
  beforeEach(() => {
    enqueueRealtimeEventMock
      .mockReset()
      .mockResolvedValue({ outboxId: 'o', eventId: 'e', seq: 1n });
  });

  it('ignores debits and non-workspace compute pots', async () => {
    const tx = makeTx([]);
    await enqueueStoryBatchesResumableIfFunded(tx as never, account({}), -100n);
    await enqueueStoryBatchesResumableIfFunded(
      tx as never,
      account({ ownerType: 'user' }),
      100n,
    );
    await enqueueStoryBatchesResumableIfFunded(
      tx as never,
      account({ currency: 'community_point' as never }),
      100n,
    );
    expect(tx.storyGenerationBatch.findMany).not.toHaveBeenCalled();
    expect(enqueueRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('notifies only batches the new balance actually covers', async () => {
    const tx = makeTx([
      {
        id: 'batch-affordable',
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        items: [{ quotedPoints: 10 }],
      },
      {
        id: 'batch-too-pricey',
        storyProjectId: 'project-2',
        storyChapterId: 'chapter-2',
        items: [{ quotedPoints: 50_000 }],
      },
    ]);

    await enqueueStoryBatchesResumableIfFunded(
      tx as never,
      account({ availableBalance: 10_000n }),
      10_000n,
    );

    expect(enqueueRealtimeEventMock).toHaveBeenCalledTimes(1);
    const { channel, eventType, payload } =
      enqueueRealtimeEventMock.mock.calls[0][1];
    const event = payload as {
      kind: string;
      batches: unknown[];
      availableBalance: string;
    };
    expect(channel).toBe('wallet:workspace:workspace-1');
    expect(eventType).toBe('story_generation_batches_resumable');
    expect(event.kind).toBe('story_generation_batches_resumable');
    expect(event.batches).toEqual([
      {
        batchId: 'batch-affordable',
        projectId: 'project-1',
        chapterId: 'chapter-1',
        requiredPoints: '10',
      },
    ]);
    expect(event.availableBalance).toBe('10000');
  });

  it('stays silent when no blocked batch is funded', async () => {
    const tx = makeTx([
      {
        id: 'batch-too-pricey',
        storyProjectId: 'project-2',
        storyChapterId: 'chapter-2',
        items: [{ quotedPoints: 50_000 }],
      },
    ]);

    await enqueueStoryBatchesResumableIfFunded(
      tx as never,
      account({ availableBalance: 10_000n }),
      10_000n,
    );

    expect(enqueueRealtimeEventMock).not.toHaveBeenCalled();
  });
});

it('continues past a full unaffordable page and emits bounded notification pages', async () => {
  enqueueRealtimeEventMock.mockClear();
  const row = (id: string, quotedPoints: number) => ({
    id,
    storyProjectId: 'p',
    storyChapterId: id,
    items: [{ quotedPoints }],
  });
  const tx = makeTx([]);
  tx.storyGenerationBatch.findMany
    .mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => row(`expensive-${i}`, 50000)),
    )
    .mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => row(`funded-${i}`, 10)),
    )
    .mockResolvedValueOnce([row('last', 10)]);
  await enqueueStoryBatchesResumableIfFunded(tx as never, account({}), 100n);
  expect(enqueueRealtimeEventMock).toHaveBeenCalledTimes(2);
  expect(
    (
      enqueueRealtimeEventMock.mock.calls[0][1].payload as {
        batches: unknown[];
      }
    ).batches,
  ).toHaveLength(20);
  expect(
    (
      enqueueRealtimeEventMock.mock.calls[1][1].payload as {
        batches: unknown[];
      }
    ).batches,
  ).toHaveLength(1);
  expect(
    (
      tx.storyGenerationBatch.findMany.mock.calls[1] as [
        { where: { id: unknown } },
      ]
    )[0].where.id,
  ).toEqual({
    gt: 'expensive-19',
  });
  expect(
    (
      tx.storyGenerationBatch.findMany.mock.calls[2] as [
        { where: { id: unknown } },
      ]
    )[0].where.id,
  ).toEqual({
    gt: 'funded-19',
  });
});

it('uses the frozen payer for legacy batches rather than the project workspace', async () => {
  enqueueRealtimeEventMock.mockClear();
  const rows = [
    {
      id: 'personal-paid',
      workspaceId: 'project-workspace',
      billingSubjectType: 'workspace',
      billingSubjectId: 'personal-wallet',
    },
    {
      id: 'other-payer',
      workspaceId: 'personal-wallet',
      billingSubjectType: 'workspace',
      billingSubjectId: 'someone-else',
    },
  ].map((row) => ({
    ...row,
    storyProjectId: 'project',
    storyChapterId: 'chapter',
    items: [{ quotedPoints: 10 }],
  }));
  const tx = {
    storyGenerationBatch: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: {
            workspaceId?: string;
            billingSubjectType?: string;
            billingSubjectId?: string;
          };
        }) =>
          Promise.resolve(
            rows.filter((row) =>
              Object.entries(where).every(
                ([key, value]) =>
                  ![
                    'workspaceId',
                    'billingSubjectType',
                    'billingSubjectId',
                  ].includes(key) ||
                  row[
                    key as
                      | 'workspaceId'
                      | 'billingSubjectType'
                      | 'billingSubjectId'
                  ] === value,
              ),
            ),
          ),
      ),
    },
  };
  await enqueueStoryBatchesResumableIfFunded(
    tx as never,
    account({ ownerId: 'personal-wallet' }),
    100n,
  );
  expect(enqueueRealtimeEventMock).toHaveBeenCalledTimes(1);
  expect(enqueueRealtimeEventMock.mock.calls[0][1]).toMatchObject({
    channel: 'wallet:workspace:personal-wallet',
    payload: {
      batches: [
        {
          batchId: 'personal-paid',
          projectId: 'project',
          chapterId: 'chapter',
          requiredPoints: '10',
        },
      ],
    },
  });
});
