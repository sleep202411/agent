import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AGENT_OS_ABLY_EVENT_NAME,
  AGENT_OS_ABLY_RESYNC_NAME,
  AGENT_OS_ABLY_SNAPSHOT_NAME,
  agentOsConversationChannel,
  type AgentOsAblyResyncPointer,
  type AgentOsAblyRunSnapshot,
} from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import {
  ABLY_REST_CLIENT,
  type AblyRestClient,
} from '../infra/realtime/ably-token-credentials';
import {
  eventRowToEnvelope,
  journalErrorText,
  toRealtimeSnapshot,
} from './agent-os-journal.mapper';
import {
  type IndividuallyIdempotentAblyMessage,
  isWithinAblyRealtimeMessageBudget,
  publishIndividuallyIdempotentAblyBatch,
} from './ably-individually-idempotent-batch';

const SWEEP_INTERVAL_MS = 2_000;
const LEASE_DURATION_MS = 30_000;
const LEASE_RENEW_INTERVAL_MS = 10_000;
const EVENT_BATCH_SIZE = 500;
const LIVE_EVENT_BATCH_LIMIT = 20;
const SWEEP_CONVERSATION_CONCURRENCY = 4;

type TransactionClient = Prisma.TransactionClient;

type ConversationRunRow = {
  id: string;
  projectId: string;
  conversationId: string;
  createdAt: Date;
  lastSequence: number;
  realtimeSnapshotSequence: number;
  realtimePublishLeaseId: string | null;
  realtimePublishLeaseExpiresAt: Date | null;
};

type ConversationClaim = {
  projectId: string;
  conversationId: string;
  leaseId: string;
  /** Rows retained as sentinels until the entire conversation is drained. */
  leasedRunIds: readonly string[];
};

type ClaimedConversation = ConversationClaim & {
  pendingRunIds: readonly string[];
};

type OwnedResult<T> =
  | { owned: true; value: T }
  | { owned: false; value?: never };

class ConversationLeaseLostError extends Error {
  constructor(conversationId: string, cause?: unknown) {
    super(`Agent OS realtime conversation lease lost: ${conversationId}`, {
      cause,
    });
    this.name = 'ConversationLeaseLostError';
  }
}

/**
 * PostgreSQL-backed realtime outbox for Agent OS.
 *
 * Event sequence numbers are per run, but the client channel is per
 * conversation. Consequently a run-scoped lease is not a sufficient ordering
 * boundary: a fast new run can otherwise overtake the terminal suffix of the
 * previous run. This dispatcher claims every pending run in one conversation,
 * keeps at least one leased run row as a conversation sentinel, and drains runs
 * by durable creation order before releasing the gate.
 *
 * Lease authority always comes from PostgreSQL's clock. Heartbeats fence long
 * Ably publishes, and every acknowledgement re-validates ownership under row
 * locks. Stable Ably ids keep a publish-before-ack crash retry idempotent. HTTP
 * journal replay remains authoritative while realtime is unavailable.
 */
