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
  AgentOsContinuationNotReadyError,
  AgentOsRunJournalService,
  storyProposalApplyToolCallId,
  type AgentOsJournalDispatch,
} from '../agent-os-journal/agent-os-run-journal.service';
import { PrismaService } from '../infra/db/db.module';
import { STORY_AGENT_MAX_AUTHORING_ATTEMPTS } from './story-agent-run.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AgentOsRunJournalService,
  ) {}

  onApplicationBootstrap(): void {
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
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(batch = DEFAULT_BATCH_SIZE): Promise<void> {
    if (!this.enabled || this.draining) return;
    this.draining = true;
    try {
      const claimed = await this.claim(Math.max(1, Math.trunc(batch)));
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
    try {
      const dispatch = await this.prisma.$transaction((tx) =>
        this.deliverInTransaction(tx, candidate.id),
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
        status: true,
        authoringAttempts: true,
        decisionContractVersion: true,
        proposal: true,
        sourceAgentRunId: true,
        sourceAgentTurnId: true,
        sourceAgentToolCallId: true,
        sourceCompletionMessage: true,
        sourceProposalReadyDeliveredAt: true,
        sourceTerminalDeliveredAt: true,
        sourceApprovalDecision: true,
        sourceApprovalDecisionTurnId: true,
        sourceApprovalLocale: true,
        sourceResultDeliveredAt: true,
        sourceResultDeliveryLeaseOwner: true,
        sourceResultDeliveryLeaseExpiresAt: true,
        errorCode: true,
        errorDetail: true,
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

    let dispatch: AgentOsJournalDispatch;
    if (phase === 'legacy') {
      const result = continuationResult({
        status: run.status,
        authoringAttempts: run.authoringAttempts,
        completionMessage: registration.completionMessage,
        errorCode: run.errorCode,
        errorDetail: run.errorDetail,
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
      const proposalDispatch =
        await this.journal.appendStoryProposalReadyInTransaction(tx, {
          runId: run.sourceAgentRunId,
          turnId: run.sourceAgentTurnId,
          authorToolCallId: run.sourceAgentToolCallId,
          externalJobId: run.id,
          text: run.sourceCompletionMessage ?? registration.completionMessage,
          title: proposal.title,
          summary: proposal.summary,
        });
      dispatch = mergeDispatches(handoffDispatch, proposalDispatch);
    } else if (phase === 'authoring_terminal') {
      const result = continuationResult({
        status: run.status,
        authoringAttempts: run.authoringAttempts,
        completionMessage: registration.completionMessage,
        errorCode: run.errorCode,
        errorDetail: run.errorDetail,
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
      const result = applyContinuationResult({
        status: run.status,
        authoringAttempts: run.authoringAttempts,
        errorCode: run.errorCode,
        errorDetail: run.errorDetail,
        locale: run.sourceApprovalLocale,
      });
      const resultDispatch =
        await this.journal.appendExternalResultInTransaction(tx, {
          runId: run.sourceAgentRunId,
          turnId: run.sourceApprovalDecisionTurnId!,
          toolCallId: storyProposalApplyToolCallId(run.id),
          toolId: 'story.applyProposal',
          externalJobId: run.id,
          phase: 'apply',
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
  | 'authoring_terminal'
  | 'apply_terminal';

function continuationPhase(input: {
  decisionContractVersion: number;
  status: StoryAgentRunStatus;
  authoringAttempts: number;
  sourceResultDeliveredAt: Date | null;
  sourceProposalReadyDeliveredAt: Date | null;
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
}): ContinuationResult {
  if (LEGACY_SUCCESS_STATUSES.has(input.status)) {
    return { outcome: 'completed', text: input.completionMessage };
  }

  if (
    input.status === StoryAgentRunStatus.authoring_failed &&
    input.authoringAttempts >= STORY_AGENT_MAX_AUTHORING_ATTEMPTS
  ) {
    const text =
      input.errorDetail ??
      'Story authoring exhausted its retry budget before a reviewable proposal was created.';
    return {
      outcome: 'failed',
      text,
      error: {
        code: input.errorCode ?? 'STORY_AGENT_AUTHORING_FAILED',
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
}): ContinuationResult {
  const copy = applyContinuationCopy(input.locale);
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
    const text = input.errorDetail ?? copy.failed;
    return {
      outcome: 'failed',
      text,
      error: {
        code: input.errorCode ?? 'STORY_AGENT_APPLY_FAILED',
        message: text,
        retryable: false,
      },
    };
  }
  const cancelled =
    input.status === StoryAgentRunStatus.cancelled ||
    input.status === StoryAgentRunStatus.stale;
  const text = input.errorDetail ?? (cancelled ? copy.cancelled : copy.failed);
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

function applyContinuationCopy(locale: string | null): {
  completed: string;
  cancelled: string;
  failed: string;
} {
  if (locale === 'zh-CN') {
    return {
      completed:
        '已批准的剧本已写入 Script，并据此构建了情节树、资产规格与分镜时间轴。尚未生成任何图片或视频——准备好后，请在资产页与分镜页点击生成。',
      cancelled: '故事提案的应用在完成前已取消。',
      failed: '无法应用已批准的故事提案。',
    };
  }
  if (locale === 'zh-HK') {
    return {
      completed:
        '已核准的劇本已寫入 Script，並據此構建了情節樹、資產規格與分鏡時間軸。尚未生成任何圖片或影片——準備好後，請在資產頁與分鏡頁點擊生成。',
      cancelled: '故事提案的套用在完成前已取消。',
      failed: '無法套用已核准的故事提案。',
    };
  }
  return {
    completed:
      'The approved screenplay is saved to Script, and the Plot Tree, Asset Specs, and Storyboard were built from it. No images or videos have been generated yet — use Generate on the Assets and Storyboard pages when you are ready.',
    cancelled: 'Story proposal application was cancelled before it completed.',
    failed: 'The approved story proposal could not be applied.',
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
