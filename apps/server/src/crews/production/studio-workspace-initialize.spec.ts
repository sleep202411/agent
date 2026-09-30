import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CrewStudioWorkspaceService } from './studio-workspace.service';

function fixture() {
  const crew = {
    name: 'Production',
    studioWorkspaceId: null as string | null,
    studioProjectId: null as string | null,
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    crew: {
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(() => Promise.resolve(crew)),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Partial<typeof crew> }) =>
          Promise.resolve(Object.assign(crew, data)),
        ),
    },
    workspace: {
      create: jest.fn().mockResolvedValue({ id: 'workspace', name: crew.name }),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'workspace', name: crew.name }),
    },
    walletAccount: {
      createMany: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ balance: 0n }),
    },
    crewProductionActivity: { create: jest.fn().mockResolvedValue({}) },
  };
  const auth = {
    require: jest.fn().mockResolvedValue({ isOwner: true, policyKeys: [] }),
  };
  const service = new CrewStudioWorkspaceService(
    {
      ...tx,
      $transaction: (fn: (db: typeof tx) => unknown) => Promise.resolve(fn(tx)),
    } as never,
    auth as never,

    { revoke: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { crew, tx, auth, service };
}

describe('existing Crew workspace initialization', () => {
  it('creates owner membership and audits once; retries reuse the same workspace', async () => {
    const f = fixture();
    expect(await f.service.initialize('crew', 'owner')).toMatchObject({
      created: true,
    });
    expect(await f.service.initialize('crew', 'owner')).toEqual({
      studioWorkspace: { id: 'workspace', name: 'Production' },
      created: false,
    });
    expect(f.tx.workspace.create).toHaveBeenCalledTimes(1);
    expect(f.tx.workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          members: {
            create: { userId: 'owner', role: 'owner', status: 'active' },
          },
        }) as unknown,
      }),
    );
    expect(f.tx.crewProductionActivity.create).toHaveBeenCalledTimes(1);
  });
  it('does not replace a legacy project or an unavailable workspace', async () => {
    const f = fixture();
    f.crew.studioProjectId = 'legacy';
    await expect(f.service.initialize('crew', 'owner')).rejects.toBeInstanceOf(
      ConflictException,
    );
    f.crew.studioProjectId = null;
    f.crew.studioWorkspaceId = 'deleted';
    f.tx.workspace.findFirst.mockResolvedValue(null);
    await expect(f.service.initialize('crew', 'owner')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.tx.workspace.create).not.toHaveBeenCalled();
  });
  it('rejects a non-admin and rechecks a revoked permission inside the transaction', async () => {
    const f = fixture();
    f.auth.require.mockResolvedValueOnce({ isOwner: false, policyKeys: [] });
    await expect(f.service.initialize('crew', 'reader')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    f.auth.require
      .mockResolvedValueOnce({ isOwner: true, policyKeys: [] })
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(f.service.initialize('crew', 'owner')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.tx.workspace.create).not.toHaveBeenCalled();
  });
});
