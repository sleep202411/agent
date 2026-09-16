import { AirwallexProvider } from './airwallex.provider';

type Client = {
  getAccessToken(): Promise<string>;
  request(
    path: string,
    options: { method: 'POST'; token: string; body?: unknown },
  ): Promise<unknown>;
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
describe('Airwallex bounded authentication and API requests', () => {
  let provider: Client;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  const originalClient = process.env.AIRWALLEX_CLIENT_ID;
  const originalKey = process.env.AIRWALLEX_API_KEY;
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.AIRWALLEX_CLIENT_ID = 'fixture';
    process.env.AIRWALLEX_API_KEY = 'fixture';
    provider = new AirwallexProvider() as unknown as Client;
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (originalClient === undefined) delete process.env.AIRWALLEX_CLIENT_ID;
    else process.env.AIRWALLEX_CLIENT_ID = originalClient;
    if (originalKey === undefined) delete process.env.AIRWALLEX_API_KEY;
    else process.env.AIRWALLEX_API_KEY = originalKey;
  });
  const call = (kind: string) =>
    kind === 'authentication'
      ? provider.getAccessToken()
      : provider.request('/fixture', {
          method: 'POST',
          token: 'fixture',
          body: { intent: 'fixed' },
        });
  const response = (body: unknown, status = 200) =>
    ({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    }) as Response;
  it.each(['authentication', 'API'])(
    'bounds %s when fetch ignores abort, without automatic replay',
    async (kind) => {
      const pending = deferred<Response>();
      fetchSpy.mockReturnValueOnce(pending.promise);
      const operation = call(kind);
      const rejected = expect(operation).rejects.toMatchObject({
        response: { code: 'AIRWALLEX_REQUEST_TIMEOUT' },
      });
      await jest.advanceTimersByTimeAsync(30_000);
      await rejected;
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
      pending.resolve(response({ token: 'abandoned', id: 'abandoned' }));
      await jest.advanceTimersByTimeAsync(0);
      fetchSpy.mockResolvedValueOnce(
        response({ token: 'replacement', id: 'replacement' }),
      );
      expect(await call(kind)).toEqual(
        kind === 'authentication'
          ? 'replacement'
          : { token: 'replacement', id: 'replacement' },
      );
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(0);
    },
  );
  it.each(['authentication', 'API'])(
    'bounds a stalled %s body and suppresses late success',
    async (kind) => {
      const body = deferred<unknown>();
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => body.promise,
      } as Response);
      const operation = call(kind);
      const rejected = expect(operation).rejects.toMatchObject({
        response: { code: 'AIRWALLEX_REQUEST_TIMEOUT' },
      });
      await jest.advanceTimersByTimeAsync(30_000);
      await rejected;
      body.resolve({ token: 'abandoned', id: 'abandoned' });
      await jest.advanceTimersByTimeAsync(0);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
      fetchSpy.mockResolvedValueOnce(
        response({ token: 'replacement', id: 'replacement' }),
      );
      expect(await call(kind)).toEqual(
        kind === 'authentication'
          ? 'replacement'
          : { token: 'replacement', id: 'replacement' },
      );
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(0);
    },
  );
  it.each(['authentication', 'API'])(
    'releases the %s timer on success and retains provider failures',
    async (kind) => {
      fetchSpy.mockResolvedValueOnce(response({ token: 'valid', id: 'valid' }));
      expect(await call(kind)).toEqual(
        kind === 'authentication' ? 'valid' : { token: 'valid', id: 'valid' },
      );
      expect(jest.getTimerCount()).toBe(0);
      provider = new AirwallexProvider() as unknown as Client;
      fetchSpy.mockResolvedValueOnce(
        response({ message: 'provider detail' }, 503),
      );
      await expect(call(kind)).rejects.toMatchObject({
        response: {
          code:
            kind === 'authentication'
              ? 'AIRWALLEX_AUTH_FAILED'
              : 'AIRWALLEX_API_FAILED',
          details: { message: 'provider detail' },
        },
      });
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});
