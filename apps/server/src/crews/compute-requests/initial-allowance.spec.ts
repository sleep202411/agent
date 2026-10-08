import { grantInitialTaskAllowance } from './initial-allowance';
import { readProjectBudget } from './project-budget';
jest.mock('./project-budget', () => ({
  ...jest.requireActual<typeof import('./project-budget')>('./project-budget'),
  readProjectBudget: jest.fn(),
}));
const task = {
  id: 'task',
  crewId: 'crew',
  title: 'Shot',
  computeBudgetPoints: 50,
};
function fixture() {
  const grants = new Map<string, { points: number }>();
  jest.mocked(readProjectBudget).mockResolvedValue({
    workspaceId: 'workspace',
    data: { settlement: null, stages: [{ points: 100 }] },
  } as never);
  const tx = {
    $executeRaw: jest.fn(),
    walletAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'wallet', status: 'active' }),
    },
    crewComputeRequest: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { crewId_userId_requestKey: { userId: string } };
        }) => grants.get(where.crewId_userId_requestKey.userId),
      ),
      aggregate: jest.fn(() => ({
        _sum: {
          points: [...grants.values()].reduce((n, x) => n + x.points, 0),
        },
      })),
      create: jest.fn(
        ({ data }: { data: { userId: string; points: number } }) => {
          grants.set(data.userId, data);
          return data;
        },
      ),
    },
  };
  return {
    tx,
    grants,
    run: (users: string[]) =>
      grantInitialTaskAllowance(tx as never, task, users, 'manager'),
  };
}
it('allocates once per task/person, including duplicate assignment and reassignment retries', async () => {
  const f = fixture();
  await f.run(['a', 'a']);
  await f.run(['a']);
  await f.run(['b']);
  expect(f.tx.crewComputeRequest.create).toHaveBeenCalledTimes(2);
  expect(f.tx.crewComputeRequest.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      status: 'approved',
      requestKey: 'task',
      points: 50,
      decidedByUserId: 'manager',
    }) as unknown,
  });
  await expect(f.run(['c'])).rejects.toThrow('exceed released');
});
it('fails closed for missing or closed budgets and never invents default points', async () => {
  const f = fixture();
  jest.mocked(readProjectBudget).mockResolvedValue(null);
  await expect(f.run(['a'])).rejects.toThrow('Configure');
  await grantInitialTaskAllowance(
    f.tx as never,
    { ...task, computeBudgetPoints: null },
    ['a'],
    'manager',
  );
  expect(f.tx.crewComputeRequest.create).not.toHaveBeenCalled();
});
