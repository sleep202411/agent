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
      { validateToken: jest.fn() } as never,
      { getAllAndOverride: () => false } as never,
    );
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('does not send a service bearer JWT through end-user validation', async () => {
    request.headers.authorization = 'Bearer service.jwt.signature';
    const validateToken = jest.fn();
    const guard = new AuthGuard(
      { validateToken } as unknown as AuthService,
      {
        getAllAndOverride: jest.fn().mockReturnValueOnce(true),
      } as unknown as Reflector,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(validateToken).not.toHaveBeenCalled();
  });

  it('retains optional end-user authentication on public endpoints', async () => {
    request.headers.authorization = 'Bearer native-session';
    const user = { userId: 'user-1' };
    const validateToken = jest.fn().mockResolvedValue(user);
    const guard = new AuthGuard(
      { validateToken } as unknown as AuthService,
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      } as unknown as Reflector,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(validateToken).toHaveBeenCalledWith('satoken=native-session');
    expect((request as { user?: unknown }).user).toEqual(user);
  });

  it('still rejects protected endpoints without an end-user session', async () => {
    const guard = new AuthGuard(
      { validateToken: jest.fn() } as unknown as AuthService,
      {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
