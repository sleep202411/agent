import { PositionsController } from './positions.controller';
const crewId = '01910d50-4c88-7c78-92d4-16892c06a010';
const user = { userId: 'owner', levelIds: [13] };
function build(fresh: unknown) {
  const create = jest.fn();
  const validateToken = jest.fn().mockResolvedValue(fresh);
  return {
    create,
    validateToken,
    controller: new PositionsController(
      { create } as never,
      { validateToken } as never,
    ),
  };
}
it('uses fresh producer qualification when publishing public recruitment', async () => {
  const t = build(user);
  await t.controller.create(
    crewId,
    { ...user, levelIds: [] },
    'cookie',
    {} as never,
  );
  expect(t.validateToken).toHaveBeenCalledWith('cookie', { bypassCache: true });
  expect(t.create).toHaveBeenCalledWith(crewId, 'owner', {}, [13]);
});
it.each([
  null,
  { userId: 'owner', levelIds: [] },
  { userId: 'other', levelIds: [13] },
])(
  'does not authorize from stale or mismatched qualification',
  async (fresh) => {
    const t = build(fresh);
    await t.controller.create(crewId, user, 'cookie', {} as never);
    expect(t.create).toHaveBeenCalledWith(crewId, 'owner', {}, []);
  },
);
it('does not require a producer lookup for private task recruitment', async () => {
  const t = build(null);
  const body = { recruitmentVisibility: 'private', taskId: crewId } as const;
  await t.controller.create(
    crewId,
    { ...user, levelIds: [] },
    'cookie',
    body as never,
  );
  expect(t.validateToken).not.toHaveBeenCalled();
  expect(t.create).toHaveBeenCalledWith(crewId, 'owner', body, []);
});
