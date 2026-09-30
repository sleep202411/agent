import { CreateCrewTaskSchema, UpdateCrewTaskSchema } from './dto';
it('preserves zero cash and zero profit share independently', () => {
  expect(
    CreateCrewTaskSchema.parse({
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