@Injectable()
export class AgentOsRealtimeOutboxService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AgentOsRealtimeOutboxService.name);
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweepActive = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ABLY_REST_CLIENT) private readonly ably: AblyRestClient,
  ) {}

  onModuleInit(): void {
    if (!backgroundTasksEnabled()) return;
    this.sweepTimer = setInterval(() => {
      void this.flushPending();
    }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
    void this.flushPending();
  }

  onApplicationShutdown(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  schedule(runId: string): void {
    if (!backgroundTasksEnabled()) return;
    void this.publishRun(runId).catch((error) => {
      this.logger.warn(
        `Agent OS realtime outbox scheduling failed run=${runId}: ${journalErrorText(error)}`,
      );
    });
  }

  /**
   * Claims the target run's conversation and drains every committed pending
   * run in that conversation. Public for focused operational tests.
   */
  async publishRun(runId: string): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const leaseId = randomUUID();
    let claimed = await this.claimConversation(runId, leaseId);
    if (!claimed) return;

    let attemptedIds: readonly string[] = [];
    try {
      while (true) {
        const claim = toClaim(claimed);
        for (const pendingRunId of claimed.pendingRunIds) {
          await this.publishClaimedRun(claim, pendingRunId, (ids) => {
            attemptedIds = ids;
          });
          attemptedIds = [];
        }

        const next = await this.extendOrReleaseConversation(claim);
        if (!next.owned) {
          throw new ConversationLeaseLostError(claim.conversationId);
        }
        if (next.value === null) return;
        claimed = next.value;
      }
    } catch (error) {
      if (error instanceof ConversationLeaseLostError) {
        this.logger.warn(error.message);
        return;
      }
      await this.recordFailure(toClaim(claimed), attemptedIds, error);
    }
  }

  private async claimConversation(
    runId: string,
    leaseId: string,
  ): Promise<ClaimedConversation | null> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.agentOsRun.findUnique({
        where: { id: runId },
        select: { projectId: true, conversationId: true },
      });
      if (!target) return null;

      const runs = await lockAndLoadConversationRuns(
        tx,
        target.projectId,
        target.conversationId,
      );
      const now = await databaseNow(tx);
      if (hasActiveLease(runs, now)) return null;

      const pending = pendingRuns(runs);
      if (pending.length === 0) return null;

      const pendingRunIds = pending.map((run) => run.id);
      const leased = await tx.agentOsRun.updateMany({
        where: { id: { in: pendingRunIds } },
        data: {
          realtimePublishLeaseId: leaseId,
          realtimePublishLeaseExpiresAt: leaseExpiry(now),
        },
      });
      if (leased.count !== pendingRunIds.length) {
        throw new Error(
          `Could not atomically lease Agent OS conversation ${target.conversationId}`,
        );
      }
      return {
        projectId: target.projectId,
        conversationId: target.conversationId,
        leaseId,
        leasedRunIds: pendingRunIds,
        pendingRunIds,
      };
    });
  }

  private async publishClaimedRun(
    claim: ConversationClaim,
    runId: string,
    onAttemptedIds: (ids: readonly string[]) => void,
  ): Promise<void> {
    while (true) {
      while (true) {
        const prepared = await this.withOwnedConversation(claim, async (tx) => {
          const rows = await tx.agentOsRunEvent.findMany({
            where: { runId, realtimePublishedAt: null },
            orderBy: { sequence: 'asc' },
            take: EVENT_BATCH_SIZE,
          });
          if (rows.length > 0) {
            await tx.agentOsRunEvent.updateMany({
              where: {
                id: { in: rows.map((row) => row.id) },
                realtimePublishedAt: null,
              },
              data: {
                realtimePublishAttempts: { increment: 1 },
                realtimePublishLastError: null,
              },
            });
          }
          return rows;
        });
        if (!prepared.owned) {
          throw new ConversationLeaseLostError(claim.conversationId);
        }

        const rows = prepared.value;
        if (rows.length === 0) break;
        const attemptedIds = rows.map((row) => row.id);
        onAttemptedIds(attemptedIds);

        const events = rows.map(eventRowToEnvelope);
        if (
          events.some((event) => event.conversationId !== claim.conversationId)
        ) {
          throw new Error(
            `Agent OS run ${runId} contains an event for another conversation`,
          );
        }
        const channelName = agentOsConversationChannel(claim.conversationId);
        const markPublished = async (ids: readonly string[]) => {
          const marked = await this.withOwnedConversation(
            claim,
            async (tx, now) =>
              tx.agentOsRunEvent.updateMany({
                where: {
                  id: { in: [...ids] },
                  realtimePublishedAt: null,
                },
                data: {
                  realtimePublishedAt: now,
                  realtimePublishLastError: null,
                },
              }),
          );
          if (!marked.owned) {
            throw new ConversationLeaseLostError(claim.conversationId);
          }
          if (marked.value.count !== ids.length) {
            throw new Error(
              `Agent OS realtime event acknowledgement count mismatch run=${runId}`,
            );
          }
        };
        await this.withLeaseHeartbeat(claim, async () => {
          if (events.length > LIVE_EVENT_BATCH_LIMIT) {
            const first = events[0];
            const last = events[events.length - 1];
            await publishIndividuallyIdempotentAblyBatch(
              this.ably,
              channelName,
              [
                checkedResyncMessage(channelName, `resync:backlog:${last.id}`, {
                  version: 1,
                  kind: 'event_backlog',
                  runId,
                  conversationId: claim.conversationId,
                  sequence: last.sequence,
                  afterSequence: Math.max(0, first.sequence - 1),
                  eventId: last.id,
                }),
              ],
            );
            await markPublished(attemptedIds);
          } else {
            const messages = events.map((event) =>
              realtimeEventMessage(channelName, event),
            );
            const eventIdByMessageId = new Map(
              messages.map((message, index) => [message.id, events[index].id]),
            );
            await publishIndividuallyIdempotentAblyBatch(
              this.ably,
              channelName,
              messages,
              (ids) =>
                markPublished(ids.map((id) => eventIdByMessageId.get(id)!)),
            );
          }
        });
        onAttemptedIds([]);
      }

      const state = await this.withOwnedConversation(claim, async (tx) => {
        const run = await tx.agentOsRun.findUniqueOrThrow({
          where: { id: runId },
        });
        const remaining = await tx.agentOsRunEvent.count({
          where: { runId, realtimePublishedAt: null },
        });
        if (remaining > 0) return null;
        return {
          snapshot: toRealtimeSnapshot(
            run,
            await currentPendingUserInput(tx, runId),
          ),
          sequence: run.lastSequence,
        };
      });
      if (!state.owned) {
        throw new ConversationLeaseLostError(claim.conversationId);
      }
      if (!state.value) {
        // An event was committed between the empty-batch observation and the
        // snapshot transaction. Loop this run before any newer run.
        continue;
      }
      const snapshotState = state.value;

      const channelName = agentOsConversationChannel(claim.conversationId);
      const snapshotMessage = realtimeSnapshotMessage(
        channelName,
        snapshotState.snapshot,
        snapshotState.sequence,
      );
      await this.withLeaseHeartbeat(claim, () =>
        publishIndividuallyIdempotentAblyBatch(this.ably, channelName, [
          snapshotMessage,
        ]),
      );

      const advanced = await this.withOwnedConversation(claim, (tx) =>
        tx.agentOsRun.updateMany({
          where: {
            id: runId,
            realtimePublishLeaseId: claim.leaseId,
            realtimeSnapshotSequence: { lt: snapshotState.sequence },
          },
          data: { realtimeSnapshotSequence: snapshotState.sequence },
        }),
      );
      if (!advanced.owned) {
        throw new ConversationLeaseLostError(claim.conversationId);
      }
      if (advanced.value.count !== 1) {
        throw new Error(
          `Agent OS realtime snapshot acknowledgement failed run=${runId}`,
        );
      }
      return;
    }
  }

  /**
   * Reconciles events committed while a publish was in flight. If no work
   * remains, the same row-lock transaction releases every sentinel so another
   * pod cannot enter the conversation between the final check and release.
   */
  private async extendOrReleaseConversation(
    claim: ConversationClaim,
  ): Promise<OwnedResult<ClaimedConversation | null>> {
    return this.prisma.$transaction(async (tx) => {
      const runs = await lockAndLoadConversationRuns(
        tx,
        claim.projectId,
        claim.conversationId,
      );
      const now = await databaseNow(tx);
      if (!ownsConversation(runs, claim, now)) return { owned: false };

      const pending = pendingRuns(runs);
      if (pending.length === 0) {
        await tx.agentOsRun.updateMany({
          where: {
            projectId: claim.projectId,
            conversationId: claim.conversationId,
            realtimePublishLeaseId: claim.leaseId,
          },
          data: {
            realtimePublishLeaseId: null,
            realtimePublishLeaseExpiresAt: null,
          },
        });
        return { owned: true, value: null };
      }

      const pendingRunIds = pending.map((run) => run.id);
      const leasedRunIds = uniqueIds([...claim.leasedRunIds, ...pendingRunIds]);
      const renewed = await tx.agentOsRun.updateMany({
        where: { id: { in: leasedRunIds } },
        data: {
          realtimePublishLeaseId: claim.leaseId,
          realtimePublishLeaseExpiresAt: leaseExpiry(now),
        },
      });
      if (renewed.count !== leasedRunIds.length) {
        return { owned: false };
      }
      return {
        owned: true,
        value: {
          projectId: claim.projectId,
          conversationId: claim.conversationId,
          leaseId: claim.leaseId,
          leasedRunIds,
          pendingRunIds,
        },
      };
    });
  }

  private async withOwnedConversation<T>(
    claim: ConversationClaim,
    operation: (tx: TransactionClient, now: Date) => Promise<T> | T,
  ): Promise<OwnedResult<T>> {
    return this.prisma.$transaction(async (tx) => {
      const runs = await lockAndLoadConversationRuns(
        tx,
        claim.projectId,
        claim.conversationId,
      );
      const now = await databaseNow(tx);
      if (!ownsConversation(runs, claim, now)) return { owned: false };

      const renewed = await tx.agentOsRun.updateMany({
        where: {
          id: { in: [...claim.leasedRunIds] },
          realtimePublishLeaseId: claim.leaseId,
        },
        data: { realtimePublishLeaseExpiresAt: leaseExpiry(now) },
      });
      if (renewed.count !== claim.leasedRunIds.length) {
        return { owned: false };
      }
      return { owned: true, value: await operation(tx, now) };
    });
  }

  private async renewConversationLease(
    claim: ConversationClaim,
  ): Promise<boolean> {
    return (await this.withOwnedConversation(claim, () => undefined)).owned;
  }

  private async withLeaseHeartbeat<T>(
    claim: ConversationClaim,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!(await this.renewConversationLease(claim))) {
      throw new ConversationLeaseLostError(claim.conversationId);
    }

    let leaseLost = false;
    let renewalFailure: unknown;
    let renewalChain: Promise<void> = Promise.resolve();
    const queueRenewal = () => {
      renewalChain = renewalChain.then(async () => {
        if (leaseLost) return;
        try {
          leaseLost = !(await this.renewConversationLease(claim));
        } catch (error) {
          renewalFailure = error;
          leaseLost = true;
        }
      });
    };
    const heartbeat = setInterval(queueRenewal, LEASE_RENEW_INTERVAL_MS);
    heartbeat.unref();

    try {
      const result = await operation();
      await renewalChain;
      if (
        leaseLost ||
        !(await this.renewConversationLease(claim).catch((error) => {
          renewalFailure = error;
          return false;
        }))
      ) {
        throw new ConversationLeaseLostError(
          claim.conversationId,
          renewalFailure,
        );
      }
      return result;
    } finally {
      clearInterval(heartbeat);
      await renewalChain;
    }
  }

  private async flushPending(): Promise<void> {
    if (!backgroundTasksEnabled() || this.sweepActive) return;
    this.sweepActive = true;
    try {
      const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT candidate."id"
          FROM (
            SELECT DISTINCT ON (run."project_id", run."conversation_id")
              run."id",
              run."project_id",
              run."conversation_id",
              run."created_at"
            FROM "agent_os_runs" AS run
            WHERE run."realtime_snapshot_sequence" < run."last_sequence"
              AND NOT EXISTS (
                SELECT 1
                FROM "agent_os_runs" AS leased
                WHERE leased."project_id" = run."project_id"
                  AND leased."conversation_id" = run."conversation_id"
                  AND leased."realtime_publish_lease_id" IS NOT NULL
                  AND leased."realtime_publish_lease_expires_at" > clock_timestamp()
              )
            ORDER BY
              run."project_id" ASC,
              run."conversation_id" ASC,
              run."created_at" ASC,
              run."id" ASC
          ) AS candidate
          ORDER BY candidate."created_at" ASC, candidate."id" ASC
          LIMIT 20
        `,
      );
      let nextCandidateIndex = 0;
      const workerCount = Math.min(
        SWEEP_CONVERSATION_CONCURRENCY,
        candidates.length,
      );
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (true) {
            const candidate = candidates[nextCandidateIndex];
            nextCandidateIndex += 1;
            if (!candidate) return;
            try {
              await this.publishRun(candidate.id);
            } catch (error) {
              // A claim/query failure for one conversation must not prevent
              // unrelated conversations in this bounded sweep from draining.
              this.logger.warn(
                `Agent OS realtime outbox candidate failed run=${candidate.id}: ${journalErrorText(error)}`,
              );
            }
          }
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Agent OS realtime outbox sweep failed: ${journalErrorText(error)}`,
      );
    } finally {
      this.sweepActive = false;
    }
  }

  private async recordFailure(
    claim: ConversationClaim,
    attemptedIds: readonly string[],
    error: unknown,
  ): Promise<void> {
    const detail = journalErrorText(error);
    const recorded = await this.withOwnedConversation(claim, async (tx) => {
      if (attemptedIds.length > 0) {
        await tx.agentOsRunEvent.updateMany({
          where: {
            id: { in: [...attemptedIds] },
            realtimePublishedAt: null,
          },
          data: { realtimePublishLastError: detail },
        });
      }
      // Keep the renewed lease as a durable retry backoff. Releasing it here
      // would let the 2s sweeper immediately reclaim the same permanently
      // failing conversation and create a provider/log hot loop. PostgreSQL's
      // lease clock makes the suffix eligible again after LEASE_DURATION_MS.
    });
    this.logger.warn(
      `Agent OS realtime publish failed conversation=${claim.conversationId}${
        recorded.owned ? '' : ' (lease already lost)'
      }: ${detail}`,
    );
  }
}

