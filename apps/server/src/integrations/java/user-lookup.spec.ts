import { UsersController } from '../../users/users.controller';
import { UsersService } from '../../users/users.service';
import { Logger } from '@nestjs/common';
import { JavaUserLookupService } from './user-lookup.service';
jest.mock('./java-config', () => ({
  JAVA_CONTENT_URL: 'https://fixture.invalid',
  JAVA_REQUEST_TIMEOUT_MS: 5000,
  JAVA_USER_QUERY_PWD: 'fixture-secret',
}));
const contact = 'private.person@example.com';
const service = new JavaUserLookupService();
let fetcher: jest.SpyInstance;
let warn: jest.SpyInstance;
let errorLog: jest.SpyInstance;
beforeEach(() => {
  fetcher = jest.spyOn(globalThis, 'fetch');
  warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  errorLog = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
function response(body: unknown, status = 200) {
  fetcher.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}
describe.each(['contact', 'id'] as const)(
  '%s lookup response handling',
  (kind) => {
    const lookup = () =>
      kind === 'contact'
        ? service.findByContact(contact, 'fixture-cookie')
        : service.findByUserId('123', 'fixture-cookie');
    it('does not mask an upstream failure with empty info as not-found', async () => {
      response({ code: 503, info: null });
      await expect(lookup()).rejects.toMatchObject({
        status: 503,
        response: { upstreamCode: 503 },
      });
    });
    it('reports a malformed null envelope as an upstream failure', async () => {
      response(null);
      await expect(lookup()).rejects.toMatchObject({ status: 503 });
    });
    it('retains explicit not-found responses', async () => {
      response({ code: 404, info: null });
      await expect(lookup()).resolves.toBeNull();
    });
    it('retains successful public profile projection', async () => {
      response({
        code: 200,
        info: { id: 123, nickName: 'Creator', avatar: null, contact },
      });
      await expect(lookup()).resolves.toEqual({
        userId: '123',
        nickname: 'Creator',
        avatar: null,
      });
    });
  },
);
it('omits the contact and shared secret from transport failure logs', async () => {
  response({}, 502);
  await expect(
    service.findByContact(contact, 'fixture-cookie'),
  ).rejects.toMatchObject({ status: 503 });
  const logs = JSON.stringify({
    warnings: warn.mock.calls,
    errors: errorLog.mock.calls,
  });
  expect(logs).not.toContain(encodeURIComponent(contact));
  expect(logs).not.toContain(contact);
  expect(logs).not.toContain('fixture-secret');
});
it('does not echo contact information from an upstream error message', async () => {
  response({ code: 503, info: {}, msg: contact });
  await expect(
    service.findByContact(contact, 'fixture-cookie'),
  ).rejects.toMatchObject({ status: 503 });
  expect(JSON.stringify(warn.mock.calls)).not.toContain(contact);
});
it('keeps the documented by-id HTTP 500 not-found compatibility', async () => {
  response({}, 500);
  await expect(
    service.findByUserId('123', 'fixture-cookie'),
  ).resolves.toBeNull();
});
it('does not log request details echoed by a transport exception', async () => {
  fetcher.mockRejectedValue(
    new Error(`Request failed for ${contact} with fixture-secret`),
  );
  await expect(
    service.findByContact(contact, 'fixture-cookie'),
  ).rejects.toMatchObject({ status: 503 });
  const logs = JSON.stringify(errorLog.mock.calls);
  expect(logs).not.toContain(contact);
  expect(logs).not.toContain('fixture-secret');
});

it('sends the decoded public ID to the actual Java adapter and caches by raw ID', async () => {
  response({
    code: 200,
    info: {
      id: 18424,
      nickName: 'Creator',
      avatar: 'https://fixture.invalid/avatar.png',
    },
  });
  const redis = { get: jest.fn().mockResolvedValue(null), setex: jest.fn() };
  const users = new UsersService({} as never, service, redis as never);
  const controller = new UsersController(users, { guard: jest.fn() } as never);
  const result = await controller.byId(
    { userId: 'viewer' } as never,
    'fixture-cookie',
    '273848',
    undefined,
    'public',
  );
  expect(result.userId).toBe('18424');
  const calls = fetcher.mock.calls as Parameters<typeof fetch>[];
  const request = calls[0]?.[0];
  if (typeof request !== 'string')
    throw new Error('Expected a Java URL string');
  const url = new URL(request);
  expect(url.pathname).toBe('/user/other/user/info');
  expect(url.searchParams.get('UserId')).toBe('18424');
  expect(redis.get).toHaveBeenCalledWith('user-lookup:byId:18424');
});
