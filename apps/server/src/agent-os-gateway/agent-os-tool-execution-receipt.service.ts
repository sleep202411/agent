import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canonicalJson } from '../agent-os-journal/agent-os-journal.mapper';
import { AgentOsRunJournalService } from '../agent-os-journal/agent-os-run-journal.service';
import { PrismaService } from '../infra/db/db.module';
import type { AgentOsDomainResult } from './agent-os-domain.service';
import type {
  AgentOsCapabilityExecuteInput,
  AgentOsToolExecutionReceiptContext,
} from './capabilities/capability-handler';

const RECEIPT_LEASE_MS = 70_000;
const IN_FLIGHT_POLL_MS = 100;
const IN_FLIGHT_HTTP_WAIT_MS = 55_000;

type ReceiptIdentity = Pick<
  AgentOsCapabilityExecuteInput,
  | 'runId'
  | 'conversationId'
  | 'turnId'
  | 'toolCallId'
  | 'toolId'
  | 'projectId'
  | 'actorId'
  | 'idempotencyKey'
  | 'startExecution'
  | 'continuationExecution'
>;

export type AgentOsToolExecutionClaim =
  | {
      kind: 'claimed';
      context: AgentOsToolExecutionReceiptContext;
    }
  | {
      kind: 'in_flight';
      leaseExpiresAt: Date;
      requestFingerprint: string;
    }
  | {
      kind: 'completed';
      response: AgentOsDomainResult;
      requestFingerprint: string;
    };

/**
 * Durable exactly-once boundary for command tools.
 *
 * A completed row is the response-loss authority. The executing lease merely
 * keeps concurrent Gateway/Worker pods from entering the same business write;
 * every product mutation still completes the row in its own transaction.
 */
