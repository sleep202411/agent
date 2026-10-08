import { backgroundTasksEnabled } from '../common/background-tasks';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, StoryAgentRunStatus } from '@prisma/client';
import {
  StoryProductionContinuationPlanSchema,
  type StoryProductionTargetStage,
} from '@repo/agent-tools';
import {
  isStoryAssetProposal,
  isStoryNoopProposal,
  isStoryPlotProposal,
  isStoryScreenplayProposal,
  isStoryStoryboardProposal,
  StoryAgentRunProposalSchema,
  StoryPatchBriefSchema,
} from '@repo/shared/story-agent';
import {
  AgentOsContinuationNotReadyError,
  AgentOsRunJournalService,
  storyProposalApplyToolCallId,
  type AgentOsJournalDispatch,
} from '../agent-os-journal/agent-os-run-journal.service';
import { PrismaService } from '../infra/db/db.module';
import { STORY_AGENT_MAX_AUTHORING_ATTEMPTS } from './story-agent-run.service';
import { storyAuthoringPublicError } from './story-authoring-public-error';

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 25;
const DELIVERY_LEASE_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60_000;
const LEGACY_SUCCESS_STATUSES = new Set<StoryAgentRunStatus>([
  StoryAgentRunStatus.proposed,
  StoryAgentRunStatus.applying,
  StoryAgentRunStatus.succeeded,
  // `failed` is an apply failure: the authoring job still produced the
  // reviewable proposal that completed this external handoff.
  StoryAgentRunStatus.failed,
]);

/**
 * Durable Story -> Agent OS continuation dispatcher.
 *
 * PostgreSQL claims disjoint rows with SKIP LOCKED, then one transaction locks
 * the Story job, re-reads its current outcome, appends the correlated Agent OS
 * result, and stamps delivery. A crash before commit changes nothing; a crash
 * after commit is recovered by the Agent OS realtime outbox.
 */
