import { AuthService } from './auth.service';
import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './auth.types';
import type { EmergencyAccessBlockService } from './emergency-access-block.service';

const allowAll = () =>
  ({
    assertAllowed: () => Promise.resolve(),
  }) as unknown as EmergencyAccessBlockService;

/**
 * Regression guard for the prod login-loop fix: a browser can carry a stale
 * legacy `satoken` cookie alongside the fresh one, and `validateToken` must
 * validate EACH and accept the first that resolves — rather than blindly
 * trusting the first satoken in the header (which Java rejected → 401 loop).
 */
describe('AuthService.validateToken — multi-satoken (stale-cookie tolerance)', () => {
  let svc: AuthService;
  let calls: string[];

  beforeEach(() => {
    svc = new AuthService(allowAll());
    calls = [];
    // Stub the per-token Java check: only a token containing FRESH resolves.
    jest
      .spyOn(
        svc as unknown as {
          validateSatoken: (c: string, h: string) => Promise<AuthUser | null>;
        },
        'validateSatoken',
      )
      .mockImplementation((satokenCookie: string) => {
        calls.push(satokenCookie);
        return Promise.resolve(
          satokenCookie.includes('FRESH')
            ? ({ userId: '42', nickName: 'Fresh' } as AuthUser)
            : null,
        );
      });
  });

  afterEach(() => svc.onModuleDestroy());

  it('accepts the fresh satoken even when a stale one is listed first', async () => {
    const user = await svc.validateToken(
      'locale=zh-CN; satoken=STALE; satoken=FRESH',
    );
    expect(user?.userId).toBe('42');
    expect(calls).toEqual(['satoken=STALE', 'satoken=FRESH']);
  });

  it('returns the user with only the fresh credential that actually validated', async () => {
    await expect(
      svc.validateSessionContext('locale=zh-CN; satoken=STALE; satoken=FRESH'),
    ).resolves.toEqual({
      user: { userId: '42', nickName: 'Fresh' },
      cookie: 'satoken=FRESH',
    });
    expect(calls).toEqual(['satoken=STALE', 'satoken=FRESH']);
  });

  it('keeps the cached selected account and forwarding credential together when both candidates are valid', async () => {
    jest
      .spyOn(
        svc as unknown as {
          validateSatoken: (cookie: string) => Promise<AuthUser | null>;
        },
        'validateSatoken',
      )
      .mockImplementation((cookie) => {
        calls.push(cookie);
        return Promise.resolve({
          userId: cookie === 'satoken=ACCOUNT_A' ? 'account-a' : 'account-b',
        });
      });
    await svc.validateToken('satoken=ACCOUNT_B');
    await expect(
      svc.validateSessionContext(
        'locale=en-US; satoken=ACCOUNT_A; satoken=ACCOUNT_B',
      ),
    ).resolves.toEqual({
      user: { userId: 'account-b' },
      cookie: 'satoken=ACCOUNT_B',
    });
    expect(calls).toEqual(['satoken=ACCOUNT_B']);
    await expect(
      svc.validateSessionContext('satoken=ACCOUNT_A; satoken=ACCOUNT_B', {
        bypassCache: true,
      }),
    ).resolves.toEqual({
      user: { userId: 'account-a' },
      cookie: 'satoken=ACCOUNT_A',
    });
  });

  it('preserves the verified cookie fallback when no satoken is present', async () => {
    await expect(
      svc.validateSessionContext('sessionid=FRESH'),
    ).resolves.toEqual({
      user: { userId: '42', nickName: 'Fresh' },
      cookie: 'sessionid=FRESH',
    });
  });

  it('returns null when no satoken validates', async () => {
    const user = await svc.validateToken('satoken=STALE1; satoken=STALE2');
    expect(user).toBeNull();
    expect(calls).toEqual(['satoken=STALE1', 'satoken=STALE2']);
  });

  it('dedupes identical satoken values', async () => {
    await svc.validateToken('satoken=STALE; satoken=STALE');
    expect(calls).toEqual(['satoken=STALE']);
  });

  it('caches a success so the second call short-circuits', async () => {
    await svc.validateToken('satoken=FRESH');
    await svc.validateToken('satoken=FRESH');
    expect(calls).toEqual(['satoken=FRESH']);
  });

  it('bypassCache re-fetches Java so levelIds are not stale', async () => {
    await svc.validateToken('satoken=FRESH');
    await svc.validateToken('satoken=FRESH', { bypassCache: true });
    expect(calls).toEqual(['satoken=FRESH', 'satoken=FRESH']);
  });

  it('reuses a valid token across cookie reordering and unrelated cookies', async () => {
    await svc.validateToken('locale=en-US; satoken=FRESH');
    const user = await svc.validateToken(
      'analytics=changed; satoken=STALE; satoken=FRESH; locale=zh-CN',
    );

    expect(user?.userId).toBe('42');
    expect(calls).toEqual(['satoken=FRESH']);
  });

  it('coalesces concurrent remote validation for the same token', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest
      .spyOn(
        svc as unknown as {
          validateSatoken: (c: string, h: string) => Promise<AuthUser | null>;
        },
        'validateSatoken',
      )
      .mockImplementation(async (satokenCookie: string) => {
        calls.push(satokenCookie);
        await gate;
        return { userId: '42', nickName: 'Fresh' };
      });

    const first = svc.validateToken('satoken=FRESH');
    const second = svc.validateToken('locale=zh-CN; satoken=FRESH');
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { userId: '42', nickName: 'Fresh' },
      { userId: '42', nickName: 'Fresh' },
    ]);
    expect(calls).toEqual(['satoken=FRESH']);
  });

  it('falls back to the whole cookie when no satoken is present', async () => {
    await svc.validateToken('sessionid=abc');
    expect(calls).toEqual(['sessionid=abc']);
  });
});

