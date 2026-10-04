import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { AuthGuard } from './auth.guard';
import type { AuthService } from './auth.service';

describe('AuthGuard', () => {
  const request = {
    headers: {} as Record<string, string>,
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;

  beforeEach(() => {
    request.headers = {};
    delete (request as { user?: unknown }).user;
    delete (request as { rawCookie?: unknown }).rawCookie;
    delete process.env.AUTH_DISABLED;
  });

  it('ignores the removed AUTH_DISABLED bypass', async () => {
    process.env.AUTH_DISABLED = 'true';
    const guard = new AuthGuard(
      { validateSessionContext: jest.fn() } as never,
      { getAllAndOverride: () => false } as never,
    );
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('does not send a service bearer JWT through end-user validation', async () => {
    request.headers.authorization = 'Bearer service.jwt.signature';
    const validateSessionContext = jest.fn();
    const guard = new AuthGuard(
      { validateSessionContext } as unknown as AuthService,
      {
        getAllAndOverride: jest.fn().mockReturnValueOnce(true),
      } as unknown as Reflector,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(validateSessionContext).not.toHaveBeenCalled();
  });

  it('retains optional end-user authentication on public endpoints', async () => {
    request.headers.authorization = 'Bearer native-session';
    request.headers.cookie = 'satoken=other-browser-account';
    const user = { userId: 'user-1' };
    const validateSessionContext = jest
      .fn()
      .mockResolvedValue({ user, cookie: 'satoken=native-session' });
    const guard = new AuthGuard(
      { validateSessionContext } as unknown as AuthService,
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      } as unknown as Reflector,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(validateSessionContext).toHaveBeenCalledWith(
      'satoken=native-session',
    );
    expect((request as { user?: unknown }).user).toEqual(user);
    expect((request as { rawCookie?: string }).rawCookie).toBe(
      'satoken=native-session',
    );
  });

  it('attaches the credential selected by authentication instead of the mixed browser header', async () => {
    request.headers.cookie = 'satoken=account-a; satoken=account-b';
    const user = { userId: 'account-b' };
    const validateSessionContext = jest
      .fn()
      .mockResolvedValue({ user, cookie: 'satoken=account-b' });
    const guard = new AuthGuard(
      { validateSessionContext } as unknown as AuthService,
      {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((request as { user?: unknown }).user).toEqual(user);
    expect((request as { rawCookie?: string }).rawCookie).toBe(
      'satoken=account-b',
    );
  });

  it('leaves failed optional authentication anonymous without forwarding a credential', async () => {
    request.headers.cookie = 'satoken=expired';
    const guard = new AuthGuard(
      {
        validateSessionContext: jest.fn().mockResolvedValue(null),
      } as unknown as AuthService,
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      } as unknown as Reflector,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((request as { user?: unknown }).user).toBeUndefined();
    expect((request as { rawCookie?: string }).rawCookie).toBeUndefined();
  });

  it('still rejects protected endpoints without an end-user session', async () => {
    const guard = new AuthGuard(
      { validateSessionContext: jest.fn() } as unknown as AuthService,
      {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
