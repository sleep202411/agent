import { HttpException, InternalServerErrorException } from '@nestjs/common';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';

const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const RUN_ID = '0197f4a2-0800-7000-8000-000000000003';

function serviceWithRows(
  rows: Array<{
    activeAgentRunId: string | null;
    lockedAt: Date | null;
    lockExpiresAt: Date | null;
    isLocked: boolean;
  }>,
) {
  const tx = { $queryRaw: jest.fn().mockResolvedValue(rows) };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  return {
    service: new StoryProjectWriteGuardService(prisma as never),
    prisma,
    tx,
  };
}

describe('StoryProjectWriteGuardService', () => {
  it('allows an unlocked project while holding the transaction row lock', async () => {
    const { service, tx } = serviceWithRows([
      {
        activeAgentRunId: null,
        lockedAt: null,
        lockExpiresAt: null,
        isLocked: false,
      },
    ]);

    await expect(
      service.assertHumanWriteAllowed(tx as never, PROJECT_ID),
    ).resolves.toBeUndefined();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects an effective Agent lease with the authoritative 423 payload', async () => {
    const expiresAt = new Date('2026-07-18T12:00:30.000Z');
    const { service, tx } = serviceWithRows([
      {
        activeAgentRunId: RUN_ID,
        lockedAt: new Date('2026-07-18T12:00:00.000Z'),
        lockExpiresAt: expiresAt,
        isLocked: true,
      },
    ]);

    let caught: unknown;
    try {
      await service.assertHumanWriteAllowed(tx as never, PROJECT_ID);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(423);
    expect((caught as HttpException).getResponse()).toEqual({
      code: 'STORY_AGENT_APPLYING',
      message:
        'The Story Agent owns the project write boundary while its run is applying or awaiting recovery.',
      storyProjectId: PROJECT_ID,
      runId: RUN_ID,
      retryAfter: expiresAt.toISOString(),
      recoveryPending: false,
    });
  });

  it('keeps an expired but recoverable Agent run reserved for worker takeover', async () => {
    const expiresAt = new Date('2026-07-18T11:59:59.000Z');
    const { service, tx } = serviceWithRows([
      {
        activeAgentRunId: RUN_ID,
        lockedAt: new Date('2026-07-18T11:59:30.000Z'),
        lockExpiresAt: expiresAt,
        isLocked: false,
      },
    ]);

    let caught: unknown;
    try {
      await service.assertHumanWriteAllowed(tx as never, PROJECT_ID);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(423);
    expect((caught as HttpException).getResponse()).toEqual(
      expect.objectContaining({
        code: 'STORY_AGENT_APPLYING',
        runId: RUN_ID,
        retryAfter: null,
        recoveryPending: true,
      }),
    );
  });

  it('defers a system write while an effective Agent lease is active', async () => {
    const { service, tx } = serviceWithRows([
      {
        activeAgentRunId: RUN_ID,
        lockedAt: new Date('2026-07-18T12:00:00.000Z'),
        lockExpiresAt: new Date('2026-07-18T12:00:30.000Z'),
        isLocked: true,
      },
    ]);

    await expect(
      service.tryAcquireDeferredWriteFence(tx as never, PROJECT_ID),
    ).resolves.toBe(false);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('defers a system write while an expired Agent run remains recoverable', async () => {
    const { service, tx } = serviceWithRows([
      {
        activeAgentRunId: RUN_ID,
        lockedAt: new Date('2026-07-18T11:59:30.000Z'),
        lockExpiresAt: new Date('2026-07-18T11:59:59.000Z'),
        isLocked: false,
      },
    ]);

    await expect(
      service.tryAcquireDeferredWriteFence(tx as never, PROJECT_ID),
    ).resolves.toBe(false);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('acquires the deferrable system-write fence only when no Agent run owns the project', async () => {
    const { service, tx } = serviceWithRows([
      {
        activeAgentRunId: null,
        lockedAt: null,
        lockExpiresAt: null,
        isLocked: false,
      },
    ]);

    await expect(
      service.tryAcquireDeferredWriteFence(tx as never, PROJECT_ID),
    ).resolves.toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('fails loud when the permanent project write-state invariant is broken', async () => {
    const { service, tx } = serviceWithRows([]);

    await expect(
      service.assertHumanWriteAllowed(tx as never, PROJECT_ID),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('fails loud instead of treating an incomplete lease as unlocked', async () => {
    const { service, tx } = serviceWithRows([
      {
        activeAgentRunId: RUN_ID,
        lockedAt: null,
        lockExpiresAt: null,
        isLocked: false,
      },
    ]);

    await expect(
      service.assertHumanWriteAllowed(tx as never, PROJECT_ID),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('uses the same row-locking assertion for the permission-layer preflight', async () => {
    const { service, prisma, tx } = serviceWithRows([
      {
        activeAgentRunId: null,
        lockedAt: null,
        lockExpiresAt: null,
        isLocked: false,
      },
    ]);

    await service.assertHumanWriteAllowedEarly(PROJECT_ID);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects an Agent claim while an accepted external release lease is active', async () => {
    const retryAfter = new Date('2026-07-18T12:00:30.000Z');
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          commandKind: 'draft_release',
          commandId: '0197f4a2-0800-7000-8000-000000000004',
          leaseExpiresAt: retryAfter,
        },
      ]),
    };
    const service = new StoryProjectWriteGuardService({} as never);

    let caught: unknown;
    try {
      await service.assertAgentClaimAllowed(tx as never, PROJECT_ID);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(423);
    expect((caught as HttpException).getResponse()).toEqual({
      code: 'STORY_EXTERNAL_COMMAND_IN_FLIGHT',
      message:
        'An accepted external Story command is still in flight. Retry after it settles.',
      storyProjectId: PROJECT_ID,
      commandKind: 'draft_release',
      commandId: '0197f4a2-0800-7000-8000-000000000004',
      retryAfter: retryAfter.toISOString(),
    });
  });

  it('allows an Agent claim when no durable external lease is active', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const service = new StoryProjectWriteGuardService({} as never);

    await expect(
      service.assertAgentClaimAllowed(tx as never, PROJECT_ID),
    ).resolves.toBeUndefined();
  });
});