@Injectable()
export class AgentOsToolExecutionReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AgentOsRunJournalService,
  ) {}

  async executeCommand(
    input: AgentOsCapabilityExecuteInput,
    execute: (
      claimedInput: AgentOsCapabilityExecuteInput,
    ) => Promise<AgentOsDomainResult>,
  ): Promise<AgentOsDomainResult> {
    let claim = await this.claim(input);
    if (claim.kind === 'completed') return claim.response;
    if (claim.kind === 'in_flight') {
      const completed = await this.waitForCompleted(
        input,
        claim.requestFingerprint,
        claim.leaseExpiresAt,
      );
      if (completed) return completed;
      claim = await this.claim(input);
      if (claim.kind === 'completed') return claim.response;
      if (claim.kind === 'in_flight') {
        throw new ConflictException({
          code: 'AGENT_OS_TOOL_EXECUTION_IN_FLIGHT',
          message:
            'This tool invocation is still owned by another executor. Retry with the same toolCallId and idempotencyKey.',
          retryable: true,
          leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
        });
      }
    }

    const claimedInput: AgentOsCapabilityExecuteInput = {
      ...input,
      toolExecutionReceipt: claim.context,
    };
    const response = await execute(claimedInput);
    if (!response.ok && response.retryable) {
      await this.releaseRetryable(claimedInput);
      return response;
    }
    // Transactional command handlers have already committed this receipt with
    // their product mutation. This call is an idempotent assertion and also
    // owns deterministic validation failures and domain-native replay paths.
    claim = await this.completeStandalone(claimedInput, response);
    if (claim.kind !== 'completed') {
      throw new ConflictException({
        code: 'AGENT_OS_TOOL_RECEIPT_NOT_COMPLETED',
        message: 'The command result could not be durably committed.',
      });
    }
    return claim.response;
  }

  async claim(
    input: AgentOsCapabilityExecuteInput,
    leaseDurationMs = RECEIPT_LEASE_MS,
  ): Promise<AgentOsToolExecutionClaim> {
    inputExecutionProofMode(input);
    const requestFingerprint = toolRequestFingerprint(input);
    const leaseId = randomUUID();
    const safeLeaseMs = Math.min(Math.max(leaseDurationMs, 5_000), 120_000);

    return this.prisma.$transaction(async (tx) => {
      await lockReceiptIdentity(tx, input);
      const existing = await findReceipt(tx, input);
      if (existing) {
        assertExactReceipt(existing, input, requestFingerprint);
        if (existing.status === 'completed') {
          return {
            kind: 'completed',
            response: parseStoredResponse(existing.response),
            requestFingerprint,
          };
        }
        assertExecutingProofPresence(existing, input);
        const now = await databaseNow(tx);
        if (
          existing.leaseExpiresAt &&
          existing.leaseExpiresAt.getTime() > now.getTime()
        ) {
          return {
            kind: 'in_flight',
            leaseExpiresAt: existing.leaseExpiresAt,
            requestFingerprint,
          };
        }
        await this.journal.assertToolExecutionFenceInTx(tx, fenceInput(input));
        const leaseExpiresAt = new Date(now.getTime() + safeLeaseMs);
        await tx.agentOsToolExecutionReceipt.update({
          where: { id: existing.id },
          data: {
            leaseId,
            leaseExpiresAt,
            ...executionProofColumns(input),
          },
        });
        return {
          kind: 'claimed',
          context: {
            receiptId: existing.id,
            leaseId,
            requestFingerprint,
          },
        };
      }

      await this.journal.assertToolExecutionFenceInTx(tx, fenceInput(input));
      const now = await databaseNow(tx);
      const leaseExpiresAt = new Date(now.getTime() + safeLeaseMs);
      const id = randomUUID();
      await tx.agentOsToolExecutionReceipt.create({
        data: {
          id,
          runId: input.runId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          toolCallId: input.toolCallId,
          toolId: input.toolId,
          projectId: input.projectId,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
          status: 'executing',
          leaseId,
          leaseExpiresAt,
          ...executionProofColumns(input),
        },
      });
      return {
        kind: 'claimed',
        context: { receiptId: id, leaseId, requestFingerprint },
      };
    });
  }

  /** Complete a successful command inside the product mutation transaction. */
  async completeSuccessInTx(
    tx: Prisma.TransactionClient,
    input: AgentOsCapabilityExecuteInput,
    data: unknown,
  ): Promise<AgentOsDomainResult> {
    const completed = await this.completeInTx(tx, input, { ok: true, data });
    if (completed.kind !== 'completed') {
      throw receiptConflict('The command result was not completed.');
    }
    return completed.response;
  }

  /**
   * Fence a product transaction that has its own durable idempotency receipt
   * (currently Story authoring). Its generic tool receipt is finalized after
   * that domain returns the exact stored result.
   */
  async fenceBusinessMutationInTx(
    tx: Prisma.TransactionClient,
    input: AgentOsCapabilityExecuteInput,
  ): Promise<void> {
    requireReceiptContext(input);
    await this.journal.assertToolExecutionFenceInTx(tx, fenceInput(input));
  }

  async completeStandalone(
    input: AgentOsCapabilityExecuteInput,
    response: AgentOsDomainResult,
  ): Promise<AgentOsToolExecutionClaim> {
    return this.prisma.$transaction((tx) =>
      this.completeInTx(tx, input, response, response.ok),
    );
  }

  private async completeInTx(
    tx: Prisma.TransactionClient,
    input: AgentOsCapabilityExecuteInput,
    response: AgentOsDomainResult,
    requireExecutionFence = true,
  ): Promise<AgentOsToolExecutionClaim> {
    const context = requireReceiptContext(input);
    const existing = await tx.agentOsToolExecutionReceipt.findUnique({
      where: { id: context.receiptId },
    });
    if (!existing) {
      throw receiptConflict('The command receipt no longer exists.');
    }
    assertExactReceipt(existing, input, context.requestFingerprint);
    if (existing.status === 'completed') {
      const stored = parseStoredResponse(existing.response);
      if (canonicalJson(stored) !== canonicalJson(response)) {
        throw receiptConflict(
          'The command already completed with a different durable response.',
        );
      }
      return {
        kind: 'completed',
        response: stored,
        requestFingerprint: context.requestFingerprint,
      };
    }
    if (existing.leaseId !== context.leaseId) {
      throw receiptSuperseded(
        'This executor no longer owns the command receipt lease.',
      );
    }
    assertExecutingProofOwnership(existing, input);
    const now = await databaseNow(tx);
    if (
      !existing.leaseExpiresAt ||
      existing.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw receiptSuperseded(
        'The command receipt lease expired before its result was committed.',
      );
    }
    if (requireExecutionFence) {
      await this.journal.assertToolExecutionFenceInTx(tx, fenceInput(input));
    }
    const updated = await tx.agentOsToolExecutionReceipt.updateMany({
      where: {
        id: context.receiptId,
        status: 'executing',
        leaseId: context.leaseId,
        requestFingerprint: context.requestFingerprint,
      },
      data: {
        status: 'completed',
        response: jsonValue(response),
        completedAt: now,
        leaseId: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) {
      throw receiptSuperseded(
        'The command receipt changed before its result could be committed.',
      );
    }
    return {
      kind: 'completed',
      response,
      requestFingerprint: context.requestFingerprint,
    };
  }

  private async releaseRetryable(
    input: AgentOsCapabilityExecuteInput,
  ): Promise<void> {
    const context = requireReceiptContext(input);
    await this.prisma.$transaction(async (tx) => {
      const now = await databaseNow(tx);
      const released = await tx.agentOsToolExecutionReceipt.updateMany({
        where: {
          id: context.receiptId,
          status: 'executing',
          leaseId: context.leaseId,
          requestFingerprint: context.requestFingerprint,
        },
        data: { leaseExpiresAt: now },
      });
      if (released.count !== 1) {
        const existing = await tx.agentOsToolExecutionReceipt.findUnique({
          where: { id: context.receiptId },
        });
        if (existing?.status !== 'completed') {
          throw receiptSuperseded(
            'The retryable command result arrived after another executor took ownership.',
          );
        }
      }
    });
  }

  private async waitForCompleted(
    input: AgentOsCapabilityExecuteInput,
    requestFingerprint: string,
    leaseExpiresAt: Date,
  ): Promise<AgentOsDomainResult | null> {
    const deadline = Math.min(
      leaseExpiresAt.getTime() + IN_FLIGHT_POLL_MS,
      Date.now() + IN_FLIGHT_HTTP_WAIT_MS,
    );
    while (Date.now() < deadline) {
      await delay(IN_FLIGHT_POLL_MS);
      const row = await this.prisma.agentOsToolExecutionReceipt.findFirst({
        where: {
          runId: input.runId,
          OR: [
            { toolCallId: input.toolCallId },
            { idempotencyKey: input.idempotencyKey },
          ],
        },
      });
      if (!row) return null;
      assertExactReceipt(row, input, requestFingerprint);
      if (row.status === 'completed') return parseStoredResponse(row.response);
    }
    return null;
  }
}

export function toolRequestFingerprint(
  input: AgentOsCapabilityExecuteInput,
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        runId: input.runId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        toolCallId: input.toolCallId,
        toolId: input.toolId,
        actorId: input.actorId,
        projectId: input.projectId,
        skillResolutionId: input.skillResolutionId,
        skillVersionIds: [...input.skillVersionIds],
        workbenchContext: input.workbenchContext ?? null,
        idempotencyKey: input.idempotencyKey,
        arguments: input.arguments,
      }),
    )
    .digest('hex');
}

