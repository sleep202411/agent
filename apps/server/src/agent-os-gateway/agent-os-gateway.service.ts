import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  getModeDefinition,
  type AgentProjectKind,
} from '@repo/agent-capabilities';
import {
  AgentOsIdSchema,
  ApprovalResolvedDataSchema,
  UserInputResolvedDataSchema,
} from '@repo/agent-protocol';
import {
  listInvocableSkills,
  listSkills,
  toSkillPublicMeta,
} from '@repo/agent-skills';
import type { AuthUser } from '../auth';
import type {
  AgentOsApprovalBody,
  AgentOsStartRunBody,
  AgentOsUserInputBody,
} from './agent-os-gateway.dto';
import { AgentOsAttachmentService } from './agent-os-attachment.service';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import {
  AgentOsWorkerClient,
  type AgentOsWorkerRunResponse,
} from './agent-os-worker.client';
import { AgentOsDomainService } from './agent-os-domain.service';
import { AgentOsProjectContextService } from './agent-os-project-context.service';
import {
  AgentOsRunJournalService,
  type AgentOsRunStartReservation,
} from '../agent-os-journal/agent-os-run-journal.service';
import {
  canonicalJson,
  journalErrorText,
} from '../agent-os-journal/agent-os-journal.mapper';
import { AgentOsAblyTokenIssuer } from './agent-os.realtime';
import { AgentOsRunStartDispatcherService } from './agent-os-run-start-dispatcher.service';
import { AgentOsRunContinuationDispatcherService } from './agent-os-run-continuation-dispatcher.service';
import { ProjectSkillsResolver } from '../project-skills';
import { StoryAgentRunService } from '../story-studio/story-agent-run.service';
import type { StoryAgentRunDto } from '@repo/shared/story-agent';
import {
  StoryProductionPlanService,
  type StoryProductionStateDto,
} from '../story-studio/story-production-plan.service';
import { StoryGenerationBatchService } from '../story-studio/story-generation-batch.service';

const USER_INPUT_RESPONSE_LEASE_MS = 30_000;
const USER_INPUT_RESPONSE_WAIT_MS = 65_000;
const USER_INPUT_RESPONSE_POLL_MS = 75;
const APPROVAL_RESPONSE_LEASE_MS = 30_000;
const APPROVAL_RESPONSE_WAIT_MS = 65_000;
const APPROVAL_RESPONSE_POLL_MS = 75;

type DurableRunSnapshot = NonNullable<
  Awaited<ReturnType<AgentOsRunJournalService['getEventsAfter']>>
>;

function approvalRecord(value: unknown): {
  approvalId: string;
  toolId: string;
  arguments: unknown;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.approvalId === 'string' &&
    typeof record.toolId === 'string'
    ? {
        approvalId: record.approvalId,
        toolId: record.toolId,
        arguments: record.arguments,
      }
    : null;
}

function externalRecord(value: unknown): {
  jobId: string;
  toolId: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.jobId === 'string' && typeof record.toolId === 'string'
    ? { jobId: record.jobId, toolId: record.toolId }
    : null;
}

function recordString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Server truth injected into a Story turn without polluting the visible
 * transcript. Prior assistant prose is historical and must never masquerade as
 * the current background-job state after a discard/cancellation.
 */
export function storyAuthoringModelContext(input: {
  latestRun: Pick<StoryAgentRunDto, 'id' | 'status'> | null;
  productionState: StoryProductionStateDto;
}): string {
  const status = input.latestRun?.status ?? 'none';
  const active = status === 'authoring' || status === 'applying';
  const awaitingReview = status === 'proposed';
  const canonicalProductionState = {
    profile: input.productionState.profile.status,
    script: input.productionState.script.status,
    plot: input.productionState.plotTree.status,
    assets: input.productionState.assets.status,
    storyboard: input.productionState.storyboard.status,
    ready: input.productionState.ready,
  };
  const chapterHasNoScript = input.productionState.script.status === 'missing';
  return [
    '[Trusted Story runtime state at turn admission]',
    `latestAuthoringRun=${JSON.stringify(
      input.latestRun ? { runId: input.latestRun.id, status } : null,
    )}`,
    `authoringActive=${active}`,
    `proposalAwaitingReview=${awaitingReview}`,
    `canonicalProductionState=${JSON.stringify(canonicalProductionState)}`,
    `chapterHasNoScript=${chapterHasNoScript}`,
    'This server state overrides lifecycle claims in earlier conversation messages.',
    'Treat chapterHasNoScript as a trusted scene fact only; call story_read before acting because canonical state may advance after admission.',
    'Before any Story write or any claim that authoring is in progress, call story_read for the latest state.',
    'Only authoring/applying is in progress. cancelled/stale/failed/succeeded is terminal and does not block a new create request.',
  ].join('\n');
}

