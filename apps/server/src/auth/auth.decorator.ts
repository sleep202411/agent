import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { AuthUser } from './auth.types';

/**
 * Parameter decorator to extract the authenticated user from the request.
 *
 * Usage:
 *   @Post('chat')
 *   async chat(@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
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
