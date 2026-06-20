import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Machine-to-machine auth for the /internal/* surface (Java -> NestJS). Checks a
 * shared secret in `x-service-token` against INTERNAL_SERVICE_TOKEN.
 *
 * Fail-loud: if the secret isn't configured the guard rejects every call (503)
 * rather than silently allowing — the endpoints are unusable until an operator
 * sets the env. NOT user-auth (no satoken) and NOT admin-auth: a distinct,
 * narrowly-scoped service identity.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  private readonly token = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? '';

  canActivate(context: ExecutionContext): boolean {
    if (!this.token) {
      throw new ServiceUnavailableException({
        code: 'INTERNAL_AUTH_NOT_CONFIGURED',
        msg: 'Internal service auth is not configured.',
      });
    }
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-service-token'];
    const provided = (Array.isArray(header) ? header[0] : header) ?? '';
    if (!provided || !this.safeEqual(provided, this.token)) {
      throw new UnauthorizedException({
        code: 'INVALID_SERVICE_TOKEN',
        msg: 'Invalid or missing service token.',
      });
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
