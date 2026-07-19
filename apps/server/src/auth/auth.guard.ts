import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './auth.decorator';
import type { AuthenticatedRequest, AuthUser } from './auth.types';

type GuardRequest = Request &
  Partial<Pick<AuthenticatedRequest, 'user' | 'rawCookie'>>;

const DEV_USER: AuthUser = {
  userId: 'dev',
  userName: 'dev',
  nickName: 'Developer',
};

/**
 * Global NestJS guard that validates the session cookie on every request.
 *
 * - Extracts `cookie` header from the incoming request
 * - Calls AuthService.validateToken() to verify with Java backend
 * - Attaches AuthUser to `request.user` and raw cookie to `request.rawCookie`
 * - Rejects with 401 if token is invalid
 *
 * Endpoints decorated with @Public() allow anonymous traffic, but still
 * attach `request.user` when a valid cookie is present. Public crew
 * endpoints use that optional user to decide whether to expose owner-only
 * state such as frozen positions.
 * Set AUTH_DISABLED=true to skip auth in local dev (user info API unreachable).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    // Native clients (mobile app) carry the satoken in an Authorization
    // bearer header instead of a browser cookie jar. Normalize it to the
    // cookie form Java expects; an explicit bearer wins over whatever the
    // OS cookie jar happens to still hold.
    const bearer =
      request.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const cookie = bearer ? `satoken=${bearer}` : request.headers.cookie;

    // Check if endpoint is marked as @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Dev mode still prefers a real browser session when one exists. This lets
    // local studio/admin flows exercise the same user-scoped wallet data as
    // production, while retaining the dev fallback when Java auth is unavailable.
    if (process.env.AUTH_DISABLED === 'true') {
      if (cookie) {
        const user = await this.authService.validateToken(cookie);
        if (user) {
          request.user = user;
          request.rawCookie = cookie;
          return true;
        }
      }
      request.user = DEV_USER;
      request.rawCookie = cookie ?? '';
      return true;
    }

    if (!cookie) {
      if (isPublic) return true;
      throw new UnauthorizedException('No session cookie');
    }

    const user = await this.authService.validateToken(cookie);
    if (!user) {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Attach to request for downstream use
    request.user = user;
    request.rawCookie = cookie;

    return true;
  }
}