@Injectable()
export class StoryAgentRunContinuationWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(
    StoryAgentRunContinuationWorkerService.name,
  );
  private readonly enabled = optionalBoolean(
    process.env.STORY_AGENT_CONTINUATION_WORKER_ENABLED,
    true,
    'STORY_AGENT_CONTINUATION_WORKER_ENABLED',
  );
  private readonly workerId = `story-continuation:${hostname().slice(0, 48)}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AgentOsRunJournalService,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || this.timer) return;
    if (!this.enabled) {
      this.logger.log('Story Agent continuation worker is disabled');
      return;
    }
    const intervalMs = positiveInt(
      process.env.STORY_AGENT_CONTINUATION_WORKER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      'STORY_AGENT_CONTINUATION_WORKER_INTERVAL_MS',
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref?.();
    queueMicrotask(() => void this.drainOnce());
    this.logger.log(
      `Story Agent continuation worker polling every ${intervalMs}ms (${this.workerId})`,
    );
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(batch = DEFAULT_BATCH_SIZE): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (!this.enabled || this.stopping || this.draining) return;
    this.draining = true;
    try {
      const claimed = await this.claim(Math.max(1, Math.trunc(batch)));
      if (this.stopping) return;
      await Promise.all(claimed.map((candidate) => this.deliver(candidate)));
    } catch (error) {
      this.logger.warn(
        `Story Agent continuation drain failed: ${errorText(error)}`,
      );
    } finally {
      this.draining = false;
    }
  }

  private async claim(batch: number): Promise<ClaimedContinuation[]> {
    return this.prisma.$queryRaw<ClaimedContinuation[]>(Prisma.sql`
      WITH candidates AS (
        SELECT run."id"
        FROM "story_agent_runs" AS run
        WHERE run."source_agent_run_id" IS NOT NULL
          AND run."source_agent_turn_id" IS NOT NULL
          AND run."source_agent_tool_call_id" IS NOT NULL
          AND (
            (
              run."decision_contract_version" = 1
              AND run."source_result_delivered_at" IS NULL
              AND (
                run."status" IN ('proposed', 'applying', 'succeeded', 'failed', 'cancelled', 'stale')
                OR (
                  run."status" = 'authoring_failed'
                  AND run."authoring_attempts" >= ${STORY_AGENT_MAX_AUTHORING_ATTEMPTS}
                )
              )
            )
            OR (
              run."decision_contract_version" = 2
              AND run."source_terminal_delivered_at" IS NULL
              AND (
                (
                  run."source_proposal_ready_delivered_at" IS NULL
                  AND (
                    run."status" IN ('proposed', 'succeeded', 'failed', 'cancelled', 'stale')
                    OR (
                      run."status" = 'authoring_failed'
                      AND run."authoring_attempts" >= ${STORY_AGENT_MAX_AUTHORING_ATTEMPTS}
                    )
                  )
                )
                OR (
                  run."source_proposal_ready_delivered_at" IS NOT NULL
                  AND run."source_approval_decision" = 'approve'
                  AND run."source_approval_decision_turn_id" IS NOT NULL
                  AND (
                    run."status" IN ('succeeded', 'failed', 'cancelled', 'stale')
                    OR (
                      run."status" = 'authoring_failed'
                      AND run."authoring_attempts" >= ${STORY_AGENT_MAX_AUTHORING_ATTEMPTS}
                    )
                  )
                )
              )
            )
          )
          AND (
            run."source_result_delivery_next_attempt_at" IS NULL
            OR run."source_result_delivery_next_attempt_at" <= NOW()
          )
          AND (
            run."source_result_delivery_lease_expires_at" IS NULL
            OR run."source_result_delivery_lease_expires_at" <= NOW()
          )
        ORDER BY
          COALESCE(run."source_result_delivery_next_attempt_at", run."created_at") ASC,
          run."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.min(batch, 100)}
      )
      UPDATE "story_agent_runs" AS run
      SET
        "source_result_delivery_lease_owner" = ${this.workerId},
        "source_result_delivery_lease_expires_at" = NOW() + (${DELIVERY_LEASE_MS} * INTERVAL '1 millisecond'),
        "source_result_delivery_attempts" = run."source_result_delivery_attempts" + 1
      FROM candidates
      WHERE run."id" = candidates."id"
      RETURNING
        run."id",
        run."source_result_delivery_attempts" AS "attempt"
    `);
  }

  private async deliver(candidate: ClaimedContinuation): Promise<void> {
    if (this.stopping) return;
    try {
      const dispatch = await this.prisma.$transaction((tx) =>
        this.stopping
          ? Promise.resolve(null)
          : this.deliverInTransaction(tx, candidate.id),
      );
      if (dispatch) await this.journal.publishCommitted(dispatch);
    } catch (error) {
      try {
        await this.releaseForRetry(candidate, error);
      } catch (releaseError) {
        // A database outage can also prevent relinquishing the claim. Keep the
        // batch drain alive: the database lease is the recovery authority and
        // another pod will reclaim it after expiry.
        this.logger.warn(
          `Story Agent continuation could not release run=${candidate.id}: ${errorText(releaseError)}`,
        );
      }
      if (!isContinuationNotReady(error)) {
        this.logger.warn(
          `Story Agent continuation delivery failed run=${candidate.id}: ${errorText(error)}`,
        );
      }
    }
  }

  private async deliverInTransaction(
    tx: Prisma.TransactionClient,
    storyRunId: string,
  ): Promise<AgentOsJournalDispatch | null> {
    const identity = await tx.storyAgentRun.findUnique({
      where: { id: storyRunId },
      select: { storyProjectId: true },
    });
    if (!identity) return null;
    await tx.$queryRaw(
      Prisma.sql`SELECT "story_project_id" FROM "story_project_write_states" WHERE "story_project_id" = ${identity.storyProjectId}::uuid FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "story_agent_runs" WHERE "id" = ${storyRunId}::uuid FOR UPDATE`,
    );
    // Keep all commands on the interactive transaction connection strictly
    // ordered. Besides making the row-lock proof obvious, this avoids relying
    // on Prisma's implementation-specific handling of concurrent promises on
    // one transaction client.
    const run = await tx.storyAgentRun.findUnique({
      where: { id: storyRunId },
      select: {
        id: true,
        storyProjectId: true,
        storyChapterId: true,
        workspaceId: true,
        status: true,
        authoringAttempts: true,
        decisionContractVersion: true,
        proposal: true,
        sourceAgentRunId: true,
        sourceAgentTurnId: true,
        sourceAgentToolCallId: true,
        sourceCompletionMessage: true,
        sourceProposalReadyDeliveredAt: true,
        sourceAutoAppliedAt: true,
        sourceTerminalDeliveredAt: true,
        sourceApprovalDecision: true,
        sourceApprovalDecisionTurnId: true,
        sourceApprovalLocale: true,
        sourceResultDeliveredAt: true,
        sourceResultDeliveryLeaseOwner: true,
        sourceResultDeliveryLeaseExpiresAt: true,
        errorCode: true,
        errorDetail: true,
        project: { select: { defaultLocale: true } },
      },
    });
    const clock = await tx.$queryRaw<Array<{ databaseNow: Date }>>(
      Prisma.sql`SELECT NOW() AS "databaseNow"`,
    );
    const databaseNow = clock[0]?.databaseNow;
    if (!databaseNow) {
      throw new Error('PostgreSQL did not return a continuation clock value.');
    }
    if (
      !run ||
      run.sourceResultDeliveryLeaseOwner !== this.workerId ||
      !run.sourceResultDeliveryLeaseExpiresAt ||
      run.sourceResultDeliveryLeaseExpiresAt <= databaseNow
    ) {
      return null;
    }

    const phase = continuationPhase(run);
    if (!phase) {
      await clearClaim(tx, run.id, this.workerId);
      return null;
    }
    if (
      !run.sourceAgentRunId ||
      !run.sourceAgentTurnId ||
      !run.sourceAgentToolCallId
    ) {
      throw new Error(
        `Story Agent continuation ${run.id} has an incomplete source identity.`,
      );
    }

    const registration = await tx.agentOsExternalHandoffRegistration.findUnique(
      {
        where: { externalJobId: run.id },
      },
    );
    if (
      !registration ||
      registration.storyAgentRunId !== run.id ||
      registration.sourceAgentRunId !== run.sourceAgentRunId ||
      registration.sourceAgentTurnId !== run.sourceAgentTurnId ||
      registration.sourceAgentToolCallId !== run.sourceAgentToolCallId ||
      registration.sourceToolId !== 'story.author' ||
      registration.decisionContractVersion !== run.decisionContractVersion
    ) {
      throw new Error(
        `Story Agent continuation ${run.id} does not match its durable external-handoff registration.`,
      );
    }
    const continuationPlan = StoryProductionContinuationPlanSchema.safeParse(
      registration.continuationPlan,
    );

    let dispatch: AgentOsJournalDispatch;
    if (phase === 'legacy') {
      const result = continuationResult({
        status: run.status,
        authoringAttempts: run.authoringAttempts,
        completionMessage: registration.completionMessage,
        errorCode: run.errorCode,
        errorDetail: run.errorDetail,
        locale: run.project.defaultLocale,
        // Legacy `failed` rows with a fully authored proposal represent a
        // later apply failure. A stored drafting brief means authoring itself
        // failed and must be reported as such.
        failedMeansCompleted: !StoryPatchBriefSchema.safeParse(run.proposal)
          .success,
      });
      const handoffDispatch =
        await this.journal.reconcileExternalHandoffInTransaction(tx, run.id);
      const resultDispatch =
        await this.journal.appendExternalResultInTransaction(tx, {
          runId: run.sourceAgentRunId,
          turnId: run.sourceAgentTurnId,
          toolCallId: run.sourceAgentToolCallId,
          toolId: 'story.author',
          externalJobId: run.id,
          phase: 'authoring',
          ...result,
        });
      dispatch = mergeDispatches(handoffDispatch, resultDispatch);
    } else if (phase === 'proposal_ready') {
      const handoffDispatch =
        await this.journal.reconcileExternalHandoffInTransaction(tx, run.id);
      const proposal = storyProposalCopy(run.proposal);
      const durableProposal = StoryAgentRunProposalSchema.parse(run.proposal);
      const locale = run.sourceApprovalLocale ?? run.project.defaultLocale;
      const proposalDispatch =
        await this.journal.appendStoryProposalReadyInTransaction(tx, {
          runId: run.sourceAgentRunId,
          turnId: run.sourceAgentTurnId,
          authorToolCallId: run.sourceAgentToolCallId,
          externalJobId: run.id,
          storyProjectId: run.storyProjectId,
          storyChapterId: run.storyChapterId,
          workspaceId: run.workspaceId,
          stage: storyProposalStage(run.proposal),
          schemaVersion: durableProposal.schemaVersion,
          text: proposalReadyContinuationCopy(
            locale,
            storyProposalStage(run.proposal),
            continuationPlan.success
              ? continuationPlan.data.experience
              : undefined,
          ),
          title: proposal.title,
          summary: proposal.summary,
        });
      dispatch = mergeDispatches(handoffDispatch, proposalDispatch);
    } else if (phase === 'auto_apply_terminal') {
      const completedStage = storyProposalStage(run.proposal);
      const result = applyContinuationResult({
        status: run.status,
        authoringAttempts: run.authoringAttempts,
        errorCode: run.errorCode,
        errorDetail: run.errorDetail,
        locale: run.project.defaultLocale,
        stage: completedStage,
        autoApplyAssetSpecs:
          continuationPlan.success &&
          continuationPlan.data.experience === 'mobile_h5' &&
          continuationPlan.data.autoApplyAssetSpecs === true,
        autoGenerateAssetImages:
          continuationPlan.success &&
          continuationPlan.data.autoGenerateAssetImages === true,
        autoGenerateStoryboardMedia:
          continuationPlan.success &&
          continuationPlan.data.experience === 'mobile_h5' &&
          continuationPlan.data.autoGenerateStoryboardMedia === true,
        continueThrough: continuationPlan.success
          ? continuationPlan.data.continueThrough
          : completedStage === 'script' ||
              completedStage === 'plot' ||
              completedStage === 'assets' ||
              completedStage === 'storyboard'
            ? completedStage
            : undefined,
      });
      const handoffDispatch =
        await this.journal.reconcileExternalHandoffInTransaction(tx, run.id);
      const resultDispatch =
        await this.journal.appendExternalResultInTransaction(tx, {
          runId: run.sourceAgentRunId,
          turnId: run.sourceAgentTurnId,
          toolCallId: run.sourceAgentToolCallId,
          toolId: 'story.author',
          externalJobId: run.id,
          phase: 'apply',
          storyArtifact: {
            storyProjectId: run.storyProjectId,
            storyChapterId: run.storyChapterId,
            workspaceId: run.workspaceId,
            stage: completedStage,
            schemaVersion: StoryAgentRunProposalSchema.parse(run.proposal)
              .schemaVersion,
          },
          ...(result.outcome === 'completed' &&
          continuationPlan.success &&
          (completedStage === 'script' ||
            completedStage === 'plot' ||
            completedStage === 'assets' ||
            completedStage === 'storyboard')
            ? {
                storyContinuation: {
                  locale: storyContinuationLocale(run.project.defaultLocale),
                  plan: continuationPlan.data,
                  completedStage,
                },
              }
            : {}),
          ...result,
        });
      dispatch = mergeDispatches(handoffDispatch, resultDispatch);
    } else if (phase === 'authoring_terminal') {
      const result =
        run.status === StoryAgentRunStatus.succeeded &&
        storyProposalStage(run.proposal) === 'noop'
          ? noopContinuationResult(
              run.sourceApprovalLocale ?? run.project.defaultLocale,
            )
          : continuationResult({
              status: run.status,
              authoringAttempts: run.authoringAttempts,
              completionMessage: registration.completionMessage,
              errorCode: run.errorCode,
              errorDetail: run.errorDetail,
              locale: run.sourceApprovalLocale ?? run.project.defaultLocale,
            });
      const handoffDispatch =
        await this.journal.reconcileExternalHandoffInTransaction(tx, run.id);
      const resultDispatch =
        await this.journal.appendExternalResultInTransaction(tx, {
          runId: run.sourceAgentRunId,
          turnId: run.sourceAgentTurnId,
          toolCallId: run.sourceAgentToolCallId,
          toolId: 'story.author',
          externalJobId: run.id,
          phase: 'authoring',
          ...result,
        });
      dispatch = mergeDispatches(handoffDispatch, resultDispatch);
    } else {
      const completedProposalStage = storyProposalStage(run.proposal);
      const completedStage =
        completedProposalStage === 'script' ||
        completedProposalStage === 'plot' ||
        completedProposalStage === 'assets' ||
        completedProposalStage === 'storyboard'
          ? completedProposalStage
          : null;
      const result = applyContinuationResult({
        status: run.status,
        authoringAttempts: run.authoringAttempts,
        errorCode: run.errorCode,
        errorDetail: run.errorDetail,
        locale: run.sourceApprovalLocale,
        stage: storyProposalStage(run.proposal),
        autoApplyAssetSpecs:
          continuationPlan.success &&
          continuationPlan.data.experience === 'mobile_h5' &&
          continuationPlan.data.autoApplyAssetSpecs === true,
        autoGenerateAssetImages:
          continuationPlan.success &&
          continuationPlan.data.experience === 'mobile_h5' &&
          continuationPlan.data.autoGenerateAssetImages === true,
        autoGenerateStoryboardMedia:
          continuationPlan.success &&
          continuationPlan.data.experience === 'mobile_h5' &&
          continuationPlan.data.autoGenerateStoryboardMedia === true,
        continueThrough: continuationPlan.success
          ? continuationPlan.data.continueThrough
          : (completedStage ?? undefined),
      });
      const resultDispatch =
        await this.journal.appendExternalResultInTransaction(tx, {
          runId: run.sourceAgentRunId,
          turnId: run.sourceApprovalDecisionTurnId!,
          toolCallId: storyProposalApplyToolCallId(run.id),
          toolId: 'story.applyProposal',
          externalJobId: run.id,
          phase: 'apply',
          ...(result.outcome === 'completed' &&
          continuationPlan.success &&
          completedStage
            ? {
                storyContinuation: {
                  locale: storyContinuationLocale(
                    run.sourceApprovalLocale ?? run.project.defaultLocale,
                  ),
                  plan: continuationPlan.data,
                  completedStage,
                },
              }
            : {}),
          ...result,
        });
      dispatch = resultDispatch;
    }
    const delivered = await tx.storyAgentRun.updateMany({
      where: {
        id: run.id,
        status: run.status,
        authoringAttempts: run.authoringAttempts,
        ...(phase === 'legacy'
          ? { sourceResultDeliveredAt: null }
          : phase === 'proposal_ready'
            ? {
                sourceProposalReadyDeliveredAt: null,
                sourceTerminalDeliveredAt: null,
              }
            : { sourceTerminalDeliveredAt: null }),
        sourceResultDeliveryLeaseOwner: this.workerId,
      },
      data: {
        ...(phase === 'legacy'
          ? { sourceResultDeliveredAt: databaseNow }
          : phase === 'proposal_ready'
            ? {
                sourceProposalReadyDeliveredAt: databaseNow,
                sourceResultDeliveryAttempts: 0,
              }
            : { sourceTerminalDeliveredAt: databaseNow }),
        sourceResultDeliveryNextAttemptAt: null,
        sourceResultDeliveryLeaseOwner: null,
        sourceResultDeliveryLeaseExpiresAt: null,
        sourceResultDeliveryLastError: null,
      },
    });
    if (delivered.count !== 1) {
      throw new Error(
        `Story Agent continuation ${run.id} lost its delivery claim before commit.`,
      );
    }
    return dispatch;
  }

  private async releaseForRetry(
    candidate: ClaimedContinuation,
    error: unknown,
  ): Promise<void> {
    const delayMs = Math.min(
      MAX_RETRY_DELAY_MS,
      1_000 * 2 ** Math.min(Math.max(candidate.attempt - 1, 0), 6),
    );
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "story_agent_runs"
      SET
        "source_result_delivery_next_attempt_at" = NOW() + (${delayMs} * INTERVAL '1 millisecond'),
        "source_result_delivery_lease_owner" = NULL,
        "source_result_delivery_lease_expires_at" = NULL,
        "source_result_delivery_last_error" = ${errorText(error)}
      WHERE "id" = ${candidate.id}::uuid
        AND "source_result_delivery_lease_owner" = ${this.workerId}
        AND (
          (
            "decision_contract_version" = 1
            AND "source_result_delivered_at" IS NULL
          )
          OR (
            "decision_contract_version" = 2
            AND "source_terminal_delivered_at" IS NULL
          )
        )
    `);
  }
}

