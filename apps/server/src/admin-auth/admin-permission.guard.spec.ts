import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ADMIN_ANY_PERMISSIONS_KEY,
  ADMIN_PERMISSIONS_KEY,
} from './admin-auth.decorator';
import { AdminPermissionGuard } from './admin-permission.guard';
import { ADMIN_PERMISSION_KEYS } from './admin-auth.constants';

function context(permissions: string[], roleKeys: string[] = []) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ admin: { permissions, roleKeys } }),
    }),
  } as never;
}

it('allows media uploads when the actor only has AI-actor write access', () => {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === ADMIN_ANY_PERMISSIONS_KEY
        ? [ADMIN_PERMISSION_KEYS.MediaRead, ADMIN_PERMISSION_KEYS.AiActorsWrite]
        : undefined,
  } as unknown as Reflector;
  const guard = new AdminPermissionGuard(reflector);
  expect(
    guard.canActivate(context([ADMIN_PERMISSION_KEYS.AiActorsWrite])),
  ).toBe(true);
});

it('lets super_admin open AI演员 without a stored ai_actors permission', () => {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === ADMIN_PERMISSIONS_KEY
        ? [ADMIN_PERMISSION_KEYS.AiActorsRead]
        : undefined,
  } as unknown as Reflector;
  const guard = new AdminPermissionGuard(reflector);
  expect(guard.canActivate(context([], ['super_admin']))).toBe(true);
});

it('denies media uploads without media read or AI-actor write', () => {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === ADMIN_ANY_PERMISSIONS_KEY
        ? [ADMIN_PERMISSION_KEYS.MediaRead, ADMIN_PERMISSION_KEYS.AiActorsWrite]
        : key === ADMIN_PERMISSIONS_KEY
          ? undefined
          : undefined,
  } as unknown as Reflector;
  const guard = new AdminPermissionGuard(reflector);
  expect(() =>
    guard.canActivate(context([ADMIN_PERMISSION_KEYS.CoursesRead])),
  ).toThrow(ForbiddenException);
});
