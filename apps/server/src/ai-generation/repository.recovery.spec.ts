import { AiGenerationRepository } from './repository';

describe('canvas job recovery filters', () => {
  it('keeps the user boundary when batching task IDs without a shared document', async () => {
    const findMany = jest
      .fn<Promise<never[]>, [unknown]>()
      .mockResolvedValue([]);
    const repository = new AiGenerationRepository(
      { aiJob: { findMany } } as never,
      {} as never,
    );
    await repository.listForUser({
      userId: 'owner',
      ids: ['job-a', 'job-b'],
      limit: 100,
    });
    const query = findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(query.where).toEqual({
      userId: 'owner',
      id: { in: ['job-a', 'job-b'] },
      deletedAt: null,
    });
    expect(query.take).toBe(100);
  });

  it('finds an old receipt within the authorized document instead of scanning the latest 100 jobs', async () => {
    const findMany = jest
      .fn<Promise<never[]>, [unknown]>()
      .mockResolvedValue([]);
    const repository = new AiGenerationRepository(
      { aiJob: { findMany } } as never,
      {} as never,
    );
    await repository.listForUser({
      userId: 'collaborator',
      documentId: 'canvas',
      documentBlockId: 'node',
      idempotencyKey: 'receipt',
      includeCollaboratorJobs: true,
      limit: 1,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          documentId: 'canvas',
          documentBlockId: 'node',
          idempotencyKey: 'receipt',
        },
        take: 1,
      }),
    );
  });
});

describe('terminal failure barrier', () => {
  it('claims failure only from active states and leaves a lost race untouched', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findUnique = jest.fn();
    const tx = { aiJob: { updateMany, findUnique } };
    const repository = new AiGenerationRepository(
      {
        $transaction: (work: (client: typeof tx) => unknown) => work(tx),
      } as never,
      {} as never,
    );
    await expect(
      repository.failIfActive('job', {
        status: 'failed',
        completedAt: '2026-09-28T00:00:00Z',
      }),
    ).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'job',
          status: { in: ['created', 'in_queue', 'in_progress'] },
        },
        data: expect.objectContaining({
          status: 'failed',
          version: { increment: 1 },
        }) as unknown,
      }),
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});