function storyContinuationLocale(
  locale: string | null,
): 'en-US' | 'zh-CN' | 'zh-HK' {
  return locale === 'zh-CN' || locale === 'zh-HK' ? locale : 'en-US';
}

interface ClaimedContinuation {
  id: string;
  attempt: number;
}

type ContinuationResult =
  | { outcome: 'completed'; text: string }
  | {
      outcome: 'failed' | 'cancelled';
      text: string;
      error: { code: string; message: string; retryable: boolean };
    };

type ContinuationPhase =
  | 'legacy'
  | 'proposal_ready'
  | 'auto_apply_terminal'
  | 'authoring_terminal'
  | 'apply_terminal';

function continuationPhase(input: {
  decisionContractVersion: number;
  status: StoryAgentRunStatus;
  authoringAttempts: number;
  sourceResultDeliveredAt: Date | null;
  sourceProposalReadyDeliveredAt: Date | null;
  sourceAutoAppliedAt: Date | null;
  sourceTerminalDeliveredAt: Date | null;
  sourceApprovalDecision: string | null;
  sourceApprovalDecisionTurnId: string | null;
}): ContinuationPhase | null {
  if (input.decisionContractVersion === 1) {
    if (input.sourceResultDeliveredAt !== null) return null;
    return LEGACY_SUCCESS_STATUSES.has(input.status) ||
      input.status === StoryAgentRunStatus.cancelled ||
      input.status === StoryAgentRunStatus.stale ||
      (input.status === StoryAgentRunStatus.authoring_failed &&
        input.authoringAttempts >= STORY_AGENT_MAX_AUTHORING_ATTEMPTS)
      ? 'legacy'
      : null;
  }
  if (
    input.decisionContractVersion !== 2 ||
    input.sourceTerminalDeliveredAt !== null
  ) {
    return null;
  }
  if (
    input.sourceAutoAppliedAt != null &&
    (input.status === StoryAgentRunStatus.succeeded ||
      input.status === StoryAgentRunStatus.failed ||
      input.status === StoryAgentRunStatus.cancelled ||
      input.status === StoryAgentRunStatus.stale)
  ) {
    return 'auto_apply_terminal';
  }
  if (input.sourceProposalReadyDeliveredAt === null) {
    if (input.status === StoryAgentRunStatus.proposed) return 'proposal_ready';
    if (
      input.status === StoryAgentRunStatus.succeeded ||
      input.status === StoryAgentRunStatus.failed ||
      input.status === StoryAgentRunStatus.cancelled ||
      input.status === StoryAgentRunStatus.stale ||
      (input.status === StoryAgentRunStatus.authoring_failed &&
        input.authoringAttempts >= STORY_AGENT_MAX_AUTHORING_ATTEMPTS)
    ) {
      return 'authoring_terminal';
    }
    return null;
  }
  if (
    input.sourceApprovalDecision === 'approve' &&
    input.sourceApprovalDecisionTurnId !== null &&
    (input.status === StoryAgentRunStatus.succeeded ||
      input.status === StoryAgentRunStatus.failed ||
      input.status === StoryAgentRunStatus.cancelled ||
      input.status === StoryAgentRunStatus.stale ||
      (input.status === StoryAgentRunStatus.authoring_failed &&
        input.authoringAttempts >= STORY_AGENT_MAX_AUTHORING_ATTEMPTS))
  ) {
    return 'apply_terminal';
  }
  return null;
}

