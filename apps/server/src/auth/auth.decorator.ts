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
 * Bypasses only the product end-user session guard.
 *
 * Use this for machine-to-machine controllers that install their own
 * cryptographic guard. Unlike `@Public()`, the global guard must not treat an
 * `Authorization: Bearer` service JWT as an optional Java `satoken`.
 */
export const SKIP_END_USER_AUTH_KEY = 'skipEndUserAuth';
export const SkipEndUserAuth = () => SetMetadata(SKIP_END_USER_AUTH_KEY, true);

/**
 * Parameter decorator to extract the selected authenticated credential —
 * used when proxying requests to Java services that need the
 * viewer's verified satoken (e.g. UsersController → Java /user/query/user).
 * Duplicate or unrelated cookies are not forwarded when a satoken was selected.
 *
 * Returns "" when no cookie was sent.
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
