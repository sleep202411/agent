import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ADMIN_ANY_PERMISSIONS_KEY,
  ADMIN_PERMISSIONS_KEY,
} from './admin-auth.decorator';
import { ADMIN_ROLE_KEYS } from './admin-auth.constants';
import type { AdminAuthenticatedRequest } from './admin-auth.types';

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      ADMIN_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAny = this.reflector.getAllAndOverride<string[]>(
      ADMIN_ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length && !requiredAny?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const actor = request.admin;
    if (!actor) {
      throw new ForbiddenException({
        code: 'ADMIN_CONTEXT_MISSING',
        msg: '后台登录状态异常，请重新登录。',
      });
    }
    if (actor.roleKeys?.includes(ADMIN_ROLE_KEYS.SuperAdmin)) return true;
    const granted = new Set(actor.permissions);
    const missing = (required ?? []).filter(
      (permission) => !granted.has(permission),
    );
    if (missing.length) {
      throw new ForbiddenException({
        code: 'ADMIN_PERMISSION_DENIED',
        msg: '当前后台账号没有执行该操作的权限。',
        missing,
      });
    }
    if (
      requiredAny?.length &&
      !requiredAny.some((permission) => granted.has(permission))
    ) {
      throw new ForbiddenException({
        code: 'ADMIN_PERMISSION_DENIED',
        msg: '当前后台账号没有执行该操作的权限。',
        missing: requiredAny,
      });
    }
    return true;
  }
}