function continuationResult(input: {
  status: StoryAgentRunStatus;
  authoringAttempts: number;
  completionMessage: string;
  errorCode: string | null;
  errorDetail: string | null;
  locale: string | null;
  failedMeansCompleted?: boolean;
}): ContinuationResult {
  if (
    input.status === StoryAgentRunStatus.proposed ||
    input.status === StoryAgentRunStatus.applying ||
    input.status === StoryAgentRunStatus.succeeded ||
    (input.status === StoryAgentRunStatus.failed &&
      input.failedMeansCompleted === true)
  ) {
    return { outcome: 'completed', text: input.completionMessage };
  }

  if (
    input.status === StoryAgentRunStatus.failed ||
    (input.status === StoryAgentRunStatus.authoring_failed &&
      input.authoringAttempts >= STORY_AGENT_MAX_AUTHORING_ATTEMPTS)
  ) {
    const publicError = storyAuthoringPublicError(
      input.errorCode,
      input.locale ?? 'en-US',
    );
    const text = publicError.detail;
    return {
      outcome: 'failed',
      text,
      error: {
        code: publicError.code,
        message: text,
        retryable: false,
      },
    };
  }

  const text =
    input.errorDetail ??
    (input.status === StoryAgentRunStatus.cancelled
      ? 'The Story authoring request was cancelled.'
      : 'The Story authoring request became stale before it could complete.');
  return {
    outcome: 'cancelled',
    text,
    error: {
      code:
        input.errorCode ??
        (input.status === StoryAgentRunStatus.cancelled
          ? 'STORY_AGENT_CANCELLED'
          : 'STORY_AGENT_STALE'),
      message: text,
      retryable: false,
    },
  };
}