function fenceInput(input: ReceiptIdentity) {
  return {
    runId: input.runId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    actorId: input.actorId,
    startExecution: input.startExecution,
    continuationExecution: input.continuationExecution,
  };
}

function executionProofColumns(input: ReceiptIdentity) {
  inputExecutionProofMode(input);
  return {
    startExecutionToken: input.startExecution?.executionToken ?? null,
    startExecutionAttemptId: input.startExecution?.executionAttemptId ?? null,
    startExecutionEpoch: input.startExecution?.executionEpoch ?? null,
    startExecutionOwnerId: input.startExecution?.executionOwnerId ?? null,
    continuationExecutionToken:
      input.continuationExecution?.executionToken ?? null,
    continuationExecutionAttemptId:
      input.continuationExecution?.executionAttemptId ?? null,
    continuationExecutionEpoch:
      input.continuationExecution?.executionEpoch ?? null,
    continuationExecutionOwnerId:
      input.continuationExecution?.executionOwnerId ?? null,
  };
}

async function lockReceiptIdentity(
  tx: Prisma.TransactionClient,
  input: Pick<
    AgentOsCapabilityExecuteInput,
    'runId' | 'toolCallId' | 'idempotencyKey'
  >,
): Promise<void> {
  const keys = [
    `agent-os-tool-call:${input.runId}:${input.toolCallId}`,
    `agent-os-tool-key:${input.runId}:${input.idempotencyKey}`,
  ].sort();
  for (const key of keys) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
    `;
  }
}

async function findReceipt(
  tx: Prisma.TransactionClient,
  input: Pick<
    AgentOsCapabilityExecuteInput,
    'runId' | 'toolCallId' | 'idempotencyKey'
  >,
) {
  return tx.agentOsToolExecutionReceipt.findFirst({
    where: {
      runId: input.runId,
      OR: [
        { toolCallId: input.toolCallId },
        { idempotencyKey: input.idempotencyKey },
      ],
    },
  });
}

function assertExactReceipt(
  receipt: {
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolId: string;
    projectId: string;
    actorId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
  input: ReceiptIdentity,
  requestFingerprint: string,
): void {
  if (
    receipt.conversationId !== input.conversationId ||
    receipt.turnId !== input.turnId ||
    receipt.toolCallId !== input.toolCallId ||
    receipt.toolId !== input.toolId ||
    receipt.projectId !== input.projectId ||
    receipt.actorId !== input.actorId ||
    receipt.idempotencyKey !== input.idempotencyKey ||
    receipt.requestFingerprint !== requestFingerprint
  ) {
    throw receiptConflict(
      'The toolCallId or idempotencyKey was already used for a different command payload.',
    );
  }
}

function assertExecutingProofPresence(
  receipt: {
    startExecutionToken: string | null;
    startExecutionAttemptId: string | null;
    startExecutionEpoch: number | null;
    startExecutionOwnerId: string | null;
    continuationExecutionToken: string | null;
    continuationExecutionAttemptId: string | null;
    continuationExecutionEpoch: number | null;
    continuationExecutionOwnerId: string | null;
  },
  input: AgentOsCapabilityExecuteInput,
): void {
  const storedMode = storedExecutionProofMode(receipt);
  const inputMode = inputExecutionProofMode(input);
  if (storedMode !== inputMode) {
    throw receiptConflict(
      'An executing command receipt can only be reclaimed with the same execution proof kind.',
    );
  }
}

function assertExecutingProofOwnership(
  receipt: {
    startExecutionToken: string | null;
    startExecutionAttemptId: string | null;
    startExecutionEpoch: number | null;
    startExecutionOwnerId: string | null;
    continuationExecutionToken: string | null;
    continuationExecutionAttemptId: string | null;
    continuationExecutionEpoch: number | null;
    continuationExecutionOwnerId: string | null;
  },
  input: AgentOsCapabilityExecuteInput,
): void {
  assertExecutingProofPresence(receipt, input);
  const proof = input.startExecution;
  if (
    proof &&
    (receipt.startExecutionToken !== proof.executionToken ||
      receipt.startExecutionAttemptId !== proof.executionAttemptId ||
      receipt.startExecutionEpoch !== proof.executionEpoch ||
      receipt.startExecutionOwnerId !== proof.executionOwnerId)
  ) {
    throw receiptSuperseded(
      'The command result came from a different initial execution owner.',
    );
  }
  const continuation = input.continuationExecution;
  if (
    continuation &&
    (receipt.continuationExecutionToken !== continuation.executionToken ||
      receipt.continuationExecutionAttemptId !==
        continuation.executionAttemptId ||
      receipt.continuationExecutionEpoch !== continuation.executionEpoch ||
      receipt.continuationExecutionOwnerId !== continuation.executionOwnerId)
  ) {
    throw receiptSuperseded(
      'The command result came from a different continuation execution owner.',
    );
  }
}

type ExecutionProofMode = 'none' | 'start' | 'continuation';

function inputExecutionProofMode(
  input: Pick<
    AgentOsCapabilityExecuteInput,
    'startExecution' | 'continuationExecution'
  >,
): ExecutionProofMode {
  if (input.startExecution && input.continuationExecution) {
    throw receiptConflict(
      'A command cannot carry initial and continuation execution proofs together.',
    );
  }
  if (input.startExecution) return 'start';
  if (input.continuationExecution) return 'continuation';
  return 'none';
}

function storedExecutionProofMode(receipt: {
  startExecutionToken: string | null;
  startExecutionAttemptId: string | null;
  startExecutionEpoch: number | null;
  startExecutionOwnerId: string | null;
  continuationExecutionToken: string | null;
  continuationExecutionAttemptId: string | null;
  continuationExecutionEpoch: number | null;
  continuationExecutionOwnerId: string | null;
}): ExecutionProofMode {
  const start = storedProofPresence([
    receipt.startExecutionToken,
    receipt.startExecutionAttemptId,
    receipt.startExecutionEpoch,
    receipt.startExecutionOwnerId,
  ]);
  const continuation = storedProofPresence([
    receipt.continuationExecutionToken,
    receipt.continuationExecutionAttemptId,
    receipt.continuationExecutionEpoch,
    receipt.continuationExecutionOwnerId,
  ]);
  if (start === 'partial' || continuation === 'partial') {
    throw receiptConflict('The executing command receipt proof is corrupted.');
  }
  if (
    (start === 'complete' &&
      (!Number.isInteger(receipt.startExecutionEpoch) ||
        receipt.startExecutionEpoch! <= 0)) ||
    (continuation === 'complete' &&
      (!Number.isInteger(receipt.continuationExecutionEpoch) ||
        receipt.continuationExecutionEpoch! <= 0))
  ) {
    throw receiptConflict(
      'The executing command receipt proof epoch is corrupted.',
    );
  }
  if (start === 'complete' && continuation === 'complete') {
    throw receiptConflict(
      'The executing command receipt carries two execution authorities.',
    );
  }
  if (start === 'complete') return 'start';
  if (continuation === 'complete') return 'continuation';
  return 'none';
}

function storedProofPresence(
  values: readonly (string | number | null)[],
): 'none' | 'partial' | 'complete' {
  const present = values.filter((value) => value !== null).length;
  if (present === 0) return 'none';
  return present === values.length ? 'complete' : 'partial';
}

function requireReceiptContext(
  input: AgentOsCapabilityExecuteInput,
): AgentOsToolExecutionReceiptContext {
  if (!input.toolExecutionReceipt) {
    throw receiptConflict(
      'A command handler attempted to write without a durable execution receipt.',
    );
  }
  return input.toolExecutionReceipt;
}

function parseStoredResponse(
  value: Prisma.JsonValue | null,
): AgentOsDomainResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw receiptConflict('The completed command receipt is corrupted.');
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true && Object.hasOwn(record, 'data')) {
    return { ok: true, data: record.data };
  }
  if (
    record.ok === false &&
    typeof record.code === 'string' &&
    typeof record.message === 'string' &&
    typeof record.retryable === 'boolean'
  ) {
    return {
      ok: false,
      code: record.code,
      message: record.message,
      retryable: record.retryable,
      ...(record.details &&
      typeof record.details === 'object' &&
      !Array.isArray(record.details)
        ? { details: record.details as Record<string, unknown> }
        : {}),
    };
  }
  throw receiptConflict('The completed command receipt response is invalid.');
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT NOW() AS "now"
  `;
  if (!row) throw new Error('PostgreSQL did not return its current time.');
  return row.now;
}

function receiptConflict(message: string): ConflictException {
  return new ConflictException({
    code: 'AGENT_OS_TOOL_RECEIPT_CONFLICT',
    message,
  });
}

function receiptSuperseded(message: string): ConflictException {
  return new ConflictException({
    code: 'AGENT_OS_TOOL_EXECUTION_SUPERSEDED',
    message,
    retryable: false,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
