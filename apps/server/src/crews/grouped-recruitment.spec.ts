import { PositionsService } from './positions.service';
import { assertGroupedFee, groupedTaskAmount } from './task-recruitment';
import type { CreatePositionInput } from './dto';

function fixture() {
  const task = (id: string) => ({
    id,
    crewId: 'crew',
    version: 2,
    title: id,
    description: 'Design character',
    assignees: [],
    metadata: {
      requiredSkills: [id === 'a' ? 'Lighting' : 'Editing'],
      compensation: {
        rewardUsdMinor: 1200,
        rewardCurrency: 'USD',
        paymentTerms: 'on_completion',
      },
    },
  });
  const tx = {
    $executeRaw: jest.fn(),
    crewTask: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ workflowState: { semantic: 'open' } }),
      findFirstOrThrow: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(task(where.id)),
      ),
    },
    crewPosition: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(({ data }) =>
        Promise.resolve({
          ...data,
          status: 'open',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    },
  };
  const auth = { require: jest.fn() };
  const service = new PositionsService({} as never, auth as never);
  // Exercise the full bundle validation/write inside the existing authorized transaction boundary.
  jest
    .spyOn(service as never, 'positionWrite')
    .mockImplementation((...args: unknown[]) =>
      (args[3] as (tx: unknown) => Promise<unknown>)(tx),
    );
  const input = {
    tasks: [
      { id: 'a', expectedVersion: 2 },
      { id: 'b', expectedVersion: 2 },
    ],
    positionType: 'character_design',
    description: 'Characters',
    targetCount: 1,
    workMode: 'remote',
    employmentType: 'project_based',
    requiredSkills: [],
  } as CreatePositionInput;
  return { service, tx, input };
}
it('creates one posting with two task allocations and their combined fee', async () => {
  const { service, tx, input } = fixture();
  await service.create('crew', 'producer', input, [13]);
  expect(tx.crewPosition.create).toHaveBeenCalledTimes(1);
  const data = (
    tx.crewPosition.create.mock.calls[0][0] as { data: Record<string, unknown> }
  ).data;
  expect(data.requiredSkills).toEqual(['Lighting', 'Editing']);
  expect(data.taskId).toBeNull();
  expect(data.groupedTasks).toEqual({ connect: [{ id: 'a' }, { id: 'b' }] });
  expect(data.salaryMinAmount).toBe(2400n);
  expect(data.groupedTaskTerms).toEqual({
    a: { amount: 1200, currency: 'USD' },
    b: { amount: 1200, currency: 'USD' },
  });
});
it('rejects a stale task before publishing any posting', async () => {
  const { service, tx, input } = fixture();
  input.tasks![1].expectedVersion = 1;
  await expect(service.create('crew', 'producer', input, [13])).rejects.toThrow(
    'changed',
  );
  expect(tx.crewPosition.create).not.toHaveBeenCalled();
});
it('does not duplicate tasks that already have recruitment', async () => {
  const { service, tx, input } = fixture();
  tx.crewPosition.count.mockResolvedValue(1);
  await expect(service.create('crew', 'producer', input, [13])).rejects.toThrow(
    'already',
  );
  expect(tx.crewPosition.create).not.toHaveBeenCalled();
});
it('preserves task allocations instead of multiplying the total reward', () => {
  const terms = {
    a: { amount: 1200, currency: 'USD' },
    b: { amount: 2400, currency: 'USD' },
  };
  expect(groupedTaskAmount(terms, 'b')).toEqual({
    amount: 2400,
    currency: 'USD',
  });
  expect(() =>
    assertGroupedFee(terms, {
      feeAmount: '3600',
      currency: 'USD',
      feePeriod: 'project',
    }),
  ).not.toThrow();
  for (const value of [
    { feeAmount: '1200', currency: 'USD', feePeriod: 'project' },
    { feeAmount: '3600', currency: 'CNY', feePeriod: 'project' },
    { feeAmount: '3600', currency: 'USD', feePeriod: 'month' },
  ])
    expect(() => assertGroupedFee(terms, value)).toThrow('published total');
});