export function realtimeEventMessage(
  channel: string,
  event: ReturnType<typeof eventRowToEnvelope>,
): IndividuallyIdempotentAblyMessage {
  const message = {
    name: AGENT_OS_ABLY_EVENT_NAME,
    data: event,
    id: event.id,
  } satisfies IndividuallyIdempotentAblyMessage;
  if (isWithinAblyRealtimeMessageBudget(channel, message)) return message;

  const pointer = {
    version: 1,
    kind: 'event_oversized',
    runId: event.runId,
    conversationId: event.conversationId,
    sequence: event.sequence,
    afterSequence: Math.max(0, event.sequence - 1),
    eventId: event.id,
  } satisfies AgentOsAblyResyncPointer;
  return checkedResyncMessage(channel, `resync:event:${event.id}`, pointer);
}

export function realtimeSnapshotMessage(
  channel: string,
  snapshot: AgentOsAblyRunSnapshot,
  sequence: number,
): IndividuallyIdempotentAblyMessage {
  const message = {
    name: AGENT_OS_ABLY_SNAPSHOT_NAME,
    data: snapshot,
    id: `snap:${snapshot.runId}:${snapshot.status}:${sequence}`,
  } satisfies IndividuallyIdempotentAblyMessage;
  if (isWithinAblyRealtimeMessageBudget(channel, message)) return message;

  const pointer = {
    version: 1,
    kind: 'snapshot_oversized',
    runId: snapshot.runId,
    conversationId: snapshot.conversationId,
    sequence,
    afterSequence: Math.max(0, sequence - 1),
  } satisfies AgentOsAblyResyncPointer;
  return checkedResyncMessage(
    channel,
    `resync:snapshot:${snapshot.runId}:${sequence}`,
    pointer,
  );
}

