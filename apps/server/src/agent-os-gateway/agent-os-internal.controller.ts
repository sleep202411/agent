import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import { AgentOsRunJournalService } from './agent-os-run-journal.service';

const journalBodySchema = z
  .object({
    projectId: z.string().uuid(),
    conversationId: z.string().uuid(),
    actorId: z.string().trim().min(1).max(128),
    modelProfileId: z.string().trim().min(1).max(64),
    status: z.string().trim().min(1).max(32),
    events: z.array(z.record(z.string(), z.unknown())).max(10_000),
    pendingApproval: z.unknown().optional(),
    assistantText: z.string().max(200_000).nullable().optional(),
  })
  .strict();

/**
 * Worker-facing internal routes (journal + future control).
 */
/*
 * Deliberately NOT under the `agent-os` prefix: Studio proxies `/aurora/:path*`
 * straight through to this service from the public internet, so anything under
 * that prefix is internet-reachable. These routes act as a caller-supplied
 * actorId — they must not be, token or no token.
 */
@Controller('internal/agent-os')
export class AgentOsInternalController {
  constructor(
    private readonly config: AgentOsGatewayConfigService,
    private readonly journal: AgentOsRunJournalService,
  ) {}

  @Public()
  @Post('runs/:runId/journal')
  async putJournal(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Headers('x-agent-os-internal-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    this.assertToken(token);
    const parsed = journalBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'AGENT_OS_JOURNAL_INVALID',
        message: parsed.error.message,
      });
    }
    await this.journal.upsertSnapshot({
      runId,
      projectId: parsed.data.projectId,
      conversationId: parsed.data.conversationId,
      actorId: parsed.data.actorId,
      modelProfileId: parsed.data.modelProfileId,
      status: parsed.data.status,
      events: parsed.data.events as never,
      pendingApproval: parsed.data.pendingApproval,
      assistantText: parsed.data.assistantText,
    });
    return { ok: true, runId };
  }

  @Public()
  @Get('runs/:runId/journal')
  async getJournal(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Headers('x-agent-os-internal-token') token: string | undefined,
    @Query('after') afterRaw?: string,
  ) {
    this.assertToken(token);
    const after = afterRaw ? Number(afterRaw) : 0;
    if (!Number.isFinite(after) || after < 0) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_AFTER',
        message: 'after must be non-negative',
      });
    }
    const row = await this.journal.getEventsAfter(runId, after);
    if (!row) {
      return { ok: false, code: 'RUN_NOT_FOUND' };
    }
    return { ok: true, ...row };
  }

  /**
   * Constant-time, because a `!==` on a shared secret leaks it one byte at a
   * time to anyone who can measure the response — and this secret authorises
   * acting as ANY user on ANY project.
   */
  private assertToken(token: string | undefined): void {
    const expected = Buffer.from(this.config.value.internalToken);
    const presented = Buffer.from(token?.trim() ?? '');
    const ok =
      presented.length === expected.length &&
      timingSafeEqual(presented, expected);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'AGENT_OS_INTERNAL_UNAUTHORIZED',
        message: 'Invalid or missing X-Agent-Os-Internal-Token.',
      });
    }
  }
}
