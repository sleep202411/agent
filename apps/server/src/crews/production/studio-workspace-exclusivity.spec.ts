import { NotFoundException } from '@nestjs/common';
import {
  CrewStudioWorkspaceService,
  workspaceLinkableWhere,
} from './studio-workspace.service';

describe('exclusive Crew workspace links', () => {
  it('excludes every linked workspace for new Crews, including deleted Crew links', () => {
    expect(workspaceLinkableWhere('owner')).toMatchObject({
      deletedAt: null,
      status: 'active',
      AND: expect.arrayContaining([{ studioCrew: null }]) as unknown,
    });
  });
  it('allows an existing Crew to keep its own link without permitting another Crew link', () => {
    expect(workspaceLinkableWhere('owner', 'crew')).toMatchObject({
      AND: expect.arrayContaining([
        { OR: [{ studioCrew: null }, { studioCrew: { id: 'crew' } }] },
      ]) as unknown,
    });
  });
  it('locks the target and refuses a workspace rejected by the exclusive ownership query', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      workspace: { findFirst: jest.fn().mockResolvedValue(null) },
      crew: { update: jest.fn() },
    };
    const auth = {
      require: jest.fn().mockResolvedValue({ isOwner: true, policyKeys: [] }),
    };
    const service = new CrewStudioWorkspaceService(
      { $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) } as never,
      auth as never,

      { revoke: jest.fn().mockResolvedValue(undefined) } as never,
    );
    await expect(
      service.link('crew', 'owner', 'workspace'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.workspace.findFirst).toHaveBeenCalledWith({
      where: { id: 'workspace', ...workspaceLinkableWhere('owner', 'crew') },
      select: { id: true, name: true },
    });
    expect(tx.crew.update).not.toHaveBeenCalled();
  });
});