function checkedResyncMessage(
  channel: string,
  id: string,
  pointer: AgentOsAblyResyncPointer,
): IndividuallyIdempotentAblyMessage {
  const message = {
    name: AGENT_OS_ABLY_RESYNC_NAME,
    data: pointer,
    id,
  } satisfies IndividuallyIdempotentAblyMessage;
  if (!isWithinAblyRealtimeMessageBudget(channel, message)) {
    throw new Error(
      `Agent OS Ably resync pointer exceeds byte budget id=${id}`,
    );
  }
  return message;
}

async function lockAndLoadConversationRuns(
  tx: TransactionClient,
  projectId: string,
  conversationId: string,
): Promise<ConversationRunRow[]> {
  await tx.$queryRaw(
    Prisma.sql`
      SELECT "id"
      FROM "agent_os_runs"
      WHERE "project_id" = ${projectId}::uuid
        AND "conversation_id" = ${conversationId}::uuid
      ORDER BY "created_at" ASC, "id" ASC
      FOR UPDATE
    `,
  );
  return tx.agentOsRun.findMany({
    where: { projectId, conversationId },
    select: {
      id: true,
      projectId: true,
      conversationId: true,
      createdAt: true,
      lastSequence: true,
      realtimeSnapshotSequence: true,
      realtimePublishLeaseId: true,
      realtimePublishLeaseExpiresAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function databaseNow(tx: TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  const now = rows[0]?.now;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('PostgreSQL did not return a valid lease clock');
  }
  return now;
}

function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + LEASE_DURATION_MS);
}

function hasActiveLease(
  runs: readonly ConversationRunRow[],
  now: Date,
): boolean {
  return runs.some(
    (run) =>
      run.realtimePublishLeaseId !== null &&
      isAfter(run.realtimePublishLeaseExpiresAt, now),
  );
}

function ownsConversation(
  runs: readonly ConversationRunRow[],
  claim: ConversationClaim,
  now: Date,
): boolean {
  const ownedIds = new Set(claim.leasedRunIds);
  const ownedRows = runs.filter((run) => ownedIds.has(run.id));
  if (ownedRows.length !== ownedIds.size) return false;
  if (
    ownedRows.some(
      (run) =>
        run.realtimePublishLeaseId !== claim.leaseId ||
        !isAfter(run.realtimePublishLeaseExpiresAt, now),
    )
  ) {
    return false;
  }
  return !runs.some(
    (run) =>
      !ownedIds.has(run.id) &&
      run.realtimePublishLeaseId !== null &&
      run.realtimePublishLeaseId !== claim.leaseId &&
      isAfter(run.realtimePublishLeaseExpiresAt, now),
  );
}

function pendingRuns(
  runs: readonly ConversationRunRow[],
): ConversationRunRow[] {
  return runs.filter((run) => run.realtimeSnapshotSequence < run.lastSequence);
}

function isAfter(value: Date | null, boundary: Date): boolean {
  return value !== null && value.getTime() > boundary.getTime();
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function toClaim(claimed: ClaimedConversation): ConversationClaim {
  return {
    projectId: claimed.projectId,
    conversationId: claimed.conversationId,
    leaseId: claimed.leaseId,
    leasedRunIds: claimed.leasedRunIds,
  };
}

async function currentPendingUserInput(
  tx: TransactionClient,
  runId: string,
): Promise<unknown> {
  const boundary = await tx.agentOsRunEvent.findFirst({
    where: {
      runId,
      type: {
        in: [
          'UserInputRequired',
          'UserInputResolved',
          'RunCompleted',
          'RunFailed',
          'RunCancelled',
        ],
      },
    },
    orderBy: { sequence: 'desc' },
  });
  return boundary?.type === 'UserInputRequired' ? boundary.data : null;
}
