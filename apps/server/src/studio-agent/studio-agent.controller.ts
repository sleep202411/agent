import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  StudioAgentCancelRunRequestSchema,
  StudioAgentResolveApprovalRequestSchema,
  StudioAgentResolveThreadRequestSchema,
  StudioAgentSubmitMessageRequestSchema,
  StudioAgentUpdatePermissionPolicyRequestSchema,
  type StudioAgentCancelRunRequest,
  type StudioAgentResolveApprovalRequest,
  type StudioAgentResolveThreadRequest,
  type StudioAgentSubmitMessageRequest,
  type StudioAgentUpdatePermissionPolicyRequest,
} from '@repo/shared/studio-agent-api';
import type { Request, Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StudioAgentConfigService } from './studio-agent.config';
import {
  StudioAgentApprovalParamsSchema,
  StudioAgentEventQuerySchema,
  StudioAgentEventStreamQuerySchema,
  StudioAgentRunParamsSchema,
  StudioAgentSnapshotQuerySchema,
  StudioAgentThreadParamsSchema,
  type StudioAgentApprovalParams,
  type StudioAgentEventQuery,
  type StudioAgentEventStreamQuery,
  type StudioAgentRunParams,
  type StudioAgentSnapshotQuery,
  type StudioAgentThreadParams,
} from './studio-agent.dto';
import {
  StudioAgentEventNotifier,
  StudioAgentEventStore,
} from './studio-agent.events';
import { StudioAgentService } from './studio-agent.service';

@Controller('studio-agent')
export class StudioAgentController {
  constructor(
    private readonly studioAgent: StudioAgentService,
    private readonly events: StudioAgentEventStore,
    private readonly notifier: StudioAgentEventNotifier,
    private readonly config: StudioAgentConfigService,
  ) {}

  @Post('threads/resolve')
  async resolveThread(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StudioAgentResolveThreadRequestSchema))
    body: StudioAgentResolveThreadRequest,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.resolveThread(user, body),
    };
  }

  @Get('threads/:threadId/snapshot')
  async snapshot(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
    @Query(new ZodValidationPipe(StudioAgentSnapshotQuerySchema))
    query: StudioAgentSnapshotQuery,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.snapshot(user, params.threadId, query),
    };
  }

  @Post('threads/:threadId/messages')
  async submitMessage(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
    @Body(new ZodValidationPipe(StudioAgentSubmitMessageRequestSchema))
    body: StudioAgentSubmitMessageRequest,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.submitMessage(user, params.threadId, body),
    };
  }

  @Get('threads/:threadId/events')
  async eventPage(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
    @Query(new ZodValidationPipe(StudioAgentEventQuerySchema))
    query: StudioAgentEventQuery,
  ) {
    await this.studioAgent.requireThread(user, params.threadId);
    const page = await this.events.page(
      params.threadId,
      query.afterSequence,
      query.limit,
    );
    return {
      code: 200,
      data: {
        schemaVersion: 'studio-agent-v1',
        ...page,
      },
    };
  }

  @Get('threads/:threadId/events/stream')
  async eventStream(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
    @Query(new ZodValidationPipe(StudioAgentEventStreamQuerySchema))
    query: StudioAgentEventStreamQuery,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.studioAgent.requireThread(user, params.threadId);
    let cursor = Math.max(query.afterSequence, parseLastEventId(lastEventId));
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    let closed = false;
    let pendingWake = true;
    let wake: (() => void) | null = null;
    request.on('close', () => {
      closed = true;
      wake?.();
    });
    const subscription = this.notifier.notifications().subscribe((event) => {
      if (event.threadId !== params.threadId || event.sequence <= cursor) {
        return;
      }
      pendingWake = true;
      wake?.();
    });

    try {
      while (!closed) {
        if (pendingWake) {
          pendingWake = false;
          do {
            const page = await this.events.page(
              params.threadId,
              cursor,
              this.config.value.sseBatchSize,
            );
            for (const event of page.events) {
              if (closed) {
                break;
              }
              await writeSse(
                response,
                `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
              );
              cursor = event.sequence;
            }
            if (!page.hasMore) {
              break;
            }
          } while (!closed);
          continue;
        }

        const wokeFromEvent = await waitForWake((resolve) => {
          wake = resolve;
        }, this.config.value.sseHeartbeatMs);
        wake = null;
        if (!wokeFromEvent && !closed) {
          await writeSse(response, ': heartbeat\n\n');
          // The heartbeat is also a durable catch-up poll in case Redis
          // notification delivery was interrupted.
          pendingWake = true;
        }
      }
    } finally {
      subscription.unsubscribe();
      if (!response.writableEnded) {
        response.end();
      }
    }
  }

  @Patch('threads/:threadId/permission-policy')
  async updatePermissionPolicy(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
    @Body(new ZodValidationPipe(StudioAgentUpdatePermissionPolicyRequestSchema))
    body: StudioAgentUpdatePermissionPolicyRequest,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.updatePermissionPolicy(
        user,
        params.threadId,
        body,
      ),
    };
  }

  @Post('threads/:threadId/approvals/:approvalId/resolve')
  async resolveApproval(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentApprovalParamsSchema))
    params: StudioAgentApprovalParams,
    @Body(new ZodValidationPipe(StudioAgentResolveApprovalRequestSchema))
    body: StudioAgentResolveApprovalRequest,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.resolveApproval(
        user,
        params.threadId,
        params.approvalId,
        body,
      ),
    };
  }

  @Post('threads/:threadId/runs/:runId/cancel')
  async cancelRun(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentRunParamsSchema))
    params: StudioAgentRunParams,
    @Body(new ZodValidationPipe(StudioAgentCancelRunRequestSchema))
    body: StudioAgentCancelRunRequest,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.cancelRun(
        user,
        params.threadId,
        params.runId,
        body,
      ),
    };
  }
}

function parseLastEventId(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function waitForWake(
  register: (resolve: () => void) => void,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let completed = false;
    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        resolve(false);
      }
    }, timeoutMs);
    register(() => {
      if (!completed) {
        completed = true;
        clearTimeout(timeout);
        resolve(true);
      }
    });
  });
}

async function writeSse(response: Response, chunk: string): Promise<void> {
  if (response.write(chunk)) {
    return;
  }
  await new Promise<void>((resolve) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      response.off('drain', onDrain);
      response.off('close', onClose);
    };
    response.once('drain', onDrain);
    response.once('close', onClose);
  });
}
