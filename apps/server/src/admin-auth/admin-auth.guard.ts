import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import type { AdminAuthenticatedRequest } from './admin-auth.types';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly adminAuth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const sessionToken = extractAdminToken(request);
    const actor = await this.adminAuth.validateSession(sessionToken, {
      ipAddress: request.ip,
      userAgent: headerValue(request.headers['user-agent']),
    });
    request.admin = actor;
    request.adminSessionToken = sessionToken;
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

function extractAdminToken(
  request: AdminAuthenticatedRequest,
): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)fd_admin_session=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
