import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StoryUuidSchema } from './dto';
import { StoryAgentRunService } from './story-agent-run.service';
import { StoryAgentRunWorkerService } from './story-agent-run-worker.service';

const StoryAgentProjectParamsSchema = z
  .object({ projectId: StoryUuidSchema })
  .strict();
const StoryAgentRunParamsSchema = z
  .object({ projectId: StoryUuidSchema, runId: StoryUuidSchema })
  .strict();
const StoryAgentRunScopeQuerySchema = z
  .object({ chapterId: StoryUuidSchema.optional() })
  .strict();

type StoryAgentProjectParams = z.infer<typeof StoryAgentProjectParamsSchema>;
type StoryAgentRunParams = z.infer<typeof StoryAgentRunParamsSchema>;
type StoryAgentRunScopeQuery = z.infer<typeof StoryAgentRunScopeQuerySchema>;

@Controller('story-projects/:projectId/agent-runs')
export class StoryAgentRunController {
  constructor(
    private readonly runs: StoryAgentRunService,
    private readonly worker: StoryAgentRunWorkerService,
  ) {}

  /**
   * Reload-safe lifecycle head: proposed/applying wins; otherwise the most
   * recent terminal event remains visible. `/undoable` independently exposes
   * the canonical data-head Undo target.
   */
  @Get('active')
  async getLatest(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryAgentProjectParamsSchema))
    params: StoryAgentProjectParams,
    @Query(new ZodValidationPipe(StoryAgentRunScopeQuerySchema))
    query: StoryAgentRunScopeQuery,
  ) {
    return {
      code: 200,
      data: await this.runs.getLatestRunForProject(
        user,
        params.projectId,
        query.chapterId,
      ),
    };
  }

  /**
   * Canonical data-head Undo target. Kept separate from `/active` so a newer
   * cancelled/failed/stale lifecycle event remains visible in the assistant.
   */
  @Get('undoable')
  async getUndoable(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryAgentProjectParamsSchema))
    params: StoryAgentProjectParams,
    @Query(new ZodValidationPipe(StoryAgentRunScopeQuerySchema))
    query: StoryAgentRunScopeQuery,
  ) {
    return {
      code: 200,
      data: await this.runs.getUndoableRunForProject(
        user,
        params.projectId,
        query.chapterId,
      ),
    };
  }

  @Get(':runId')
  async getRun(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryAgentRunParamsSchema))
    params: StoryAgentRunParams,
  ) {
    return {
      code: 200,
      data: await this.runs.getRunForProject(
        user,
        params.projectId,
        params.runId,
      ),
    };
  }

  @Post(':runId/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAgentRunParamsSchema))
    params: StoryAgentRunParams,
  ) {
    const data = await this.runs.confirmForProject(
      user,
      params.projectId,
      params.runId,
      requiredIdempotencyKey(idempotencyHeader),
    );
    if (data.status === 'applying') this.worker.wake();
    return { code: 200, data };
  }

  /** Re-arm drafting for an authoring_failed run without a new chat turn. */
  @Post(':runId/retry-authoring')
  @HttpCode(HttpStatus.OK)
  async retryAuthoring(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryAgentRunParamsSchema))
    params: StoryAgentRunParams,
  ) {
    const data = await this.runs.retryAuthoringForProject(
      user,
      params.projectId,
      params.runId,
    );
    if (data.status === 'authoring') this.worker.wake();
    return { code: 200, data };
  }

  @Post(':runId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryAgentRunParamsSchema))
    params: StoryAgentRunParams,
  ) {
    return {
      code: 200,
      data: await this.runs.cancelForProject(
        user,
        params.projectId,
        params.runId,
      ),
    };
  }

  @Post(':runId/undo')
  @HttpCode(HttpStatus.OK)
  async undo(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryAgentRunParamsSchema))
    params: StoryAgentRunParams,
  ) {
    const data = await this.runs.undoForProject(
      user,
      params.projectId,
      params.runId,
      requiredIdempotencyKey(idempotencyHeader),
    );
    if (data.status === 'applying') this.worker.wake();
    return { code: 200, data };
  }
}

function requiredIdempotencyKey(value: string | string[] | undefined): string {
  const candidate = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!candidate || candidate.length > 160) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message:
        'A non-empty Idempotency-Key header of at most 160 characters is required.',
    });
  }
  return candidate;
}