it('checks the emergency blocklist even when Java authentication is cached', async () => {
  const block = { assertAllowed: jest.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    block as unknown as EmergencyAccessBlockService,
  );
  const java = jest.spyOn(
    service as unknown as {
      validateSatoken: () => Promise<AuthUser | null>;
    },
    'validateSatoken',
  );
  java.mockResolvedValue({ userId: '16591' });
  try {
    await service.validateToken('satoken=fixture');
    block.assertAllowed.mockRejectedValue(new ForbiddenException());
    await expect(
      service.validateToken('satoken=fixture'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(java).toHaveBeenCalledTimes(1);
    expect(block.assertAllowed).toHaveBeenCalledTimes(2);
  } finally {
    service.onModuleDestroy();
  }
});

describe('Auth refresh snapshot ownership', () => {
  let service: AuthService;
  const oldUser = { userId: '42', levelIds: [13] };
  const newUser = { userId: '42', levelIds: [] };
  function gate() {
    let resolve!: (user: AuthUser | null) => void;
    const promise = new Promise<AuthUser | null>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  beforeEach(() => {
    service = new AuthService(allowAll());
  });
  afterEach(() => service.onModuleDestroy());
  function remote() {
    return jest.spyOn(
      service as unknown as { validateSatoken: () => Promise<AuthUser | null> },
      'validateSatoken',
    );
  }
  it.each([false, true])(
    'prevents an older refresh from overwriting a newer snapshot (older bypass=%s)',
    async (bypassCache) => {
      const old = gate();
      const current = gate();
      const check = remote()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const first = service.validateToken('satoken=fixture', { bypassCache });
      const second = service.validateToken('satoken=fixture', {
        bypassCache: true,
      });
      current.resolve(newUser);
      await expect(second).resolves.toEqual(newUser);
      old.resolve(oldUser);
      await first;
      await expect(service.validateToken('satoken=fixture')).resolves.toEqual(
        newUser,
      );
      expect(check).toHaveBeenCalledTimes(2);
    },
  );
  it('makes normal readers await a forced refresh instead of returning a stale cache', async () => {
    const current = gate();
    const check = remote()
      .mockResolvedValueOnce(oldUser)
      .mockReturnValueOnce(current.promise);
    await service.validateToken('satoken=fixture');
    const refresh = service.validateToken('satoken=fixture', {
      bypassCache: true,
    });
    const ordinary = service.validateToken('satoken=fixture');
    current.resolve(newUser);
    await expect(Promise.all([refresh, ordinary])).resolves.toEqual([
      newUser,
      newUser,
    ]);
    expect(check).toHaveBeenCalledTimes(2);
  });
  it('does not revive an older success after a newer rejected refresh', async () => {
    const old = gate();
    const check = remote()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(newUser);
    const first = service.validateToken('satoken=fixture');
    await expect(
      service.validateToken('satoken=fixture', { bypassCache: true }),
    ).resolves.toBeNull();
    old.resolve(oldUser);
    await first;
    await expect(service.validateToken('satoken=fixture')).resolves.toEqual(
      newUser,
    );
    expect(check).toHaveBeenCalledTimes(3);
  });
});

describe('Auth verification status parsing', () => {
  let service: AuthService;
  const originalUrl = process.env.JAVA_CONTENT_URL;
  beforeEach(() => {
    process.env.JAVA_CONTENT_URL = 'http://fixture';
    service = new AuthService(allowAll());
  });
  afterEach(() => {
    service.onModuleDestroy();
    if (originalUrl === undefined) delete process.env.JAVA_CONTENT_URL;
    else process.env.JAVA_CONTENT_URL = originalUrl;
  });
  it.each(['', 'unknown', 'False', '0', 'TRUE', 0, 1, null])(
    'does not treat malformed status %s as clearance',
    async (needAuth) => {
      jest
        .spyOn(
          service as unknown as { getJson: () => Promise<unknown> },
          'getJson',
        )
        .mockResolvedValue({ success: true, data: { needAuth } });
      await expect(
        service.needsRealNameVerification('satoken=fixture'),
      ).resolves.toBeNull();
    },
  );
  it.each([true, false, 'true', 'false'])(
    'retains the supported %s status',
    async (needAuth) => {
      jest
        .spyOn(
          service as unknown as { getJson: () => Promise<unknown> },
          'getJson',
        )
        .mockResolvedValue({ success: true, data: { needAuth } });
      await expect(
        service.needsRealNameVerification('satoken=fixture'),
      ).resolves.toBe(needAuth === true || needAuth === 'true');
    },
  );
  it.each([
    { success: false, needAuth: false },
    { code: 302, data: { needAuth: false } },
    { success: true, code: 500, info: { needAuth: false } },
  ])('rejects an explicitly failed envelope %j', async (body) => {
    jest
      .spyOn(
        service as unknown as { getJson: () => Promise<unknown> },
        'getJson',
      )
      .mockResolvedValue(body);
    await expect(
      service.needsRealNameVerification('satoken=fixture'),
    ).resolves.toBeNull();
  });
  it('preserves the existing unwrapped boolean contract', async () => {
    jest
      .spyOn(
        service as unknown as { getJson: () => Promise<unknown> },
        'getJson',
      )
      .mockResolvedValue({ needAuth: false });
    await expect(
      service.needsRealNameVerification('satoken=fixture'),
    ).resolves.toBe(false);
  });
});
