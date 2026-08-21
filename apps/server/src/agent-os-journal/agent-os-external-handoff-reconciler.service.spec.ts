import { AgentOsExternalHandoffReconcilerService } from './agent-os-external-handoff-reconciler.service';

const JOB_A = '11111111-1111-4111-8111-111111111111';
const JOB_B = '22222222-2222-4222-8222-222222222222';

describe('AgentOsExternalHandoffReconcilerService', () => {
  it('reconciles every stale registration without one failure blocking the batch', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { externalJobId: JOB_A },
          { externalJobId: JOB_B },
        ]),
    };
    const journal = {
      reconcileExternalHandoff: jest
        .fn()
        .mockRejectedValueOnce(new Error('first run is still locked'))
        .mockResolvedValueOnce({ events: [], snapshot: {} }),
    };
    const service = new AgentOsExternalHandoffReconcilerService(
      prisma as never,
      journal as never,
    );

    await service.drainOnce();

    expect(journal.reconcileExternalHandoff).toHaveBeenNthCalledWith(1, JOB_A);
    expect(journal.reconcileExternalHandoff).toHaveBeenNthCalledWith(2, JOB_B);
  });

  it('prevents overlapping local sweeps', async () => {
    let release!: () => void;
    const blocked = new Promise<Array<{ externalJobId: string }>>((resolve) => {
      release = () => resolve([]);
    });
    const prisma = { $queryRaw: jest.fn().mockReturnValue(blocked) };
    const journal = { reconcileExternalHandoff: jest.fn() };
    const service = new AgentOsExternalHandoffReconcilerService(
      prisma as never,
      journal as never,
    );

    const first = service.drainOnce();
    await service.drainOnce();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