function applyContinuationResult(input: {
  status: StoryAgentRunStatus;
  authoringAttempts: number;
  errorCode: string | null;
  errorDetail: string | null;
  locale: string | null;
  stage: StoryProposalStage;
  autoApplyAssetSpecs: boolean;
  autoGenerateAssetImages: boolean;
  autoGenerateStoryboardMedia: boolean;
  continueThrough: StoryProductionTargetStage | undefined;
}): ContinuationResult {
  const copy = applyContinuationCopy(
    input.locale,
    input.stage,
    input.autoApplyAssetSpecs,
    input.autoGenerateAssetImages,
    input.autoGenerateStoryboardMedia,
    input.continueThrough,
  );
  if (input.status === StoryAgentRunStatus.succeeded) {
    return {
      outcome: 'completed',
      text: copy.completed,
    };
  }
  if (
    input.status === StoryAgentRunStatus.authoring_failed &&
    input.authoringAttempts >= STORY_AGENT_MAX_AUTHORING_ATTEMPTS
  ) {
    const publicError = storyAuthoringPublicError(
      input.errorCode ?? 'STORY_AGENT_APPLY_FAILED',
      input.locale ?? 'en-US',
    );
    const text = publicError.detail;
    return {
      outcome: 'failed',
      text,
      error: {
        code: publicError.code,
        message: text,
        retryable: false,
      },
    };
  }
  const cancelled =
    input.status === StoryAgentRunStatus.cancelled ||
    input.status === StoryAgentRunStatus.stale;
  const text = cancelled
    ? copy.cancelled
    : storyAuthoringPublicError(
        input.errorCode ?? 'STORY_AGENT_APPLY_FAILED',
        input.locale ?? 'en-US',
      ).detail;
  return {
    outcome: cancelled ? 'cancelled' : 'failed',
    text,
    error: {
      code:
        input.errorCode ??
        (cancelled
          ? 'STORY_AGENT_APPLY_CANCELLED'
          : 'STORY_AGENT_APPLY_FAILED'),
      message: text,
      retryable: false,
    },
  };
}

