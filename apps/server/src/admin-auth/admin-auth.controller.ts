import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ADMIN_SESSION_COOKIE } from './admin-auth.constants';
import { CurrentAdmin } from './admin-auth.decorator';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import type { AdminActor } from './admin-auth.types';
import {
  AdminLoginSchema,
  AdminMfaVerifySchema,
  type AdminLoginInput,
  type AdminMfaVerifyInput,
} from './dto';

@Public()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(AdminLoginSchema)) body: AdminLoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.adminAuth.login(body, requestContext(request));
    if (outcome.kind === 'mfa') {
      return { code: 200, data: { mfa: outcome.challenge } };
    }
    const { result, sessionToken, expiresAt } = outcome;
    setAdminSessionCookie(response, sessionToken, expiresAt);
    return { code: 200, data: result };
  }

  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(
    @Body(new ZodValidationPipe(AdminMfaVerifySchema))
    body: AdminMfaVerifyInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { result, sessionToken, expiresAt } = await this.adminAuth.verifyMfa(
      body,
      requestContext(request),
    );
    setAdminSessionCookie(response, sessionToken, expiresAt);
    return { code: 200, data: result };
  }

  @UseGuards(AdminAuthGuard)
  @Get('me')
  me(@CurrentAdmin() admin: AdminActor) {
    return {
      code: 200,
      data: {
        user: {
          id: admin.id,
          email: admin.email,
          displayName: admin.displayName,
          status: admin.status,
          siteScope: admin.siteScope,
          roleKeys: admin.roleKeys,
          requireMfa: admin.requireMfa,
          mfaEnabledAt: admin.mfaEnabledAt,
          permissions: admin.permissions,
        },
        session: {
          id: admin.sessionId,
        },
      },
    };
  }

  @UseGuards(AdminAuthGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentAdmin() admin: AdminActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.adminAuth.logout(admin, requestContext(request));
    clearAdminSessionCookie(response);
    return { code: 200, data: { ok: true } };
  }
}

function requestContext(request: Request) {
  return {
    ipAddress: request.ip,
    userAgent: headerValue(request.headers['user-agent']),
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

function setAdminSessionCookie(
  response: Response,
  token: string,
  expiresAt: Date,
) {
  response.cookie(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

function clearAdminSessionCookie(response: Response) {
  response.clearCookie(ADMIN_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}
