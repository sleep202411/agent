import { CreateCrewTaskSchema, UpdateCrewTaskSchema } from './dto';
it('preserves zero cash and zero profit share independently', () => {
  expect(
    CreateCrewTaskSchema.parse({
      ...{
        description: 'Deliver work',
        taskKind: 'script',
        dueAt: '2099-10-03T00:00:00.000Z',
        rewardUsdMinor: 0,
      },
      title: 'Task',
      rewardUsdMinor: 0,
      profitShareBps: 0,
    }),
  ).toMatchObject({ rewardUsdMinor: 0, profitShareBps: 0 });
});
it.each([
  { rewardUsdMinor: -1 },
  { rewardUsdMinor: 1.5 },
  { profitShareBps: 10001 },
  { profitShareBps: -1 },
])('rejects invalid compensation %o', (input) => {
  expect(
    CreateCrewTaskSchema.safeParse({ title: 'Task', ...input }).success,
  ).toBe(false);
  expect(
    UpdateCrewTaskSchema.safeParse({ expectedVersion: 1, ...input }).success,
  ).toBe(false);
});
