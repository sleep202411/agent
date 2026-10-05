import { encodeUserId } from '@repo/shared/user-id-codec';
import { UsersController } from './users.controller';
import { InvitesController } from '../sharing/invites.controller';
const viewer = { userId: 'viewer' } as never;
function fixture() {
  const service = {
    lookupByContact: jest.fn().mockResolvedValue({ userId: '1' }),
    lookupByUserId: jest.fn().mockResolvedValue({ userId: '1' }),
    lookupByUserIds: jest.fn().mockResolvedValue([{ userId: '1' }]),
  };
  const rateLimit = { guard: jest.fn().mockResolvedValue(undefined) };
  return {
    service,
    controller: new UsersController(service as never, rateLimit as never),
  };
}
describe('query values must be scalar strings', () => {
  it.each([{ value: ['first', 'second'] }, { value: { id: '1' } }])(
    'rejects malformed user ids before lookup: %j',
    async ({ value }) => {
      const { controller, service } = fixture();
      await expect(
        controller.byId(viewer, '', value as never),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        controller.byIds(viewer, '', value as never),
      ).rejects.toMatchObject({ status: 400 });
      expect(service.lookupByUserId).not.toHaveBeenCalled();
      expect(service.lookupByUserIds).not.toHaveBeenCalled();
    },
  );
  it.each(['account', 'email', 'phone', 'checkCrewId'] as const)(
    'rejects repeated %s parameters before contact lookup',
    async (key) => {
      const { controller, service } = fixture();
      const query: Record<string, unknown> = {
        account: 'viewer@example.com',
        [key]: ['first', 'second'],
      };
      await expect(
        controller.lookup(
          viewer,
          '',
          query.account as never,
          query.email as never,
          query.phone as never,
          query.checkCrewId as never,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(service.lookupByContact).not.toHaveBeenCalled();
    },
  );
  it('preserves valid contact lookup, id lists and empty lists', async () => {
    const { controller, service } = fixture();
    await controller.lookup(viewer, '', ' viewer@example.com ');
    expect(service.lookupByContact).toHaveBeenCalledWith({
      account: 'viewer@example.com',
      cookie: '',
      checkCrewId: undefined,
    });
    await expect(controller.byIds(viewer, '', undefined)).resolves.toEqual({
      users: [],
    });
    await controller.byIds(viewer, '', '1,2');
    expect(service.lookupByUserIds).toHaveBeenCalledWith(['1', '2'], '');
  });
  it.each([
    { value: ['token-one', 'token-two'] },
    { value: { token: 'token-one' } },
  ])(
    'rejects malformed invitation tokens before hashing: %j',
    async ({ value }) => {
      const workspace = { findByHash: jest.fn() };
      const controller = new InvitesController(
        workspace as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await expect(
        controller.preview(value as never, viewer),
      ).rejects.toMatchObject({ status: 400 });
      expect(workspace.findByHash).not.toHaveBeenCalled();
    },
  );
});

it('routes a user ID with crew context without using contact lookup', async () => {
  const { controller, service } = fixture();
  await controller.byId(viewer, 'cookie', '273848', 'crew');
  expect(service.lookupByUserId).toHaveBeenCalledWith(
    '273848',
    'cookie',
    'crew',
  );
  expect(service.lookupByContact).not.toHaveBeenCalled();
  await expect(
    controller.byId(viewer, 'cookie', '273848', ['crew', 'other'] as never),
  ).rejects.toMatchObject({ status: 400 });
});

it.each(['18424', '1234567', '90000001'])(
  'decodes displayed IDs before raw Java lookup: %s',
  async (rawId) => {
    const { controller, service } = fixture();
    await controller.byId(
      viewer,
      'cookie',
      encodeUserId(rawId),
      'crew',
      'public',
    );
    expect(service.lookupByUserId).toHaveBeenCalledWith(
      rawId,
      'cookie',
      'crew',
    );
  },
);
it.each(['bad', ['public', 'raw'], { type: 'public' }])(
  'rejects invalid ID formats: %j',
  async (format) => {
    const { controller, service } = fixture();
    await expect(
      controller.byId(viewer, '', '273848', undefined, format as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(service.lookupByUserId).not.toHaveBeenCalled();
  },
);
it('rejects invalid encoded IDs before calling Java', async () => {
  const { controller, service } = fixture();
  await expect(
    controller.byId(viewer, '', 'u_invalid', undefined, 'public'),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.lookupByUserId).not.toHaveBeenCalled();
});
