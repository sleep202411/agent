import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import {
  AgentOsApprovalBodySchema,
  AgentOsStartRunBodySchema,
} from './agent-os-gateway.dto';
import { AgentOsGatewayService } from './agent-os-gateway.service';

/**
 * Product control plane for Agent OS.
 * Routes are under /agent-os/* (edge may prefix /aurora).
 *
 * Phase 1: free, no rate limit. Auth + story project permission required.
 */
@Controller('agent-os')
export class AgentOsGatewayController {
  constructor(private readonly gateway: AgentOsGatewayService) {}

  @Get('health')
  health() {
    return this.gateway.health();
  }

  @Post('runs')
  async startRun(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = AgentOsStartRunBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_BODY',
        message: parsed.error.message,
      });
    }
    return this.gateway.startRun(user, parsed.data);
  }

  @Post('runs/:runId/approvals')
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() body: unknown,
  ) {
    const parsed = AgentOsApprovalBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_BODY',
        message: parsed.error.message,
      });
    }
    return this.gateway.resolveApproval(user, runId, parsed.data);
  }

  @Get('runs/:runId/events')
  async events(
    @CurrentUser() user: AuthUser,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Query('after') afterRaw?: string,
  ) {
    const after = afterRaw ? Number(afterRaw) : 0;
    if (!Number.isFinite(after) || after < 0) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_AFTER',
        message: 'after must be a non-negative number',
      });
    }
    return this.gateway.listEvents(user, runId, projectId, after);
  }
}
