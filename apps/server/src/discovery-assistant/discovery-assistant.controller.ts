import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  DiscoveryAssistantRequestSchema,
  DiscoveryReadRequestSchema,
} from '@repo/shared/discovery-assistant';
import { CurrentUser, type AuthUser } from '../auth';
import { SkipEndUserAuth } from '../auth/auth.decorator';
import { ZodValidationPipe } from '../common/zod.pipe';
import { DiscoveryAssistantService } from './discovery-assistant.service';
@Controller('content-gps/discovery')
export class DiscoveryAssistantController {
  constructor(private readonly service: DiscoveryAssistantService) {}
  @Post('requests')
  @HttpCode(200)
  async run(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DiscoveryAssistantRequestSchema))
    body: z.infer<typeof DiscoveryAssistantRequestSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const stop = () =>
      controller.abort(new Error('Discovery caller disconnected'));
    response.once('close', stop);
    const timeout = setTimeout(
      () => controller.abort(new Error('Discovery request timed out')),
      50_000,
    );
    try {
      return {
        code: 200,
        data: await this.service.run(user, body, controller.signal),
      };
    } finally {
      clearTimeout(timeout);
      response.off('close', stop);
    }
  }
  @Get('requests/:requestId')
  async receipt(
    @CurrentUser() user: AuthUser,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
  ) {
    return { code: 200, data: await this.service.receipt(user, requestId) };
  }
  @Post('requests/:requestId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
  ) {
    return { code: 200, data: await this.service.cancel(user, requestId) };
  }
}
// Outside public aurora prefixes. Both machine authentication and the live
// scoped credential are required; no actor ID is accepted from the Worker.
@Controller('internal/content-gps/discovery')
export class DiscoveryAssistantReadController {
  constructor(private readonly service: DiscoveryAssistantService) {}
  @SkipEndUserAuth()
  @Post('read')
  @HttpCode(200)
  async read(
    @Headers('x-agent-os-internal-token') token: string | undefined,
    @Body(new ZodValidationPipe(DiscoveryReadRequestSchema))
    body: z.infer<typeof DiscoveryReadRequestSchema>,
  ) {
    const expected = Buffer.from(
      process.env.AGENT_OS_INTERNAL_TOKEN?.trim() ?? '',
    );
    const received = Buffer.from(token?.trim() ?? '');
    if (
      expected.length < 16 ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw new UnauthorizedException(
        'Invalid discovery internal authentication.',
      );
    return this.service.read(body);
  }
}
