import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth';
import { RateLimitService } from '../common/throttle/rate-limit.service';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CertificatesService } from './certificates.service';
import {
  CertificateUserParamsSchema,
  VerifyCertificateQuerySchema,
  type CertificateUserParams,
  type VerifyCertificateQuery,
} from './dto';

@Controller('certificates')
export class CertificatesController {
  constructor(
    private readonly certificates: CertificatesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Get('verify')
  async verify(
    @Req() req: Request,
    @Query(new ZodValidationPipe(VerifyCertificateQuerySchema))
    query: VerifyCertificateQuery,
  ) {
    await this.rateLimit.guard({
      bucket: 'certificate-verify',
      actorId: requestActor(req),
      max: 30,
      windowSec: 60,
    });

    return this.certificates.verify(query.certNo);
  }

  @Public()
  @Get('users/:userId')
  async listForUser(
    @Req() req: Request,
    @Param(new ZodValidationPipe(CertificateUserParamsSchema))
    params: CertificateUserParams,
  ) {
    await this.rateLimit.guard({
      bucket: 'certificate-list',
      actorId: `${requestActor(req)}:${params.userId}`,
      max: 120,
      windowSec: 60,
    });

    return this.certificates.listForUser(params.userId);
  }
}

function requestActor(req: Request): string {
  const forwardedFor = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
}
