import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './auth.decorator';
import type { AuthUser } from './auth.types';

const DEV_USER: AuthUser = {
  userId: 'dev',
  userName: 'dev',
  nickName: 'Developer',
  userLevel: 'VIP3',
};

/**
 * Global NestJS guard that validates the session cookie on every request.
 *
 * - Extracts `cookie` header from the incoming request
 * - Calls AuthService.validateToken() to verify with Java backend
 * - Attaches AuthUser to `request.user` and raw cookie to `request.rawCookie`
 * - Rejects with 401 if token is invalid
 *
 * Endpoints decorated with @Public() skip authentication.
 * Set AUTH_DISABLED=true to skip auth in local dev (user info API unreachable).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if endpoint is marked as @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const cookie = request.headers?.cookie as string | undefined;

    // Dev mode: skip auth, attach mock user (only allowed in non-production)
    if (
      process.env.AUTH_DISABLED === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      request.user = DEV_USER;
      request.rawCookie = cookie ?? '';
      return true;
    }

    if (!cookie) {
      throw new UnauthorizedException('No session cookie');
    }

    const user = await this.authService.validateToken(cookie);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Attach to request for downstream use
    request.user = user;
    request.rawCookie = cookie;

    return true;
  }
}