function applyContinuationCopy(
  locale: string | null,
  stage: StoryProposalStage,
  autoApplyAssetSpecs: boolean,
  autoGenerateAssetImages: boolean,
  autoGenerateStoryboardMedia: boolean,
  continueThrough: StoryProductionTargetStage | undefined,
): {
  completed: string;
  cancelled: string;
  failed: string;
} {
  const hasLaterStage = storyStageHasLaterTarget(stage, continueThrough);
  if (locale === 'zh-CN') {
    const completed =
      stage === 'script'
        ? hasLaterStage
          ? '剧本已保存。正在构建情节树。'
          : '剧本已保存。'
        : stage === 'plot'
          ? hasLaterStage
            ? autoApplyAssetSpecs
              ? '情节树已保存。正在构建资产规格。'
              : '情节树已保存。正在准备资产规格供你单独审核；本次应用没有生成图片或视频。'
            : '情节树已保存。'
          : stage === 'assets'
            ? autoGenerateAssetImages
              ? '资产规格已保存。接下来逐张生成资产图片。'
              : hasLaterStage
                ? '资产规格已保存。正在准备分镜规格供你单独审核；本阶段没有生成图片或视频。'
                : '资产规格已保存。本阶段只写入角色、场景与道具等逻辑规格，没有生成图片或视频。'
            : stage === 'storyboard'
              ? autoGenerateStoryboardMedia
                ? '分镜已保存。接下来逐个生成卡片中的片段。'
                : '分镜规格已保存。本阶段只写入镜头与时间轴规格，没有生成任何图片或视频。'
              : '已批准的故事提案已应用。';
    return {
      completed,
      cancelled: '故事提案的应用在完成前已取消。',
      failed: '无法应用已批准的故事提案。',
    };
  }
  if (locale === 'zh-HK') {
    const completed =
      stage === 'script'
        ? hasLaterStage
          ? '劇本已儲存。正在構建情節樹。'
          : '劇本已儲存。'
        : stage === 'plot'
          ? hasLaterStage
            ? autoApplyAssetSpecs
              ? '情節樹已儲存。正在構建資產規格。'
              : '情節樹已儲存。正在準備資產規格供你單獨審核；本次套用沒有生成圖片或影片。'
            : '情節樹已儲存。'
          : stage === 'assets'
            ? autoGenerateAssetImages
              ? '資產規格已儲存。接下來逐張生成資產圖片。'
              : hasLaterStage
                ? '資產規格已儲存。正在準備分鏡規格供你單獨審核；本階段沒有生成圖片或影片。'
                : '資產規格已儲存。本階段只寫入角色、場景與道具等邏輯規格，沒有生成圖片或影片。'
            : stage === 'storyboard'
              ? autoGenerateStoryboardMedia
                ? '分鏡已儲存。接下來逐個生成卡片中的片段。'
                : '分鏡規格已儲存。本階段只寫入鏡頭與時間軸規格，沒有生成任何圖片或影片。'
              : '已核准的故事提案已套用。';
    return {
      completed,
      cancelled: '故事提案的套用在完成前已取消。',
      failed: '無法套用已核准的故事提案。',
    };
  }
  const completed =
    stage === 'script'
      ? hasLaterStage
        ? 'The Script is saved. Building the Plot Tree next.'
        : 'The Script is saved.'
      : stage === 'plot'
        ? hasLaterStage
          ? autoApplyAssetSpecs
            ? 'The Plot Tree is saved. Building the Asset Specs next.'
            : 'The Plot Tree is saved. Preparing the Asset Specs for separate review; this apply generated no images or videos.'
          : 'The Plot Tree is saved.'
        : stage === 'assets'
          ? autoGenerateAssetImages
            ? 'The Asset Specs are saved. Asset images will generate one at a time next.'
            : hasLaterStage
              ? 'The Asset Specs are saved. Preparing the Storyboard Specs for separate review; this stage generated no images or videos.'
              : 'The Asset Specs were saved. This stage writes only logical character, location, and prop specifications; it generated no images or videos.'
          : stage === 'storyboard'
            ? autoGenerateStoryboardMedia
              ? 'The Storyboard is saved. Its clips will generate one at a time next.'
              : 'The Storyboard Specs were saved. This stage writes only shot and timeline specifications; it generated no images or videos.'
            : 'The approved story proposal was applied.';
  return {
    completed,
    cancelled: 'Story proposal application was cancelled before it completed.',
    failed: 'The approved story proposal could not be applied.',
  };
}

