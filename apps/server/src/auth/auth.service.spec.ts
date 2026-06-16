import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';

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
    svc = new AuthService();
    calls = [];
    // Stub the per-token Java check: only a token containing FRESH resolves.
    jest
      .spyOn(
        svc as unknown as {
          validateSatoken: (c: string, h: string) => Promise<AuthUser | null>;
        },
        'validateSatoken',
      )
      .mockImplementation(async (satokenCookie: string) => {
        calls.push(satokenCookie);
        return satokenCookie.includes('FRESH')
          ? ({ userId: '42', nickName: 'Fresh' } as AuthUser)
          : null;
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

  it('falls back to the whole cookie when no satoken is present', async () => {
    await svc.validateToken('sessionid=abc');
    expect(calls).toEqual(['sessionid=abc']);
  });
});