function orderedUnique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function sortedUnique(values: readonly string[] | undefined): string[] {
  return orderedUnique(values).sort();
}

/**
 * Stable semantics of a browser submission. Dynamic project resolution is
 * deliberately excluded: response-loss replay must work even when a Skill
 * resolution id, Story context, filename, or project revision has changed.
 */
export function startRunSubmissionFingerprint(
  body: AgentOsStartRunBody,
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        conversationId: body.conversationId,
        turnId: body.turnId,
        messageId: body.messageId,
        message: body.message.trim(),
        attachmentIds: orderedUnique(body.attachmentIds),
        modelProfileId: body.modelProfileId.trim(),
        permissionMode: body.permissionMode ?? 'smart',
        workbenchMode: body.workbenchMode,
        workbenchContext: body.workbenchContext ?? null,
        skillIds: sortedUnique(body.skillIds),
        projectSkillInstallationIds: sortedUnique(
          body.projectSkillInstallationIds,
        ),
        disabledDefaultSkillInstallationIds: sortedUnique(
          body.disabledDefaultSkillInstallationIds,
        ),
      }),
    )
    .digest('hex');
}

@Injectable()
export class AgentOsGatewayService {
  private readonly logger = new Logger(AgentOsGatewayService.name);

  constructor(
    private readonly worker: AgentOsWorkerClient,
    private readonly projects: AgentOsProjectContextService,
    private readonly config: AgentOsGatewayConfigService,
    private readonly journal: AgentOsRunJournalService,
    private readonly domain: AgentOsDomainService,
    private readonly realtimeTokens: AgentOsAblyTokenIssuer,
    private readonly attachments: AgentOsAttachmentService,
    private readonly projectSkills: ProjectSkillsResolver,
    private readonly storyAgentRuns: StoryAgentRunService,
    private readonly storyProductionPlans: StoryProductionPlanService,
    private readonly storyGenerationBatches: StoryGenerationBatchService,
    private readonly runStarts: AgentOsRunStartDispatcherService,
    private readonly runContinuations: AgentOsRunContinuationDispatcherService,
  ) {}

  async health() {
    const worker = await this.worker.health();
    return {
      ok: worker.ok,
      product: 'FizzDragon Agent Platform',
      codename: 'Agent OS',
      billing: this.config.value.billing,
      rateLimit: this.config.value.rateLimit,
      workerBaseUrl: this.config.value.workerBaseUrl,
      worker,
    };
  }

  async startRun(
    user: AuthUser,
    body: AgentOsStartRunBody,
  ): Promise<AgentOsWorkerRunResponse> {
    const project = await this.requireProjectWrite(user.userId, body.projectId);
    this.requireWorkbenchMode(project.projectKind, body.workbenchMode);
    const submissionFingerprint = startRunSubmissionFingerprint(body);
    const replay = await this.journal.findRunStartSubmission({
      actorId: user.userId,
      projectId: body.projectId,
      clientSubmissionId: body.clientSubmissionId,
      conversationId: body.conversationId,
      submissionFingerprint,
    });
    if (replay) return this.dispatchReservedStart(replay);

    const conversationId = body.conversationId;
    // conversationId becomes the LangGraph thread id, so submitting someone
    // else's would resume THEIR checkpointed history as context for this turn.
    if (
      await this.journal.conversationConflictsWith({
        conversationId,
        projectId: body.projectId,
        actorId: user.userId,
      })
    ) {
      throw new NotFoundException({
        code: 'AGENT_OS_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found for this project.',
      });
    }

    const attachmentIds = orderedUnique(body.attachmentIds);
    const skillIds = sortedUnique(body.skillIds);
    const projectSkillInstallationIds = sortedUnique(
      body.projectSkillInstallationIds,
    );
    const disabledDefaultSkillInstallationIds = sortedUnique(
      body.disabledDefaultSkillInstallationIds,
    );
    const workbenchContext = await this.resolveWorkbenchContext(
      project.projectKind,
      project.projectId,
      body.workbenchMode,
      body.workbenchContext,
    );
    const attachments = await this.attachments.validateForRun(
      project.projectKind,
      project.projectId,
      attachmentIds.length > 0 ? attachmentIds : undefined,
    );

    const allowedSystemSkills = new Set(
      listInvocableSkills({
        projectKind: project.projectKind,
        workbenchMode: body.workbenchMode,
      }).map((skill) => skill.id),
    );
    for (const skillId of skillIds) {
      if (!allowedSystemSkills.has(skillId)) {
        throw new BadRequestException({
          code: 'AGENT_OS_SKILL_NOT_INVOCABLE',
          message: `Skill ${skillId} is not selectable in this workbench.`,
        });
      }
    }
    const skillMountSnapshot = await this.projectSkills.resolve({
      ownerKind: project.projectKind,
      projectId: project.projectId,
      scope: 'agent_prompt',
      workbenchMode: body.workbenchMode,
      sourceSurface: `agent_os:${body.workbenchMode}`,
      selection: {
        includeInstallationIds:
          projectSkillInstallationIds.length > 0
            ? projectSkillInstallationIds
            : undefined,
        excludeInstallationIds:
          disabledDefaultSkillInstallationIds.length > 0
            ? disabledDefaultSkillInstallationIds
            : undefined,
      },
    });
    let modelContext: string | undefined;
    if (project.projectKind === 'story') {
      const chapterId = workbenchContext?.chapterId;
      if (!chapterId) {
        throw new BadRequestException({
          code: 'AGENT_OS_WORKBENCH_CONTEXT_REQUIRED',
          message: 'Story workbench context requires a chapterId.',
        });
      }
      const [latestRun, productionState] = await Promise.all([
        this.storyAgentRuns.getLatestRun(
          user,
          project.workspaceId,
          project.projectId,
          chapterId,
        ),
        this.storyProductionPlans.getProductionState(
          user,
          project.projectId,
          chapterId,
        ),
      ]);
      modelContext = storyAuthoringModelContext({
        latestRun,
        productionState,
      });
    }
    const proposedRunId = randomUUID();
    const reservation = await this.journal.reserveRunStart({
      runId: proposedRunId,
      clientSubmissionId: body.clientSubmissionId,
      submissionFingerprint,
      turnId: body.turnId,
      messageId: body.messageId,
      projectId: body.projectId,
      conversationId,
      actorId: user.userId,
      message: body.message,
      modelContext,
      modelProfileId:
        workbenchContext?.experience === 'mobile_h5'
          ? this.config.value.mobileChatModelProfileId
          : body.modelProfileId,
      attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      attachments,
      permissionMode: body.permissionMode ?? 'smart',
      projectKind: project.projectKind,
      workbenchMode: body.workbenchMode,
      workbenchContext,
      skillIds: skillIds.length > 0 ? skillIds : undefined,
      projectSkillInstallationIds:
        projectSkillInstallationIds.length > 0
          ? projectSkillInstallationIds
          : undefined,
      disabledDefaultSkillInstallationIds:
        disabledDefaultSkillInstallationIds.length > 0
          ? disabledDefaultSkillInstallationIds
          : undefined,
      skillMountSnapshot,
    });

    return this.dispatchReservedStart(reservation);
  }