function storyStageHasLaterTarget(
  stage: StoryProposalStage,
  continueThrough: StoryProductionTargetStage | undefined,
): boolean {
  if (!continueThrough) return false;
  const order = ['script', 'plot', 'assets', 'storyboard'] as const;
  const stageIndex = order.indexOf(stage as (typeof order)[number]);
  return stageIndex >= 0 && order.indexOf(continueThrough) > stageIndex;
}

type StoryProposalStage =
  | 'script'
  | 'plot'
  | 'assets'
  | 'storyboard'
  | 'noop'
  | 'patch';

function storyProposalStage(value: Prisma.JsonValue): StoryProposalStage {
  const parsed = StoryAgentRunProposalSchema.safeParse(value);
  if (!parsed.success) return 'patch';
  const proposal = parsed.data;
  if (isStoryScreenplayProposal(proposal)) return 'script';
  if (isStoryPlotProposal(proposal)) return 'plot';
  if (isStoryAssetProposal(proposal)) return 'assets';
  if (isStoryStoryboardProposal(proposal)) return 'storyboard';
  if (isStoryNoopProposal(proposal)) return 'noop';
  return 'patch';
}

function proposalReadyContinuationCopy(
  locale: string | null,
  stage: StoryProposalStage,
  experience?: 'mobile_h5',
): string {
  if (locale === 'zh-CN') {
    if (stage === 'script')
      return experience === 'mobile_h5'
        ? '剧本已起草。请选择「继续」或「不继续」。'
        : '剧本提案已准备好供你审核；批准后只会保存 Script。';
    if (stage === 'plot')
      return experience === 'mobile_h5'
        ? '情节树已构建。选择「继续」后会自动构建资产并逐张生成图片。'
        : '情节树提案已准备好供你审核；批准后只会保存情节树。';
    if (stage === 'assets')
      return experience === 'mobile_h5'
        ? '资产规格已准备好。选择「继续」后会按顺序逐张生成图片；每张开始生成时扣除对应积分，完成后自动回填。'
        : '资产规格提案已准备好供你审核；批准后只会保存逻辑规格，不会生成媒体。';
    if (stage === 'storyboard')
      return experience === 'mobile_h5'
        ? '分镜已准备好。选择「继续」后会按故事顺序逐卡片、逐片段生成。'
        : '分镜提案已准备好供你审核；批准后只会保存分镜规格，不会生成媒体。';
    return '故事提案已准备好供你审核。';
  }
  if (locale === 'zh-HK') {
    if (stage === 'script')
      return experience === 'mobile_h5'
        ? '劇本已起草。請選擇「繼續」或「不繼續」。'
        : '劇本提案已準備好供你審核；核准後只會儲存 Script。';
    if (stage === 'plot')
      return experience === 'mobile_h5'
        ? '情節樹已構建。選擇「繼續」後會自動構建資產並逐張生成圖片。'
        : '情節樹提案已準備好供你審核；核准後只會儲存情節樹。';
    if (stage === 'assets')
      return experience === 'mobile_h5'
        ? '資產規格已準備好。選擇「繼續」後會按順序逐張生成圖片；每張開始生成時扣除對應積分，完成後自動回填。'
        : '資產規格提案已準備好供你審核；核准後只會儲存邏輯規格，不會生成媒體。';
    if (stage === 'storyboard')
      return experience === 'mobile_h5'
        ? '分鏡已準備好。選擇「繼續」後會按故事順序逐卡片、逐片段生成。'
        : '分鏡提案已準備好供你審核；核准後只會儲存分鏡規格，不會生成媒體。';
    return '故事提案已準備好供你審核。';
  }
  if (stage === 'script') {
    return experience === 'mobile_h5'
      ? 'The Script is drafted. Choose Continue or Don’t continue.'
      : 'The Script proposal is ready for review; approval saves only Script.';
  }
  if (stage === 'plot') {
    return experience === 'mobile_h5'
      ? 'The Plot Tree is built. Continue to build the Assets and generate their images one at a time.'
      : 'The Plot proposal is ready for review; approval saves only the Plot Tree.';
  }
  if (stage === 'assets') {
    return experience === 'mobile_h5'
      ? 'The Asset Specs are ready. Continuing generates images sequentially; credits are charged as each image starts, and completed images fill in automatically.'
      : 'The Asset Specs proposal is ready for review; approval saves logical specs only and generates no media.';
  }
  if (stage === 'storyboard') {
    return experience === 'mobile_h5'
      ? 'The Storyboard is ready. Continue to generate every card and clip in story order.'
      : 'The Storyboard proposal is ready for review; approval saves Storyboard Specs only and generates no media.';
  }
  return 'The Story proposal is ready for review.';
}

