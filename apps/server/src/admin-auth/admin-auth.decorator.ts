import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { AdminActor, AdminAuthenticatedRequest } from './admin-auth.types';

export const ADMIN_PERMISSIONS_KEY = 'admin:permissions';
export const ADMIN_ANY_PERMISSIONS_KEY = 'admin:any-permissions';

export const RequireAdminPermissions = (...permissions: string[]) =>
  SetMetadata(ADMIN_PERMISSIONS_KEY, permissions);

export const RequireAnyAdminPermissions = (...permissions: string[]) =>
  SetMetadata(ADMIN_ANY_PERMISSIONS_KEY, permissions);

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminActor => {
    const request = ctx.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    if (!request.admin) {
      throw new UnauthorizedException({
        code: 'ADMIN_CONTEXT_MISSING',
        msg: '后台登录状态异常，请重新登录。',
      });
    }
    return request.admin;
  },
);
