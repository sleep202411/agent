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
