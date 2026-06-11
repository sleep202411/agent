import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from './auth.types';

/**
 * Parameter decorator to extract the authenticated user from the request.
 *
 * Usage:
 *   @Post('chat')
 *   async chat(@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);

/**
 * Mark an endpoint as public — skips AuthGuard validation.
 *
 * Usage:
 *   @Public()
 *   @Get('health')
 *   health() { return 'ok'; }
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Parameter decorator to extract the raw forwarded cookie string —
 * used when proxying requests to Java services that need the
 * viewer's satoken (e.g. UsersController → Java /user/query/user).
 *
 * Returns "" when no cookie was sent (AUTH_DISABLED dev mode).
 *
 * Usage:
 *   @Get('lookup')
 *   async lookup(@ViewerCookie() cookie: string) { ... }
 */
export const ViewerCookie = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    return request.rawCookie ?? '';
  },
);
