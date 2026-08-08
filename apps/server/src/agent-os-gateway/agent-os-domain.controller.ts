import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../auth';
import { AgentOsDomainExecuteBodySchema } from './agent-os-domain.dto';
import { AgentOsDomainService } from './agent-os-domain.service';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';

/**
 * Internal Domain execution for Agent OS workers.
 * Not end-user facing — protected by shared internal token (Phase 1).
 */
/*
 * Deliberately NOT under the `agent-os` prefix: Studio proxies `/aurora/:path*`
 * straight through to this service from the public internet, so anything under
 * that prefix is internet-reachable. These routes act as a caller-supplied
 * actorId — they must not be, token or no token.
 */
@Controller('internal/agent-os')
export class AgentOsDomainController {
  constructor(
    private readonly domain: AgentOsDomainService,
    private readonly config: AgentOsGatewayConfigService,
  ) {}

  @Public()
  @Post('tools/:toolId/execute')
  async execute(
    @Param('toolId') toolId: string,
    @Headers('x-agent-os-internal-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    // Constant-time: a `!==` on a shared secret leaks it a byte at a time to
    // anyone who can measure the response, and this one authorises acting as
    // ANY user on ANY project.
    const expected = Buffer.from(this.config.value.internalToken);
    const presented = Buffer.from(token?.trim() ?? '');
    if (
      presented.length !== expected.length ||
      !timingSafeEqual(presented, expected)
    ) {
      throw new UnauthorizedException({
        code: 'AGENT_OS_INTERNAL_UNAUTHORIZED',
        message: 'Invalid or missing X-Agent-Os-Internal-Token.',
      });
    }
    const parsed = AgentOsDomainExecuteBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'AGENT_OS_DOMAIN_INVALID_BODY',
        message: parsed.error.message,
      });
    }
    return this.domain.execute({
      toolId,
      actorId: parsed.data.actorId,
      projectId: parsed.data.projectId,
      idempotencyKey: parsed.data.idempotencyKey,
      arguments: parsed.data.arguments,
    });
  }
}