  /**
   * Dispatch after a committed admission or replay its durable state. Both
   * paths use the reservation's canonical run id, never a retry's proposal.
   */
  private async dispatchReservedStart(
    reservation: AgentOsRunStartReservation,
  ): Promise<AgentOsWorkerRunResponse> {
    try {
      const dispatched = await this.runStarts.dispatch(reservation.runId);
      if (dispatched) return dispatched;
    } catch (error) {
      // A durable command remains queued and the dispatcher retries it. The
      // creator receives its stable run id instead of retrying the whole POST
      // and accidentally competing with its own admitted conversation turn.
      this.logger.warn(
        `Agent OS start accepted but Worker dispatch is deferred run=${reservation.runId}: ${journalErrorText(error)}`,
      );
    }

    // Dispatch acknowledgement can be lost after Worker persistence. Re-read
    // PostgreSQL before falling back to the admission receipt so a retry never
    // regresses a running/terminal run to a synthetic empty queued response.
    const durable = await this.journal.getEventsAfter(reservation.runId, 0);
    if (durable) return this.toWorkerRunResponse(durable);
    return {
      runId: reservation.runId,
      status: reservation.snapshot.status,
      pendingApproval: reservation.snapshot.pendingApproval,
      pendingUserInput: reservation.snapshot.pendingUserInput,
      pendingExternal: reservation.snapshot.pendingExternal,
      assistantText: reservation.snapshot.assistantText ?? undefined,
      events: reservation.events,
    };
  }

  /** Relay of the worker's model list — no auth beyond the session guard: it
   *  names models, not projects. */
  async listModels() {
    const catalog = objectRecord(await this.worker.listModels());
    return {
      ...catalog,
      mobileDefaultModelProfileId: this.config.value.mobileChatModelProfileId,
    };
  }

  async listSkills(user: AuthUser, projectId: string, workbenchMode: string) {
    const project = await this.projects.requireRead(user.userId, projectId);
    this.requireWorkbenchMode(project.projectKind, workbenchMode);
    const all = listSkills().map(toSkillPublicMeta);
    const invocable = listInvocableSkills({
      projectKind: project.projectKind,
      workbenchMode,
    });
    return {
      skills: all,
      invocable,
      projectKind: project.projectKind,
      workbenchMode,
    };
  }

