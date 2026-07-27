import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  StudioAgentApprovalSignalSchema,
  StudioAgentCompleteContextCompactionRequestSchema,
  StudioAgentEventDraftSchema,
  StudioAgentFailContextCompactionRequestSchema,
  StudioAgentInputSignalSchema,
  StudioAgentPrepareActionRequestSchema,
  StudioAgentWorkflowInputSchema,
  type StudioAgentApprovalSignal,
  type StudioAgentCompleteContextCompactionRequest,
  type StudioAgentEventDraft,
  type StudioAgentFailContextCompactionRequest,
  type StudioAgentInputSignal,
  type StudioAgentPrepareActionRequest,
  type StudioAgentWorkflowInput,
} from '@repo/shared/studio-agent';
import {
  StudioAgentDenyActionRequestSchema,
  StudioAgentExecuteActionRequestSchema,
  StudioAgentRunTransitionRequestSchema,
  type StudioAgentDenyActionRequest,
  type StudioAgentExecuteActionRequest,
  type StudioAgentRunTransitionRequest,
} from '@repo/shared/studio-agent-api';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StudioAgentRuntimeTokenGuard } from './studio-agent-runtime-token.guard';
import { StudioAgentRuntimeService } from './studio-agent-runtime.service';

/**
 * Private execution gateway used exclusively by the durable Studio Agent
 * runtime. `@Public()` only bypasses end-user authentication: every route is
 * protected by the dedicated runtime credential and the service re-authorizes
 * the complete persisted workflow/action identity before touching product
 * state.
 */
@Public()
@UseGuards(StudioAgentRuntimeTokenGuard)
@Controller('internal/studio-agent/runtime')
export class StudioAgentRuntimeController {
  constructor(private readonly runtime: StudioAgentRuntimeService) {}

  @Post('events')
  async appendEvent(
    @Body(new ZodValidationPipe(StudioAgentEventDraftSchema))
    body: StudioAgentEventDraft,
  ) {
    return { code: 200, data: await this.runtime.appendEvent(body) };
  }

  @Post('model-plan')
  async loadModelPlan(
    @Body(new ZodValidationPipe(StudioAgentWorkflowInputSchema))
    body: StudioAgentWorkflowInput,
  ) {
    return { code: 200, data: await this.runtime.loadModelPlan(body) };
  }

  @Post('context-compactions/complete')
  async completeContextCompaction(
    @Body(
      new ZodValidationPipe(StudioAgentCompleteContextCompactionRequestSchema),
    )
    body: StudioAgentCompleteContextCompactionRequest,
  ) {
    return {
      code: 200,
      data: await this.runtime.completeContextCompaction(body),
    };
  }

  @Post('context-compactions/terminal')
  async failContextCompaction(
    @Body(new ZodValidationPipe(StudioAgentFailContextCompactionRequestSchema))
    body: StudioAgentFailContextCompactionRequest,
  ) {
    return {
      code: 200,
      data: await this.runtime.failContextCompaction(body),
    };
  }

  @Post('actions/prepare')
  async prepareAction(
    @Body(new ZodValidationPipe(StudioAgentPrepareActionRequestSchema))
    body: StudioAgentPrepareActionRequest,
  ) {
    return { code: 200, data: await this.runtime.prepareAction(body) };
  }

  @Post('child-runs/prepare')
  async prepareChildRun(
    @Body(new ZodValidationPipe(StudioAgentPrepareActionRequestSchema))
    body: StudioAgentPrepareActionRequest,
  ) {
    return { code: 200, data: await this.runtime.prepareChildRun(body) };
  }

  @Post('actions/execute')
  async executeAction(
    @Body(new ZodValidationPipe(StudioAgentExecuteActionRequestSchema))
    body: StudioAgentExecuteActionRequest,
  ) {
    return { code: 200, data: await this.runtime.executeAction(body) };
  }

  @Post('actions/deny')
  async denyAction(
    @Body(new ZodValidationPipe(StudioAgentDenyActionRequestSchema))
    body: StudioAgentDenyActionRequest,
  ) {
    return { code: 200, data: await this.runtime.denyAction(body) };
  }

  @Post('approvals/resolve')
  async resolveApproval(
    @Body(new ZodValidationPipe(StudioAgentApprovalSignalSchema))
    body: StudioAgentApprovalSignal,
  ) {
    return { code: 200, data: await this.runtime.resolveApproval(body) };
  }

  @Post('inputs/consume')
  async consumeInput(
    @Body(new ZodValidationPipe(StudioAgentInputSignalSchema))
    body: StudioAgentInputSignal,
  ) {
    return { code: 200, data: await this.runtime.consumeInput(body) };
  }

  @Post('runs/transition')
  async transitionRun(
    @Body(new ZodValidationPipe(StudioAgentRunTransitionRequestSchema))
    body: StudioAgentRunTransitionRequest,
  ) {
    return { code: 200, data: await this.runtime.transitionRun(body) };
  }
}
