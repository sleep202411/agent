import { UsersService } from './users.service';
jest.mock('./avatar', () => ({
  resolveUserAvatar: (avatar: string | null) =>
    Promise.resolve(avatar ?? 'fallback'),
}));
const profile = { userId: '123', nickname: 'Creator', avatar: null };
function fixture(cached: unknown) {
  const redis = {
    get: jest.fn().mockResolvedValue(JSON.stringify(cached)),
    setex: jest.fn().mockResolvedValue('OK'),
  };
  const java = {
    findByUserId: jest.fn().mockResolvedValue(profile),
    findByContact: jest.fn().mockResolvedValue(profile),
  };
  return {
    java,
    service: new UsersService({} as never, java as never, redis as never),
  };
}
describe('user cache recovery', () => {
  it.each([
    { cached: [] },
    { cached: {} },
    { cached: { ...profile, nickname: 7 } },
    { cached: { ...profile, avatar: {} } },
  ])('reloads an invalid stored profile: %j', async ({ cached }) => {
    const { java, service } = fixture(cached);
    await expect(
      service.lookupByUserId('123', 'cookie'),
    ).resolves.toMatchObject({ userId: '123', nickname: 'Creator' });
    expect(java.findByUserId).toHaveBeenCalledWith('123', 'cookie');
  });
  it('reloads a mismatched cached identity instead of displaying another user', async () => {
    const { java, service } = fixture({ ...profile, userId: '456' });
    await expect(
      service.lookupByUserId('123', 'cookie'),
    ).resolves.toMatchObject({ userId: '123' });
    expect(java.findByUserId).toHaveBeenCalledWith('123', 'cookie');
  });
  it('reloads invalid contact cache records through the existing adapter', async () => {
    const { java, service } = fixture({ userId: '123' });
    await expect(
      service.lookupByContact({
        account: 'creator@example.com',
        cookie: 'cookie',
      }),
    ).resolves.toMatchObject({ userId: '123', nickname: 'Creator' });
    expect(java.findByContact).toHaveBeenCalled();
  });
  it('retains valid cache hits without upstream calls', async () => {
    const { java, service } = fixture(profile);
    await expect(
      service.lookupByUserId('123', 'cookie'),
    ).resolves.toMatchObject({ userId: '123', nickname: 'Creator' });
    expect(java.findByUserId).not.toHaveBeenCalled();
  });
});