  async resolveApproval(
    user: AuthUser,
    runId: string,
    body: AgentOsApprovalBody,
  ): Promise<AgentOsWorkerRunResponse> {
    const run = await this.requireRunAccess(
      user,
      runId,
      body.projectId,
      'write',
    );

    const response = {
      runId,
      approvalId: body.approvalId,
      responseId: body.responseId,
      decision: body.decision,
      responseText: body.responseText,
      locale: body.locale,
    } as const;
    const alreadyResolved = await this.findDurableApprovalResolution(response);
    if (alreadyResolved)
      return this.dispatchResolvedContinuation(alreadyResolved);

    const durable = await this.journal.getEventsAfter(runId, 0);
    if (!durable) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Run not found for this project.',
      });
    }
    const pending = approvalRecord(durable.pendingApproval);
    if (
      durable.status !== 'waiting_for_approval' ||
      !pending ||
      pending.approvalId !== body.approvalId
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_APPROVAL_NOT_PENDING',
        message: 'This approval is no longer waiting for a decision.',
      });
    }

    if (pending.toolId === 'story.applyProposal') {
      const storyRunId = recordString(pending.arguments, 'storyAgentRunId');
      if (!storyRunId || !AgentOsIdSchema.safeParse(storyRunId).success) {
        throw new ConflictException({
          code: 'AGENT_OS_STORY_APPROVAL_CORRELATION_INVALID',
          message:
            'The Story proposal approval is missing its durable authoring-run correlation.',
        });
      }
      const coordinated =
        await this.storyAgentRuns.resolveAgentOsProposalDecision({
          user,
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          agentRunId: runId,
          conversationId: run.conversationId,
          storyRunId,
          approvalId: body.approvalId,
          responseId: body.responseId,
          decision: body.decision,
          responseText: body.responseText,
          locale: body.locale,
          ...(body.experience ? { experience: body.experience } : {}),
        });
      return {
        ...coordinated,
        assistantText: coordinated.assistantText ?? undefined,
      };
    }

    const waitDeadline = Date.now() + APPROVAL_RESPONSE_WAIT_MS;

    // Admission is a short PostgreSQL transaction. The Worker call must stay
    // outside its row lock because the Worker synchronously reports the
    // ApprovalResolved suffix back through this service before returning.
    while (Date.now() < waitDeadline) {
      const claim = await this.journal.claimApprovalResponse({
        ...response,
        leaseDurationMs: APPROVAL_RESPONSE_LEASE_MS,
      });

      if (claim.kind === 'resolved') {
        const resolved = await this.findDurableApprovalResolution(response);
        if (resolved) return this.dispatchResolvedContinuation(resolved);
        throw this.approvalResolutionUnavailable();
      }

      if (claim.kind === 'in_flight') {
        const resolved = await this.waitForDurableApprovalResolution(
          response,
          Math.min(waitDeadline, claim.leaseExpiresAt.getTime()),
        );
        if (resolved) return this.dispatchResolvedContinuation(resolved);
        // The lease owner disappeared before committing. After expiry exactly
        // one Gateway pod reclaims it; no request waits inside a transaction.
        continue;
      }

      try {
        await this.worker.resolveApproval({
          ...response,
          // The run's OWN identity goes downstream, never the client's copy:
          // these values select the LangGraph checkpoint and domain boundary.
          projectId: run.projectId,
          actorId: user.userId,
          conversationId: run.conversationId,
          modelProfileId: body.modelProfileId,
          projectKind: run.projectKind,
          workbenchMode: run.workbenchMode,
          workbenchContext: run.workbenchContext,
          permissionMode: body.permissionMode,
        });
      } catch (error) {
        // The Worker may have committed before its HTTP response was lost.
        // PostgreSQL, never transport success, decides the outcome.
        const resolved = await this.findDurableApprovalResolution(response);
        if (resolved) return this.dispatchResolvedContinuation(resolved);
        throw error;
      }

      const resolved = await this.waitForDurableApprovalResolution(
        response,
        Math.min(waitDeadline, claim.leaseExpiresAt.getTime()),
      );
      if (resolved) return this.dispatchResolvedContinuation(resolved);
    }

    throw this.approvalResolutionUnavailable();
  }

  async resolveUserInput(
    user: AuthUser,
    runId: string,
    body: AgentOsUserInputBody,
  ): Promise<AgentOsWorkerRunResponse> {
    const run = await this.requireRunAccess(
      user,
      runId,
      body.projectId,
      'write',
    );
    const response = {
      runId,
      requestId: body.requestId,
      responseId: body.responseId,
      answers: body.answers,
    } as const;
    const waitDeadline = Date.now() + USER_INPUT_RESPONSE_WAIT_MS;

    // The claim is a short row-locked transaction. Never keep its transaction
    // open across the Worker HTTP call: doing so can deadlock the pool because
    // the Worker must synchronously report UserInputResolved back to Gateway.
    while (Date.now() < waitDeadline) {
      const claim = await this.journal.claimUserInputResponse({
        ...response,
        leaseDurationMs: USER_INPUT_RESPONSE_LEASE_MS,
      });

      if (claim.kind === 'resolved') {
        const durable = await this.findDurableUserInputResolution(response);
        if (durable) return this.dispatchResolvedContinuation(durable);
        // claimUserInputResponse derives `resolved` from the append-only event
        // table. A missing event on the following read is an integrity or
        // availability failure, never permission to replay the side effect.
        throw this.userInputResolutionUnavailable();
      }

      if (claim.kind === 'in_flight') {
        const durable = await this.waitForDurableUserInputResolution(
          response,
          Math.min(waitDeadline, claim.leaseExpiresAt.getTime()),
        );
        if (durable) return this.dispatchResolvedContinuation(durable);
        // The lease owner disappeared before committing. Re-enter the short
        // transaction after expiry and let exactly one caller reclaim it.
        continue;
      }

      try {
        await this.worker.resolveUserInput({
          ...response,
          projectId: run.projectId,
          actorId: user.userId,
          conversationId: run.conversationId,
          modelProfileId: body.modelProfileId,
          projectKind: run.projectKind,
          workbenchMode: run.workbenchMode,
          workbenchContext: run.workbenchContext,
          permissionMode: body.permissionMode,
        });
      } catch (error) {
        // The Worker may have durably committed the answer while its HTTP
        // response was lost. PostgreSQL decides whether this was success.
        const durable = await this.findDurableUserInputResolution(response);
        if (durable) return this.dispatchResolvedContinuation(durable);
        throw error;
      }

      // A successful Worker response is only an acknowledgement. Return the
      // normal API shape from the authoritative journal, including all pending
      // projections, and never expose a still-waiting claim snapshot as success.
      const durable = await this.waitForDurableUserInputResolution(
        response,
        Math.min(waitDeadline, claim.leaseExpiresAt.getTime()),
      );
      if (durable) return this.dispatchResolvedContinuation(durable);
    }

    throw this.userInputResolutionUnavailable();
  }

  private dispatchResolvedContinuation(
    durable: AgentOsWorkerRunResponse,
  ): AgentOsWorkerRunResponse {
    // Resolution + visible user/ack messages + continuation command are one
    // PostgreSQL boundary. Dispatch is intentionally fire-and-recover: the
    // API returns the durable transcript immediately, while a lost callback is
    // retried by the dispatcher sweep without asking the user to submit again.
    void this.runContinuations.dispatch(durable.runId).catch((error) => {
      this.logger.warn(
        `Agent OS continuation accepted but immediate dispatch is deferred run=${durable.runId}: ${journalErrorText(error)}`,
      );
    });
    return durable;
  }

  async cancelRun(
    user: AuthUser,
    runId: string,
    projectId: string,
    reason?: string,
  ): Promise<AgentOsWorkerRunResponse> {
    const run = await this.requireRunAccess(user, runId, projectId, 'write');
    const beforeCancel = await this.journal.getEventsAfter(runId, 0);
    if (!beforeCancel) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Agent OS run not found.',
      });
    }
    const pendingExternal = externalRecord(beforeCancel.pendingExternal);
    const pendingApproval = approvalRecord(beforeCancel.pendingApproval);
    if (pendingApproval?.toolId === 'story.applyProposal') {
      const storyRunId = recordString(
        pendingApproval.arguments,
        'storyAgentRunId',
      );
      if (!storyRunId || !AgentOsIdSchema.safeParse(storyRunId).success) {
        throw new ConflictException({
          code: 'AGENT_OS_STORY_APPROVAL_CORRELATION_INVALID',
          message:
            'The Story proposal approval is missing its durable authoring-run correlation.',
        });
      }
      // Stop is not a proposal decision. Letting the generic cancellation path
      // terminalize only the Agent run would strand the canonical Story row in
      // `proposed`, and its later expiry could no longer close the approval.
      // The composer exposes the explicit Approve / Discard actions instead.
      throw new ConflictException({
        code: 'AGENT_OS_STORY_PROPOSAL_DECISION_REQUIRED',
        message:
          'This Story proposal is awaiting a decision and cannot be stopped. Choose Approve or Discard.',
        storyRunId,
      });
    }
    if (pendingExternal?.toolId === 'story.applyProposal') {
      throw new ConflictException({
        code: 'OPERATION_COMMITTED',
        message:
          'This Story proposal has already been committed for application and can no longer be stopped.',
      });
    }
    if (pendingExternal?.toolId === 'story.author') {
      if (!AgentOsIdSchema.safeParse(pendingExternal.jobId).success) {
        throw new ConflictException({
          code: 'AGENT_OS_STORY_HANDOFF_CORRELATION_INVALID',
          message:
            'The Story authoring handoff is missing its durable job correlation.',
        });
      }
      const cancelled = await this.storyAgentRuns.cancelAgentOsAuthoring({
        user,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        agentRunId: runId,
        conversationId: run.conversationId,
        storyRunId: pendingExternal.jobId,
        reason: reason?.trim() || undefined,
      });
      void this.worker.cancelRun(runId, reason).catch((error) => {
        this.logger.warn(
          `Agent OS Worker cancel notification failed run=${runId}: ${journalErrorText(error)}`,
        );
      });
      return {
        ...cancelled,
        assistantText: cancelled.assistantText ?? undefined,
      };
    }
    if (pendingExternal?.toolId === 'story.generation.confirmBatch') {
      if (!AgentOsIdSchema.safeParse(pendingExternal.jobId).success) {
        throw new ConflictException({
          code: 'AGENT_OS_STORY_GENERATION_CORRELATION_INVALID',
          message:
            'The Story generation handoff is missing its durable batch correlation.',
        });
      }
      await this.storyGenerationBatches.cancelAgentHandoff(
        user,
        run.projectId,
        pendingExternal.jobId,
      );
      void this.worker.cancelRun(runId, reason).catch((error) => {
        this.logger.warn(
          `Agent OS Worker cancel notification failed run=${runId}: ${journalErrorText(error)}`,
        );
      });
      const durable = await this.journal.getEventsAfter(runId, 0);
      if (!durable) {
        throw new NotFoundException({
          code: 'AGENT_OS_RUN_NOT_FOUND',
          message: 'Agent OS run not found.',
        });
      }
      return {
        runId,
        status: durable.status,
        events: durable.events,
        pendingApproval: durable.pendingApproval,
        pendingUserInput: durable.pendingUserInput,
        pendingExternal: durable.pendingExternal,
        assistantText: durable.assistantText ?? undefined,
      };
    }
    await this.journal.cancelRun({
      runId,
      reason: reason?.trim() || 'Stopped by user',
    });

    // PostgreSQL is already terminal. This call only aborts any live model
    // stream promptly; a restarted or unavailable Worker cannot undo Stop.
    void this.worker.cancelRun(runId, reason).catch((error) => {
      this.logger.warn(
        `Agent OS Worker cancel notification failed run=${runId}: ${journalErrorText(error)}`,
      );
    });

    const durable = await this.journal.getEventsAfter(runId, 0);
    if (!durable) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Agent OS run not found.',
      });
    }
    return {
      runId,
      status: durable.status,
      events: durable.events,
      pendingApproval: durable.pendingApproval,
      pendingUserInput: durable.pendingUserInput,
      pendingExternal: durable.pendingExternal,
      assistantText: durable.assistantText ?? undefined,
    };
  }

  /**
   * Durable transcript for reopen / refresh — Postgres journal is authoritative.
   */
  async getConversationHistory(
    user: AuthUser,
    projectId: string,
    conversationId?: string,
  ) {
    await this.requireProjectRead(user.userId, projectId);
    return this.journal.getConversationHistory({
      projectId,
      actorId: user.userId,
      conversationId,
    });
  }

  /**
   * Mint a short-lived Ably token for one conversation channel.
   * Re-checks project read on every mint (token refresh).
   */
  async issueRealtimeToken(
    user: AuthUser,
    projectId: string,
    conversationId: string,
  ) {
    await this.requireProjectRead(user.userId, projectId);
    // The channel name is a pure function of conversationId, so minting for an
    // id the caller does not own hands them another tenant's live transcript.
    // A conversation with no runs yet is unclaimed — the client mints its token
    // before the first turn exists.
    if (
      await this.journal.conversationConflictsWith({
        conversationId,
        projectId,
        actorId: user.userId,
      })
    ) {
      throw new NotFoundException({
        code: 'AGENT_OS_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found for this project.',
      });
    }
    return this.realtimeTokens.issueConversationToken(
      conversationId,
      user.userId,
    );
  }

  async listEvents(
    user: AuthUser,
    runId: string,
    projectId: string,
    after = 0,
  ) {
    await this.requireRunAccess(user, runId, projectId, 'read');
    // Worker event production is fail-closed on journal persistence, so the
    // PostgreSQL suffix is both current enough for streaming polls and the only
    // lifecycle authority. In particular, a restarted Worker's stale `running`
    // memory must never override a durable cancellation or external result.
    const durable = await this.journal.getEventsAfter(runId, after);
    if (durable) {
      return {
        runId: durable.runId,
        status: durable.status,
        events: durable.events,
        pendingApproval: durable.pendingApproval,
        pendingUserInput: durable.pendingUserInput,
        pendingExternal: durable.pendingExternal,
        assistantText: durable.assistantText,
        source: 'postgres' as const,
      };
    }

    // A pre-migration/diagnostic Worker may still know a run not present in
    // this database. Keep the fallback read-only; no projection is accepted
    // from it as durable truth.
    let live: Record<string, unknown> | null = null;
    try {
      live = (await this.worker.listEvents(runId, after)) as Record<
        string,
        unknown
      >;
    } catch {
      live = null;
    }
    if (live) {
      return { ...live, source: 'worker' as const };
    }
    return {
      runId,
      status: 'failed',
      events: [],
      source: 'none' as const,
    };
  }

  async listProjectCharacters(user: AuthUser, projectId: string) {
    await this.requireProjectRead(user.userId, projectId);
    return this.domain.listProjectCharacters(user.userId, projectId);
  }

  /**
   * Resolve a run and prove the caller may act on it.
   *
   * The client sends a runId and a projectId side by side, and they are
   * unrelated ids — authorizing the projectId says nothing about the run. Load
   * the run, authorize against the project it actually belongs to, and refuse a
   * mismatch. Without this a run UUID is a bearer token: any member of any
   * project can read another tenant's transcript, cancel their turn, or resolve
   * their pending write.
   *
   * Access is project-scoped, not actor-scoped: a project's editors can already
   * perform these writes themselves, so they may also act on its runs.
   */
  private async requireRunAccess(
    user: AuthUser,
    runId: string,
    claimedProjectId: string,
    access: 'read' | 'write',
  ): Promise<{
    projectId: string;
    workspaceId: string;
    actorId: string;
    conversationId: string;
    projectKind: AgentProjectKind;
    workbenchMode: string;
    workbenchContext?: Readonly<Record<string, string>>;
  }> {
    const run = await this.journal.getRunOwnership(runId);
    // Same response for "no such run" and "not yours": existence is itself
    // information about another tenant.
    if (!run || run.projectId !== claimedProjectId) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Run not found for this project.',
      });
    }
    const project =
      access === 'write'
        ? await this.requireProjectWrite(user.userId, run.projectId)
        : await this.requireProjectRead(user.userId, run.projectId);
    if (run.projectKind && run.projectKind !== project.projectKind) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Run not found for this Agent OS protocol version.',
      });
    }
    if (!run.workbenchMode) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Run not found for this Agent OS protocol version.',
      });
    }
    this.requireWorkbenchMode(project.projectKind, run.workbenchMode);
    const workbenchContext = await this.resolveWorkbenchContext(
      project.projectKind,
      project.projectId,
      run.workbenchMode,
      run.workbenchContext ?? undefined,
    );
    return {
      ...run,
      workspaceId: project.workspaceId,
      projectKind: project.projectKind,
      workbenchMode: run.workbenchMode,
      workbenchContext,
    };
  }

  private async findDurableApprovalResolution(input: {
    runId: string;
    approvalId: string;
    responseId: string;
    decision: 'approve' | 'reject';
    responseText: string;
    locale: 'en-US' | 'zh-CN' | 'zh-HK';
  }): Promise<AgentOsWorkerRunResponse | null> {
    const durable = await this.journal.getEventsAfter(input.runId, 0);
    if (!durable) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Run not found for this project.',
      });
    }
    const resolutions = durable.events.flatMap((event) => {
      if (event.type !== 'ApprovalResolved') return [];
      const parsed = ApprovalResolvedDataSchema.safeParse(event.data);
      return parsed.success ? [parsed.data] : [];
    });
    const sameResponse = resolutions.filter(
      (resolution) => resolution.responseId === input.responseId,
    );
    if (sameResponse.length > 0) {
      const samePayload = sameResponse.every(
        (resolution) =>
          resolution.approvalId === input.approvalId &&
          resolution.decision === input.decision,
      );
      if (!samePayload) {
        throw new ConflictException({
          code: 'AGENT_OS_APPROVAL_RESPONSE_CONFLICT',
          message:
            'This responseId was already used for a different approval decision.',
        });
      }
      const durableMessages = durable.events.filter((event) => {
        if (event.type !== 'UserMessage') return false;
        const data = objectRecord(event.data);
        const interaction = objectRecord(data?.interaction);
        return (
          interaction?.kind === 'approval' &&
          interaction.responseId === input.responseId
        );
      });
      const sameDisplayPayload =
        durableMessages.length > 0 &&
        durableMessages.every((event) => {
          const data = objectRecord(event.data)!;
          const interaction = objectRecord(data.interaction)!;
          return (
            data.text === input.responseText &&
            interaction.approvalId === input.approvalId &&
            interaction.responseId === input.responseId &&
            interaction.decision === input.decision &&
            interaction.locale === input.locale
          );
        });
      if (!sameDisplayPayload) {
        throw new ConflictException({
          code: 'AGENT_OS_APPROVAL_RESPONSE_CONFLICT',
          message:
            'This responseId was already used with different approval display data.',
        });
      }
      return this.toWorkerRunResponse(durable);
    }
    if (
      resolutions.some(
        (resolution) => resolution.approvalId === input.approvalId,
      )
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_APPROVAL_ALREADY_RESOLVED',
        message:
          'This approval was already answered with a different responseId.',
      });
    }
    return null;
  }

  private async findDurableUserInputResolution(input: {
    runId: string;
    requestId: string;
    responseId: string;
    answers: Readonly<Record<string, string>>;
  }): Promise<AgentOsWorkerRunResponse | null> {
    const durable = await this.journal.getEventsAfter(input.runId, 0);
    if (!durable) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Run not found for this project.',
      });
    }
    const responses = durable.events.flatMap((event) => {
      if (event.type !== 'UserInputResolved') return [];
      const parsed = UserInputResolvedDataSchema.safeParse(event.data);
      return parsed.success && parsed.data.responseId === input.responseId
        ? [parsed.data]
        : [];
    });
    if (responses.length === 0) return null;

    const samePayload = responses.every(
      (response) =>
        response.requestId === input.requestId &&
        canonicalJson(response.answers) === canonicalJson(input.answers),
    );
    if (!samePayload) {
      throw new ConflictException({
        code: 'AGENT_OS_INPUT_RESPONSE_CONFLICT',
        message:
          'This responseId was already used for a different structured-input answer.',
      });
    }
    return this.toWorkerRunResponse(durable);
  }

  private async waitForDurableApprovalResolution(
    input: {
      runId: string;
      approvalId: string;
      responseId: string;
      decision: 'approve' | 'reject';
      responseText: string;
      locale: 'en-US' | 'zh-CN' | 'zh-HK';
    },
    deadline: number,
  ): Promise<AgentOsWorkerRunResponse | null> {
    for (;;) {
      const durable = await this.findDurableApprovalResolution(input);
      if (durable) return durable;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(APPROVAL_RESPONSE_POLL_MS, remaining)),
      );
    }
  }

  private async waitForDurableUserInputResolution(
    input: {
      runId: string;
      requestId: string;
      responseId: string;
      answers: Readonly<Record<string, string>>;
    },
    deadline: number,
  ): Promise<AgentOsWorkerRunResponse | null> {
    for (;;) {
      const durable = await this.findDurableUserInputResolution(input);
      if (durable) return durable;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(USER_INPUT_RESPONSE_POLL_MS, remaining)),
      );
    }
  }

  private toWorkerRunResponse(
    durable: DurableRunSnapshot,
  ): AgentOsWorkerRunResponse {
    return {
      runId: durable.runId,
      status: durable.status,
      pendingApproval: durable.pendingApproval,
      pendingUserInput: durable.pendingUserInput,
      pendingExternal: durable.pendingExternal,
      assistantText: durable.assistantText ?? '',
      events: durable.events,
    };
  }

  private userInputResolutionUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'AGENT_OS_INPUT_RESOLUTION_NOT_DURABLE',
      message:
        'The structured-input response was not durably recorded. Retry with the same responseId.',
    });
  }

  private approvalResolutionUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'AGENT_OS_APPROVAL_RESOLUTION_NOT_DURABLE',
      message:
        'The approval decision was not durably recorded. Retry with the same responseId.',
    });
  }

  private async requireProjectWrite(userId: string, projectId: string) {
    return this.projects.requireWrite(userId, projectId);
  }

  private async requireProjectRead(userId: string, projectId: string) {
    return this.projects.requireRead(userId, projectId);
  }

  private requireWorkbenchMode(
    projectKind: AgentProjectKind,
    workbenchMode: string,
  ) {
    const definition = getModeDefinition(projectKind, workbenchMode);
    if (!definition) {
      throw new BadRequestException({
        code: 'AGENT_OS_WORKBENCH_MODE_UNSUPPORTED',
        message: `Workbench mode ${workbenchMode} is not available for ${projectKind} projects.`,
      });
    }
    return definition;
  }

  private async resolveWorkbenchContext(
    projectKind: AgentProjectKind,
    projectId: string,
    workbenchMode: string,
    context: Readonly<Record<string, string>> | undefined,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    if (projectKind === 'story') {
      const chapterId = context?.chapterId;
      const validated = await this.projects.requireStoryWorkbenchContext(
        projectId,
        typeof chapterId === 'string' ? { chapterId } : undefined,
      );
      return {
        ...validated,
        ...(context?.experience === 'mobile_h5'
          ? { experience: 'mobile_h5' }
          : {}),
      };
    }
    if (workbenchMode === 'canvas' || workbenchMode === 'storyboard') {
      const sectionId = context?.sectionId;
      return this.projects.requirePlatformWorkbenchContext(
        projectId,
        typeof sectionId === 'string' ? { sectionId } : undefined,
      );
    }
    if (context) {
      throw new BadRequestException({
        code: 'AGENT_OS_WORKBENCH_CONTEXT_UNSUPPORTED',
        message: 'This workbench mode does not accept a scoped context.',
      });
    }
    return undefined;
  }
}
