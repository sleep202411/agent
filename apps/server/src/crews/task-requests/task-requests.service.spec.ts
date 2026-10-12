import { ForbiddenException } from '@nestjs/common';
import { CrewTaskRequestsService } from './task-requests.service';
import { taskRequestExecution } from './task-request-context';
import { POINTS_OPERATORS } from '../../admin-auth/admin-points-policy';
import type { AdminActor } from '../../admin-auth';
const admin = {
  id: POINTS_OPERATORS.global.producer,
  status: 'active',
  siteScope: 'global',
  sessionId: 'session',
} as AdminActor;
function fixture() {
  const row = {
    id: 'request',
    crewId: 'crew',
    requesterId: 'member',
    kind: 'manual',
    input: {
      title: 'Task',
      description: 'Draw scene',
      taskKind: 'art',
      dueAt: '2099-01-01T00:00:00.000Z',
      rewardUsdMinor: 0,
      assignees: [],
    },
    createdAt: new Date(),
    status: 'pending',
  };
  const effect = jest.fn().mockResolvedValue(undefined);
  const create = jest.fn(() => {
    const ctx = taskRequestExecution.getStore();
    expect(ctx?.requestId).toBe(row.id);
    ctx!.afterCommit.push(effect);
    return Promise.resolve({ id: 'task' });
  });
  const tx = {
    $queryRaw: jest.fn(),
    crewTaskCreationRequest: {
      findUnique: jest.fn(() => Promise.resolve({ ...row })),
      update: jest.fn(({ data }: { data: object }) =>
        Promise.resolve(Object.assign(row, data)),
      ),
    },
    adminAuditLog: { create: jest.fn() },
  };
  const db = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const result = await fn(tx);
      expect(effect).not.toHaveBeenCalled();
      return result;
    }),
  };
  const auth = { requireMembership: jest.fn() };
  const service = new CrewTaskRequestsService(
    db as never,
    auth as never,
    { get: () => ({ create }) } as never,
  );
  return { service, row, effect, create, tx, auth, db };
}
describe('Producer task decisions', () => {
  it('allows only the active regional producer, not Pax or generic admins', async () => {
    for (const actor of [
      { ...admin, id: POINTS_OPERATORS.global.pax },
      { ...admin, status: 'disabled' },
      { ...admin, siteScope: 'cn' },
    ]) {
      const f = fixture();
      await expect(
        f.service.decide(actor as AdminActor, 'request', 'approved', ''),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.db.$transaction).not.toHaveBeenCalled();
    }
  });
  it('approves once and audits in the creation transaction', async () => {
    const f = fixture();
    await expect(
      f.service.decide(admin, 'request', 'approved', 'Reviewed'),
    ).resolves.toMatchObject({ status: 'approved', result: { id: 'task' } });
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.effect).toHaveBeenCalledTimes(1);
    expect(f.tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
    f.effect.mockClear();
    await f.service.decide(admin, 'request', 'approved', 'retry');
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
  });
  it('rejects without creating tasks or allocating points', async () => {
    const f = fixture();
    await f.service.decide(admin, 'request', 'rejected', 'Revise');
    expect(f.create).not.toHaveBeenCalled();
    expect(f.row.status).toBe('rejected');
    await expect(
      f.service.decide(admin, 'request', 'approved', ''),
    ).rejects.toThrow('different decision');
  });
  it('rechecks membership and leaves a failed execution pending without publishing', async () => {
    const f = fixture();
    f.auth.requireMembership.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.decide(admin, 'request', 'approved', ''),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.row.status).toBe('pending');
    f.auth.requireMembership.mockResolvedValue(undefined);
    f.create.mockRejectedValue(new Error('Budget exhausted'));
    await expect(
      f.service.decide(admin, 'request', 'approved', ''),
    ).rejects.toThrow('Budget exhausted');
    expect(f.tx.crewTaskCreationRequest.update).not.toHaveBeenCalled();
    expect(f.effect).not.toHaveBeenCalled();
  });
});
