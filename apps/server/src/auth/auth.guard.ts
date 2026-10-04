import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY, SKIP_END_USER_AUTH_KEY } from './auth.decorator';
import type { AuthenticatedRequest } from './auth.types';

type GuardRequest = Request &
  Partial<Pick<AuthenticatedRequest, 'user' | 'rawCookie'>>;

/**
 * Global NestJS guard that validates the session cookie on every request.
 *
 * - Extracts `cookie` header from the incoming request
 * - Calls AuthService.validateSessionContext() to verify with Java backend
 * - Attaches the selected user and matching credential to the request
 * - Rejects with 401 if token is invalid
 *
 * Endpoints decorated with @Public() allow anonymous traffic, but still
 * attach `request.user` when a valid cookie is present. Public crew
 * endpoints use that optional user to decide whether to expose owner-only
 * state such as frozen positions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    const skipEndUserAuth = this.reflector.getAllAndOverride<boolean>(
      SKIP_END_USER_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipEndUserAuth) return true;

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

    if (!cookie) {
      if (isPublic) return true;
      throw new UnauthorizedException('No session cookie');
    }

    const session = await this.authService.validateSessionContext(cookie);
    if (!session) {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Attach to request for downstream use
    request.user = session.user;
    request.rawCookie = session.cookie;

    return true;
  }
}
