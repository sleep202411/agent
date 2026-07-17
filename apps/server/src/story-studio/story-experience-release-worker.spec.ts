/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Jest asymmetric matchers and mock.calls payloads are intentionally untyped in worker assertions. */
import { StoryExperienceReleaseWorkerService } from './story-experience-release-worker.service';

const PROJECT_ID = '019f60f4-b101-70d4-8000-000000000002';

describe('StoryExperienceReleaseWorkerService', () => {
  it('claims an expired crash row and reconciles via public identity only', async () => {
    const prisma = workerPrisma({ status: 'pending' });
    const releases = { reconcileProjectCurrent: jest.fn(() => undefined) };
    const worker = new StoryExperienceReleaseWorkerService(
      prisma as never,
      releases as never,
    );

    await worker.drainOnce();

    expect(prisma.storyExperiencePublication.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'publication-1',
        status: 'pending',
      }),
      data: expect.objectContaining({
        status: 'uncertain',
        reconciliationLeaseOwner: expect.any(String),
        reconciliationAttemptCount: { increment: 1 },
        lastReconciliationAttemptAt: expect.any(Date),
      }),
    });
    expect(releases.reconcileProjectCurrent).toHaveBeenCalledWith(
      PROJECT_ID,
      PROJECT_ID,
    );
    expect(releases.reconcileProjectCurrent).toHaveBeenCalledTimes(1);
  });

  it('backs off a failed authority lookup without revoking media', async () => {
    const prisma = workerPrisma({ status: 'uncertain' });
    const releases = {
      reconcileProjectCurrent: jest.fn(() => {
        throw new Error('Java current endpoint unavailable');
      }),
    };
    const worker = new StoryExperienceReleaseWorkerService(
      prisma as never,
      releases as never,
    );

    await worker.drainOnce();

    expect(prisma.storyExperiencePublication.updateMany).toHaveBeenCalledTimes(
      2,
    );
    const failure =
      prisma.storyExperiencePublication.updateMany.mock.calls[1][0];
    expect(failure.data).toEqual(
      expect.objectContaining({
        nextReconciliationAt: expect.any(Date),
        reconciliationLeaseOwner: null,
        lastReconciliationErrorDetail: 'Java current endpoint unavailable',
      }),
    );
    expect(failure.data).not.toHaveProperty('mediaAuthorizationRevokedAt');
    expect(failure.data).not.toHaveProperty('status', 'rejected');
  });

  it('does not overlap drains in one process', async () => {
    let finish: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const prisma = workerPrisma({ status: 'confirmed' });
    const releases = {
      reconcileProjectCurrent: jest.fn(() => wait),
    };
    const worker = new StoryExperienceReleaseWorkerService(
      prisma as never,
      releases as never,
    );

    const first = worker.drainOnce();
    await Promise.resolve();
    await worker.drainOnce();
    finish?.();
    await first;
    expect(releases.reconcileProjectCurrent).toHaveBeenCalledTimes(1);
  });

  it('treats a null reconciliation schedule as unscheduled', async () => {
    const prisma = workerPrisma({ status: 'uncertain' });
    const releases = { reconcileProjectCurrent: jest.fn(() => undefined) };
    const worker = new StoryExperienceReleaseWorkerService(
      prisma as never,
      releases as never,
    );

    await worker.drainOnce();

    expect(
      prisma.storyExperiencePublication.findMany.mock.calls[0][0].where.OR[1],
    ).toEqual(
      expect.objectContaining({
        status: 'uncertain',
        nextReconciliationAt: { lte: expect.any(Date) },
      }),
    );
    expect(
      prisma.storyExperiencePublication.findMany.mock.calls[0][0].where.OR[1],
    ).not.toHaveProperty('OR');
  });
});

function workerPrisma(input: {
  status: 'pending' | 'uncertain' | 'confirmed';
}) {
  const candidate = {
    id: 'publication-1',
    storyProjectId: PROJECT_ID,
    gameId: PROJECT_ID,
    status: input.status,
  };
  const claimed = {
    id: candidate.id,
    storyProjectId: candidate.storyProjectId,
    gameId: candidate.gameId,
    reconciliationAttemptCount: 1,
  };
  return {
    $queryRaw: jest.fn(() => [{ now: new Date() }]),
    storyExperiencePublication: {
      findMany: jest
        .fn()
        .mockReturnValueOnce([candidate])
        .mockReturnValueOnce([claimed]),
      updateMany: jest.fn(() => ({ count: 1 })),
    },
  };
}