function noopContinuationResult(locale: string | null): ContinuationResult {
  if (locale === 'zh-CN') {
    return {
      outcome: 'completed',
      text: 'Script、情节树、资产规格与分镜规格都已经是最新状态；本次没有写入内容，也没有生成任何图片或视频。',
    };
  }
  if (locale === 'zh-HK') {
    return {
      outcome: 'completed',
      text: 'Script、情節樹、資產規格與分鏡規格都已經是最新狀態；本次沒有寫入內容，也沒有生成任何圖片或影片。',
    };
  }
  return {
    outcome: 'completed',
    text: 'Script, Plot Tree, Asset Specs, and Storyboard Specs are already current. This run wrote nothing and generated no images or videos.',
  };
}

function storyProposalCopy(value: Prisma.JsonValue): {
  title: string;
  summary: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Story proposal payload is not an object.');
  }
  const title = value.title;
  const summary = value.summary;
  if (typeof title !== 'string' || typeof summary !== 'string') {
    throw new Error('Story proposal title and summary are missing.');
  }
  return { title, summary };
}

function mergeDispatches(
  first: AgentOsJournalDispatch,
  second: AgentOsJournalDispatch,
): AgentOsJournalDispatch {
  return {
    events: [...first.events, ...second.events],
    snapshot: second.snapshot,
  };
}

async function clearClaim(
  tx: Prisma.TransactionClient,
  runId: string,
  workerId: string,
): Promise<void> {
  await tx.storyAgentRun.updateMany({
    where: {
      id: runId,
      sourceResultDeliveryLeaseOwner: workerId,
      OR: [
        { decisionContractVersion: 1, sourceResultDeliveredAt: null },
        { decisionContractVersion: 2, sourceTerminalDeliveredAt: null },
      ],
    },
    data: {
      sourceResultDeliveryNextAttemptAt: null,
      sourceResultDeliveryLeaseOwner: null,
      sourceResultDeliveryLeaseExpiresAt: null,
    },
  });
}

function isContinuationNotReady(error: unknown): boolean {
  if (error instanceof AgentOsContinuationNotReadyError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'AGENT_OS_CONTINUATION_NOT_READY'
  );
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1_000,
  );
}

function optionalBoolean(
  raw: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean value.`);
}

function positiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
