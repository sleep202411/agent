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
import { AgentEventEnvelopeSchema } from '@repo/agent-protocol';
import { ProjectSkillResolutionSnapshotSchema } from '@repo/agent-skills';
import { Public } from '../auth';
import { AgentOsRunJournalService } from '../agent-os-journal/agent-os-run-journal.service';
import {
  AgentOsContinuationCommandSchema,
  AgentOsPendingExternalSchema,
} from '../agent-os-journal/agent-os-journal.schemas';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';

const journalBodySchema = z
  .object({
    projectId: z.string().uuid(),
    conversationId: z.string().uuid(),
    actorId: z.string().trim().min(1).max(128),
    modelProfileId: z.string().trim().min(1).max(64),
    status: z.enum([
      'queued',
      'running',
      'waiting_for_approval',
      'waiting_for_input',
      'waiting_for_external',
      'paused',
      'completed',
      'failed',
      'cancelled',
    ]),
    lastSequence: z.number().int().nonnegative(),
    events: z.array(z.unknown()).max(10_000),
    pendingApproval: z.unknown().optional(),
    pendingUserInput: z.unknown().optional(),
    pendingExternal: AgentOsPendingExternalSchema.nullable().optional(),
    assistantText: z.string().max(200_000).nullable().optional(),
    projectKind: z.enum(['platform', 'story']),
    workbenchMode: z.string().trim().min(1).max(64),
    workbenchContext: z.record(z.string(), z.string()).optional(),
    skillMountSnapshot: ProjectSkillResolutionSnapshotSchema,
    startExecution: z
      .object({
        executionToken: z.string().uuid(),
        executionAttemptId: z.string().uuid(),
        executionEpoch: z.number().int().positive(),
        executionOwnerId: z.string().uuid(),
        checkpointId: z.string().trim().min(1).max(160).optional(),
        checkpointNamespace: z.string().max(200).optional(),
        checkpointThreadId: z.string().uuid().optional(),
        checkpointMessageId: z.string().uuid().optional(),
      })
      .strict()
      .refine(
        (proof) => {
          const checkpoint = [
            proof.checkpointId,
            proof.checkpointNamespace,
            proof.checkpointThreadId,
            proof.checkpointMessageId,
          ];
          return (
            checkpoint.every((item) => item !== undefined) ||
            checkpoint.every((item) => item === undefined)
          );
        },
        { message: 'Checkpoint receipt fields must be supplied together.' },
      )
      .optional(),
    continuationCommand: AgentOsContinuationCommandSchema.optional(),
    continuationExecution: z
      .object({
        executionToken: z.string().uuid(),
        executionAttemptId: z.string().uuid(),
        executionEpoch: z.number().int().positive(),
        executionOwnerId: z.string().uuid(),
        checkpointId: z.string().trim().min(1).max(160).optional(),
        checkpointNamespace: z.string().max(200).optional(),
        checkpointThreadId: z.string().uuid().optional(),
      })
      .strict()
      .refine(
        (proof) => {
          const checkpoint = [
            proof.checkpointId,
            proof.checkpointNamespace,
            proof.checkpointThreadId,
          ];
          return (
            checkpoint.every((item) => item !== undefined) ||
            checkpoint.every((item) => item === undefined)
          );
        },
        {
          message: 'Continuation checkpoint fields must be supplied together.',
        },
      )
      .optional(),
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
    const events = AgentEventEnvelopeSchema.array().safeParse(
      parsed.data.events,
    );
    if (!events.success) {
      throw new BadRequestException({
        code: 'AGENT_OS_JOURNAL_EVENT_INVALID',
        message: events.error.message,
      });
    }
    const committed = await this.journal.upsertSnapshot({
      runId,
      projectId: parsed.data.projectId,
      conversationId: parsed.data.conversationId,
      actorId: parsed.data.actorId,
      modelProfileId: parsed.data.modelProfileId,
      status: parsed.data.status,
      reportedLastSequence: parsed.data.lastSequence,
      events: events.data,
      pendingApproval: parsed.data.pendingApproval,
      pendingExternal: parsed.data.pendingExternal,
      assistantText: parsed.data.assistantText,
      projectKind: parsed.data.projectKind,
      workbenchMode: parsed.data.workbenchMode,
      workbenchContext: parsed.data.workbenchContext,
      skillMountSnapshot: parsed.data.skillMountSnapshot,
      startExecution: parsed.data.startExecution,
      continuationCommand: parsed.data.continuationCommand,
      continuationExecution: parsed.data.continuationExecution,
    });
    return { ok: true, runId, ...committed };
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
