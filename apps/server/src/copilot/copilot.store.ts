/**
 * Durable, server-authoritative Copilot conversations.
 *
 * PostgreSQL is the only canonical transcript/state store. Every turn
 * transition locks the conversation row and commits its message append and
 * metadata update in one transaction. PostgreSQL also owns the short-lived,
 * fenced per-user admission lease used to reject concurrent paid streams.
 */
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import {
  CopilotConversationMode as StoredConversationMode,
  CopilotConversationStatus as StoredConversationStatus,
  CopilotMessageRole,
  CopilotQuotaChargeStatus as StoredChargeStatus,
  CopilotTurnKind as StoredTurnKind,
  Prisma,
  type CopilotUserStreamState as StoredUserStreamState,
} from '@prisma/client';
import {
  STORY_DIRECTING_SKILL_KEYS,
  type StoryDirectingSkillKey,
} from '@repo/shared';
import {
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from 'ai';
import { PrismaService } from '../infra/db/db.module';
import { CopilotConfigService } from './copilot.config';

export const COPILOT_MAX_CANONICAL_MESSAGES = 64;
export const COPILOT_MAX_CANONICAL_BYTES = 4 * 1024 * 1024;
export const COPILOT_MAX_USER_MESSAGE_BYTES = 512 * 1024;
export const COPILOT_MAX_ASSISTANT_MESSAGE_BYTES = 2 * 1024 * 1024;
export const COPILOT_RESPONSE_BYTES_RESERVE =
  COPILOT_MAX_ASSISTANT_MESSAGE_BYTES;
export const COPILOT_TURN_LEASE_MS = 180_000;
export const COPILOT_USER_STREAM_LEASE_MS = 180_000;
export const COPILOT_PROVIDER_LEASE_MS = 180_000;

const MAX_LIST_LIMIT = 100;

export type CopilotConversationStatus =
  | 'ready'
  | 'streaming'
  | 'failed'
  | 'aborted'
  | 'limit_exceeded';

export interface CopilotActiveTurn {
  kind: 'user' | 'tool-continuation';
  turnId: string;
  billingOperationId: string;
  chargeAttemptId: string;
  claimToken: string;
  claimRevision: number;
  userMessageId: string;
  admissionToken: string;
  admissionFencingRevision: number;
  startedAt: number;
  expiresAt: number;
}

export interface CopilotConversation {
  schemaVersion: 1;
  sessionId: string;
  conversationId: string;
  userId: string;
  projectId: string;
  mode: 'canvas' | 'story-canvas';
  selectedSkillKeys: StoryDirectingSkillKey[];
  messages: UIMessage[];
  revision: number;
  status: CopilotConversationStatus;
  activeTurn: CopilotActiveTurn | null;
  updatedAt: number;
}

export interface CopilotTurnClaim {
  conversation: CopilotConversation;
  turn: CopilotActiveTurn;
}

export interface CopilotUserStreamLease {
  token: string;
  expiresAt: number;
  fencingRevision: number;
}

export type CopilotStoreConflictCode =
  | 'COPILOT_STREAM_IN_PROGRESS'
  | 'COPILOT_RETRY_REQUIRED'
  | 'COPILOT_RETRY_NOT_ALLOWED'
  | 'COPILOT_MESSAGE_ALREADY_EXISTS'
  | 'COPILOT_MESSAGE_TOO_LARGE'
  | 'COPILOT_HISTORY_LIMIT_REACHED'
  | 'COPILOT_TOOL_CONTINUATION_INVALID'
  | 'COPILOT_TOOL_CONTINUATION_REQUIRED'
  | 'COPILOT_QUOTA_SETTLEMENT_PENDING'
  | 'COPILOT_TURN_STALE';

export class CopilotStoreConflictError extends Error {
  constructor(readonly code: CopilotStoreConflictCode) {
    super(code);
    this.name = 'CopilotStoreConflictError';
  }
}

export class CopilotStoreUnavailableError extends Error {
  readonly code = 'COPILOT_STATE_UNAVAILABLE';

  constructor(message = 'Copilot state is temporarily unavailable.') {
    super(message);
    this.name = 'CopilotStoreUnavailableError';
  }
}

interface ClaimTurnInput {
  conversationId: string;
  userId: string;
  projectId: string;
  mode: 'canvas' | 'story-canvas';
  selectedSkillKeys: StoryDirectingSkillKey[];
  trigger: 'submit-message' | 'regenerate-message';
  userMessage: UIMessage;
  admissionLease: CopilotUserStreamLease;
}

interface ClaimToolContinuationInput {
  conversationId: string;
  userId: string;
  projectId: string;
  mode: 'canvas';
  assistantMessage: UIMessage;
  admissionLease: CopilotUserStreamLease;
}

type StoredConversation = Prisma.CopilotConversationGetPayload<{
  include: { messages: true };
}>;

type ClaimTransactionResult =
  | {
      kind: 'claimed';
      conversation: StoredConversation;
      turn: CopilotActiveTurn;
    }
  | { kind: 'conflict'; code: CopilotStoreConflictCode };

type CompleteTransactionResult =
  | { kind: 'completed' }
  | { kind: 'stale' }
  | { kind: 'conflict'; code: CopilotStoreConflictCode };

@Injectable()
export class CopilotStore {
  private readonly logger = new Logger(CopilotStore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: CopilotConfigService,
  ) {}

  async acquireUserStreamLease(
    userId: string,
    conversationId: string,
  ): Promise<CopilotUserStreamLease> {
    assertLeaseIdentity(userId, conversationId);
    const token = randomUUID();
    const result = await this.databaseOperation(() =>
      this.prisma.$transaction(async (tx) => {
        const state = await this.lockUserStreamState(tx, userId);
        const now = await databaseNow(tx);
        if (
          state?.claimToken &&
          state.leaseExpiresAt &&
          state.leaseExpiresAt.getTime() > now.getTime()
        ) {
          return null;
        }
        const leaseExpiresAt = new Date(
          now.getTime() + COPILOT_USER_STREAM_LEASE_MS,
        );
        const next = state
          ? await tx.copilotUserStreamState.update({
              where: { userId },
              data: {
                claimToken: token,
                conversationId,
                leaseExpiresAt,
                fencingRevision: { increment: 1 },
                updatedAt: now,
              },
            })
          : await tx.copilotUserStreamState.create({
              data: {
                userId,
                claimToken: token,
                conversationId,
                leaseExpiresAt,
                fencingRevision: 1,
                updatedAt: now,
              },
            });
        return {
          token,
          expiresAt: leaseExpiresAt.getTime(),
          fencingRevision: next.fencingRevision,
        };
      }),
    );
    if (!result) {
      throw new CopilotStoreConflictError('COPILOT_STREAM_IN_PROGRESS');
    }
    return result;
  }

  async releaseUserStreamLease(
    userId: string,
    token: string,
    fencingRevision?: number,
  ): Promise<boolean> {
    return this.databaseOperation(() =>
      this.prisma.$transaction(async (tx) => {
        const state = await this.lockUserStreamState(tx, userId);
        if (
          !state ||
          state.claimToken !== token ||
          (fencingRevision !== undefined &&
            state.fencingRevision !== fencingRevision)
        ) {
          return false;
        }
        await tx.copilotUserStreamState.update({
          where: { userId },
          data: {
            claimToken: null,
            conversationId: null,
            leaseExpiresAt: null,
            updatedAt: await databaseNow(tx),
          },
        });
        return true;
      }),
    );
  }

  async claimTurn(input: ClaimTurnInput): Promise<CopilotTurnClaim> {
    assertStoreIdentity(input);
    const serializedUser = serializeMessage(
      input.userMessage,
      'user',
      COPILOT_MAX_USER_MESSAGE_BYTES,
    );
    assertSelectedSkillKeys(input.selectedSkillKeys, input.mode);
    const turnId = randomUUID();
    const chargeAttemptId = randomUUID();
    const claimToken = randomUUID();

    const result = await this.databaseOperation(() =>
      this.prisma.$transaction(async (tx) => {
        // Global lock order is always user admission row, then conversation.
        // This verifies that a reclaimed/expired lease cannot fence a late
        // request into a paid provider after another tab has taken ownership.
        const streamState = await this.lockUserStreamState(tx, input.userId);
        const now = await databaseNow(tx);
        if (
          !streamState ||
          streamState.claimToken !== input.admissionLease.token ||
          streamState.conversationId !== input.conversationId ||
          streamState.fencingRevision !==
            input.admissionLease.fencingRevision ||
          !streamState.leaseExpiresAt ||
          streamState.leaseExpiresAt.getTime() <= now.getTime()
        ) {
          return {
            kind: 'conflict',
            code: 'COPILOT_TURN_STALE',
          } satisfies ClaimTransactionResult;
        }
        const turn: CopilotActiveTurn = {
          kind: 'user',
          turnId,
          billingOperationId: turnId,
          chargeAttemptId,
          claimToken,
          claimRevision: -1,
          userMessageId: serializedUser.message.id,
          admissionToken: input.admissionLease.token,
          admissionFencingRevision: input.admissionLease.fencingRevision,
          startedAt: now.getTime(),
          expiresAt: now.getTime() + COPILOT_TURN_LEASE_MS,
        };
        let stored = await this.lockConversation(
          tx,
          input.userId,
          input.conversationId,
        );
        let createdConversation = false;
        if (!stored) {
          if (input.trigger !== 'submit-message') {
            return {
              kind: 'conflict',
              code: 'COPILOT_RETRY_NOT_ALLOWED',
            } satisfies ClaimTransactionResult;
          }
          const sessionId = randomUUID();
          await tx.copilotQuotaChargeAttempt.create({
            data: {
              id: turn.chargeAttemptId,
              billingOperationId: turn.billingOperationId,
              generation: 1,
              userId: input.userId,
              conversationId: input.conversationId,
              sessionId,
              ownerTurnId: turn.turnId,
              ...quotaBucketsForDate(now),
            },
          });
          stored = await tx.copilotConversation.create({
            data: {
              userId: input.userId,
              conversationId: input.conversationId,
              projectId: input.projectId,
              mode: toStoredMode(input.mode),
              selectedSkillKeys: input.selectedSkillKeys,
              sessionId,
              billingOperationId: turn.billingOperationId,
              billingChargeAttemptId: turn.chargeAttemptId,
            },
            include: { messages: { orderBy: { ordinal: 'asc' } } },
          });
          createdConversation = true;
        } else {
          assertConversationScope(stored, input);
          // Validate the locked durable record before deriving a paid prompt or
          // mutating it further. Corruption rolls the whole transaction back.
          mapStoredConversation(stored);
        }

        if (stored.status === StoredConversationStatus.streaming) {
          if (!stored.activeExpiresAt) {
            throw new Error('Streaming Copilot state has no expiry.');
          }
          if (stored.activeExpiresAt.getTime() > now.getTime()) {
            return {
              kind: 'conflict',
              code: 'COPILOT_STREAM_IN_PROGRESS',
            } satisfies ClaimTransactionResult;
          }
          await markCurrentChargeAttemptRefundPending(
            tx,
            stored,
            stored.activeTurnId,
            'failed',
            now,
          );
          stored = await tx.copilotConversation.update({
            where: { id: stored.id },
            data: {
              revision: { increment: 1 },
              status: StoredConversationStatus.failed,
              ...clearActiveTurn(),
              updatedAt: now,
            },
            include: { messages: { orderBy: { ordinal: 'asc' } } },
          });
          return {
            kind: 'conflict',
            code: 'COPILOT_QUOTA_SETTLEMENT_PENDING',
          } satisfies ClaimTransactionResult;
        }

        if (stored.status === StoredConversationStatus.limit_exceeded) {
          return {
            kind: 'conflict',
            code: 'COPILOT_HISTORY_LIMIT_REACHED',
          } satisfies ClaimTransactionResult;
        }

        const priorChargeAttempt = await loadCurrentChargeAttempt(tx, stored);
        let nextMessageCount = stored.messageCount;
        let nextMessageBytes = stored.messageBytes;
        if (input.trigger === 'submit-message') {
          if (
            stored.status === StoredConversationStatus.failed ||
            stored.status === StoredConversationStatus.aborted
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_RETRY_REQUIRED',
            } satisfies ClaimTransactionResult;
          }
          if (stored.status !== StoredConversationStatus.ready) {
            throw new Error('Invalid Copilot state for a fresh user turn.');
          }
          if (
            stored.messages.length > 0 &&
            stored.messages[stored.messages.length - 1]?.role !==
              CopilotMessageRole.assistant
          ) {
            throw new Error('Ready Copilot state has an invalid message tail.');
          }
          const priorAssistant = stored.messages[stored.messages.length - 1]
            ?.payload as unknown as UIMessage | undefined;
          if (
            priorAssistant &&
            assistantHasPendingClientToolCalls(priorAssistant)
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_TOOL_CONTINUATION_REQUIRED',
            } satisfies ClaimTransactionResult;
          }
          if (
            stored.messages.some(
              (message) => message.messageId === serializedUser.message.id,
            )
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_MESSAGE_ALREADY_EXISTS',
            } satisfies ClaimTransactionResult;
          }
          if (
            stored.messageCount + 2 > COPILOT_MAX_CANONICAL_MESSAGES ||
            stored.messageBytes +
              serializedUser.byteSize +
              COPILOT_RESPONSE_BYTES_RESERVE >
              COPILOT_MAX_CANONICAL_BYTES
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_HISTORY_LIMIT_REACHED',
            } satisfies ClaimTransactionResult;
          }
          await tx.copilotMessage.create({
            data: {
              conversationId: stored.id,
              ordinal: stored.messageCount,
              messageId: serializedUser.message.id,
              role: CopilotMessageRole.user,
              payload:
                serializedUser.message as unknown as Prisma.InputJsonValue,
              byteSize: serializedUser.byteSize,
            },
          });
          nextMessageCount += 1;
          nextMessageBytes += serializedUser.byteSize;
        } else {
          const last = stored.messages[stored.messages.length - 1];
          if (
            (stored.status !== StoredConversationStatus.failed &&
              stored.status !== StoredConversationStatus.aborted) ||
            last?.role !== CopilotMessageRole.user ||
            last.messageId !== serializedUser.message.id
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_RETRY_NOT_ALLOWED',
            } satisfies ClaimTransactionResult;
          }
          if (priorChargeAttempt.status !== StoredChargeStatus.refunded) {
            return {
              kind: 'conflict',
              code: 'COPILOT_QUOTA_SETTLEMENT_PENDING',
            } satisfies ClaimTransactionResult;
          }
          if (
            stored.messageCount + 1 > COPILOT_MAX_CANONICAL_MESSAGES ||
            stored.messageBytes + COPILOT_RESPONSE_BYTES_RESERVE >
              COPILOT_MAX_CANONICAL_BYTES
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_HISTORY_LIMIT_REACHED',
            } satisfies ClaimTransactionResult;
          }
        }

        if (!createdConversation) {
          if (
            input.trigger === 'submit-message' &&
            priorChargeAttempt.status !== StoredChargeStatus.settled
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_QUOTA_SETTLEMENT_PENDING',
            } satisfies ClaimTransactionResult;
          }
          await tx.copilotQuotaChargeAttempt.create({
            data: {
              id: turn.chargeAttemptId,
              billingOperationId: turn.billingOperationId,
              generation: 1,
              userId: input.userId,
              conversationId: input.conversationId,
              sessionId: stored.sessionId,
              ownerTurnId: turn.turnId,
              ...quotaBucketsForDate(now),
            },
          });
        }

        const claimRevision = stored.revision + 1;
        turn.claimRevision = claimRevision;
        const claimed = await tx.copilotConversation.update({
          where: { id: stored.id },
          data: {
            revision: claimRevision,
            billingOperationId: turn.billingOperationId,
            billingChargeAttemptId: turn.chargeAttemptId,
            status: StoredConversationStatus.streaming,
            messageCount: nextMessageCount,
            messageBytes: nextMessageBytes,
            activeTurnId: turn.turnId,
            activeTurnKind: StoredTurnKind.user,
            activeClaimToken: turn.claimToken,
            activeRevision: claimRevision,
            activeUserMessageId: turn.userMessageId,
            activeAdmissionToken: turn.admissionToken,
            activeAdmissionRevision: turn.admissionFencingRevision,
            activeStartedAt: new Date(turn.startedAt),
            activeExpiresAt: new Date(turn.expiresAt),
            ...(input.trigger === 'submit-message'
              ? {
                  selectedSkillKeys: input.selectedSkillKeys,
                  turnProposalUserMessageId: null,
                  turnProposal: Prisma.DbNull,
                }
              : {}),
            updatedAt: now,
          },
          include: { messages: { orderBy: { ordinal: 'asc' } } },
        });
        return {
          kind: 'claimed',
          conversation: claimed,
          turn: { ...turn },
        } satisfies ClaimTransactionResult;
      }),
    );

    if (result.kind === 'conflict') {
      throw new CopilotStoreConflictError(result.code);
    }
    const conversation = mapStoredConversation(result.conversation);
    if (
      conversation.status !== 'streaming' ||
      conversation.activeTurn?.turnId !== result.turn.turnId ||
      conversation.activeTurn.claimToken !== result.turn.claimToken ||
      conversation.revision !== result.turn.claimRevision
    ) {
      throw new Error('Copilot claim was not reflected in canonical state.');
    }
    return { conversation, turn: result.turn };
  }

  /**
   * Persist browser-executed Canvas tool results before asking the model to
   * continue. The candidate may only resolve existing canonical tool calls;
   * every other assistant byte remains server-authored and immutable.
   */
  async claimToolContinuation(
    input: ClaimToolContinuationInput,
  ): Promise<CopilotTurnClaim> {
    assertStoreIdentity(input);
    const serializedAssistant = serializeMessage(
      input.assistantMessage,
      'assistant',
      COPILOT_MAX_ASSISTANT_MESSAGE_BYTES,
    );
    const turnId = randomUUID();
    const retryChargeAttemptId = randomUUID();
    const claimToken = randomUUID();

    const result = await this.databaseOperation(() =>
      this.prisma.$transaction(async (tx) => {
        const streamState = await this.lockUserStreamState(tx, input.userId);
        const now = await databaseNow(tx);
        if (
          !streamState ||
          streamState.claimToken !== input.admissionLease.token ||
          streamState.conversationId !== input.conversationId ||
          streamState.fencingRevision !==
            input.admissionLease.fencingRevision ||
          !streamState.leaseExpiresAt ||
          streamState.leaseExpiresAt.getTime() <= now.getTime()
        ) {
          return {
            kind: 'conflict',
            code: 'COPILOT_TURN_STALE',
          } satisfies ClaimTransactionResult;
        }

        let stored = await this.lockConversation(
          tx,
          input.userId,
          input.conversationId,
        );
        if (!stored) {
          return {
            kind: 'conflict',
            code: 'COPILOT_TOOL_CONTINUATION_INVALID',
          } satisfies ClaimTransactionResult;
        }
        assertConversationScope(stored, {
          projectId: input.projectId,
          mode: input.mode,
        });
        mapStoredConversation(stored);

        if (stored.status === StoredConversationStatus.streaming) {
          if (!stored.activeExpiresAt) {
            throw new Error('Streaming Copilot state has no expiry.');
          }
          if (stored.activeExpiresAt.getTime() > now.getTime()) {
            return {
              kind: 'conflict',
              code: 'COPILOT_STREAM_IN_PROGRESS',
            } satisfies ClaimTransactionResult;
          }
          await markCurrentChargeAttemptRefundPending(
            tx,
            stored,
            stored.activeTurnId,
            'failed',
            now,
          );
          stored = await tx.copilotConversation.update({
            where: { id: stored.id },
            data: {
              revision: { increment: 1 },
              status: StoredConversationStatus.failed,
              ...clearActiveTurn(),
              updatedAt: now,
            },
            include: { messages: { orderBy: { ordinal: 'asc' } } },
          });
          return {
            kind: 'conflict',
            code: 'COPILOT_QUOTA_SETTLEMENT_PENDING',
          } satisfies ClaimTransactionResult;
        }

        if (stored.status === StoredConversationStatus.limit_exceeded) {
          return {
            kind: 'conflict',
            code: 'COPILOT_HISTORY_LIMIT_REACHED',
          } satisfies ClaimTransactionResult;
        }

        const assistantRow = stored.messages[stored.messages.length - 1];
        const originRow = stored.messages[stored.messages.length - 2];
        if (
          assistantRow?.role !== CopilotMessageRole.assistant ||
          originRow?.role !== CopilotMessageRole.user ||
          assistantRow.messageId !== serializedAssistant.message.id
        ) {
          return {
            kind: 'conflict',
            code: 'COPILOT_TOOL_CONTINUATION_INVALID',
          } satisfies ClaimTransactionResult;
        }

        const currentChargeAttempt = await loadCurrentChargeAttempt(tx, stored);
        let chargeAttemptId = currentChargeAttempt.id;

        let nextMessageBytes = stored.messageBytes;
        if (stored.status === StoredConversationStatus.ready) {
          if (currentChargeAttempt.status !== StoredChargeStatus.charged) {
            return {
              kind: 'conflict',
              code: 'COPILOT_QUOTA_SETTLEMENT_PENDING',
            } satisfies ClaimTransactionResult;
          }
          if (!currentChargeAttempt.clientToolExpiresAt) {
            throw new Error(
              'Pending Copilot client tools have no business expiry.',
            );
          }
          if (
            currentChargeAttempt.clientToolExpiresAt.getTime() <= now.getTime()
          ) {
            await tx.copilotQuotaChargeAttempt.update({
              where: { id: currentChargeAttempt.id },
              data: {
                status: StoredChargeStatus.refund_pending,
                refundReason: 'failed',
                clientToolExpiresAt: null,
                updatedAt: now,
              },
            });
            await tx.copilotConversation.update({
              where: { id: stored.id },
              data: {
                revision: { increment: 1 },
                status: StoredConversationStatus.failed,
                updatedAt: now,
              },
            });
            await releaseUserStreamState(tx, input.userId, now);
            return {
              kind: 'conflict',
              code: 'COPILOT_QUOTA_SETTLEMENT_PENDING',
            } satisfies ClaimTransactionResult;
          }
          assertClientToolContinuation(
            assistantRow.payload as unknown as UIMessage,
            serializedAssistant.message,
          );
          nextMessageBytes =
            stored.messageBytes -
            assistantRow.byteSize +
            serializedAssistant.byteSize;
          if (
            nextMessageBytes -
              serializedAssistant.byteSize +
              COPILOT_RESPONSE_BYTES_RESERVE >
            COPILOT_MAX_CANONICAL_BYTES
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_HISTORY_LIMIT_REACHED',
            } satisfies ClaimTransactionResult;
          }
          await tx.copilotMessage.update({
            where: { id: assistantRow.id },
            data: {
              payload:
                serializedAssistant.message as unknown as Prisma.InputJsonValue,
              byteSize: serializedAssistant.byteSize,
            },
          });
        } else if (
          stored.status === StoredConversationStatus.failed ||
          stored.status === StoredConversationStatus.aborted
        ) {
          if (currentChargeAttempt.status !== StoredChargeStatus.refunded) {
            return {
              kind: 'conflict',
              code: 'COPILOT_QUOTA_SETTLEMENT_PENDING',
            } satisfies ClaimTransactionResult;
          }
          chargeAttemptId = retryChargeAttemptId;
          const canonicalAssistant =
            assistantRow.payload as unknown as UIMessage;
          if (assistantHasPendingClientToolCalls(canonicalAssistant)) {
            assertClientToolContinuation(
              canonicalAssistant,
              serializedAssistant.message,
            );
            nextMessageBytes =
              stored.messageBytes -
              assistantRow.byteSize +
              serializedAssistant.byteSize;
            if (
              nextMessageBytes -
                serializedAssistant.byteSize +
                COPILOT_RESPONSE_BYTES_RESERVE >
              COPILOT_MAX_CANONICAL_BYTES
            ) {
              return {
                kind: 'conflict',
                code: 'COPILOT_HISTORY_LIMIT_REACHED',
              } satisfies ClaimTransactionResult;
            }
            await tx.copilotMessage.update({
              where: { id: assistantRow.id },
              data: {
                payload:
                  serializedAssistant.message as unknown as Prisma.InputJsonValue,
                byteSize: serializedAssistant.byteSize,
              },
            });
          } else if (
            !isDeepStrictEqual(canonicalAssistant, serializedAssistant.message)
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_TOOL_CONTINUATION_INVALID',
            } satisfies ClaimTransactionResult;
          }
        } else {
          return {
            kind: 'conflict',
            code: 'COPILOT_TOOL_CONTINUATION_INVALID',
          } satisfies ClaimTransactionResult;
        }

        const claimRevision = stored.revision + 1;
        const turn: CopilotActiveTurn = {
          kind: 'tool-continuation',
          turnId,
          billingOperationId: stored.billingOperationId,
          chargeAttemptId,
          claimToken,
          claimRevision,
          userMessageId: originRow.messageId,
          admissionToken: input.admissionLease.token,
          admissionFencingRevision: input.admissionLease.fencingRevision,
          startedAt: now.getTime(),
          expiresAt: now.getTime() + COPILOT_TURN_LEASE_MS,
        };
        if (chargeAttemptId === currentChargeAttempt.id) {
          await tx.copilotQuotaChargeAttempt.update({
            where: { id: chargeAttemptId },
            data: {
              ownerTurnId: turn.turnId,
              clientToolExpiresAt: null,
              updatedAt: now,
            },
          });
        } else {
          await tx.copilotQuotaChargeAttempt.create({
            data: {
              id: chargeAttemptId,
              billingOperationId: turn.billingOperationId,
              generation: currentChargeAttempt.generation + 1,
              userId: input.userId,
              conversationId: input.conversationId,
              sessionId: stored.sessionId,
              ownerTurnId: turn.turnId,
              ...quotaBucketsForDate(now),
            },
          });
        }
        const claimed = await tx.copilotConversation.update({
          where: { id: stored.id },
          data: {
            revision: claimRevision,
            billingChargeAttemptId: chargeAttemptId,
            status: StoredConversationStatus.streaming,
            messageBytes: nextMessageBytes,
            activeTurnId: turn.turnId,
            activeTurnKind: StoredTurnKind.tool_continuation,
            activeClaimToken: turn.claimToken,
            activeRevision: claimRevision,
            activeUserMessageId: turn.userMessageId,
            activeAdmissionToken: turn.admissionToken,
            activeAdmissionRevision: turn.admissionFencingRevision,
            activeStartedAt: new Date(turn.startedAt),
            activeExpiresAt: new Date(turn.expiresAt),
            updatedAt: now,
          },
          include: { messages: { orderBy: { ordinal: 'asc' } } },
        });
        return {
          kind: 'claimed',
          conversation: claimed,
          turn,
        } satisfies ClaimTransactionResult;
      }),
    );

    if (result.kind === 'conflict') {
      throw new CopilotStoreConflictError(result.code);
    }
    const conversation = mapStoredConversation(result.conversation);
    if (
      conversation.activeTurn?.turnId !== result.turn.turnId ||
      conversation.activeTurn.kind !== 'tool-continuation'
    ) {
      throw new Error('Copilot continuation claim was not canonical.');
    }
    return { conversation, turn: result.turn };
  }

  /**
   * Refresh both authoritative leases immediately before the paid provider.
   * Preparation may take arbitrarily long; a request that lost its initial
   * fence fails here and never reaches streamText.
   */
  async beginProvider(input: {
    userId: string;
    conversationId: string;
    turn: CopilotActiveTurn;
  }): Promise<CopilotActiveTurn> {
    const renewed = await this.databaseOperation(() =>
      this.prisma.$transaction(async (tx) => {
        const state = await this.lockUserStreamState(tx, input.userId);
        const now = await databaseNow(tx);
        if (!userFenceMatches(state, input.conversationId, input.turn, now)) {
          return null;
        }
        const stored = await this.lockConversation(
          tx,
          input.userId,
          input.conversationId,
        );
        if (!stored || !activeTurnMatches(stored, input.turn)) return null;
        mapStoredConversation(stored);
        const chargeAttempt = await loadCurrentChargeAttempt(tx, stored);
        if (
          chargeAttempt.id !== input.turn.chargeAttemptId ||
          chargeAttempt.ownerTurnId !== input.turn.turnId ||
          chargeAttempt.status !== StoredChargeStatus.charged
        ) {
          return null;
        }
        const expiresAt = new Date(now.getTime() + COPILOT_PROVIDER_LEASE_MS);
        await tx.copilotUserStreamState.update({
          where: { userId: input.userId },
          data: { leaseExpiresAt: expiresAt, updatedAt: now },
        });
        await tx.copilotConversation.update({
          where: { id: stored.id },
          data: { activeExpiresAt: expiresAt, updatedAt: now },
        });
        return { ...input.turn, expiresAt: expiresAt.getTime() };
      }),
    );
    if (!renewed) {
      throw new CopilotStoreConflictError('COPILOT_TURN_STALE');
    }
    return renewed;
  }

  async completeTurn(input: {
    userId: string;
    conversationId: string;
    turn: CopilotActiveTurn;
    responseMessage: UIMessage;
  }): Promise<boolean> {
    const serializedResponse = serializeMessage(
      input.responseMessage,
      'assistant',
    );
    const result = await this.databaseOperation(() =>
      this.prisma.$transaction(async (tx) => {
        const state = await this.lockUserStreamState(tx, input.userId);
        const now = await databaseNow(tx);
        if (!userFenceMatches(state, input.conversationId, input.turn, now)) {
          return { kind: 'stale' } satisfies CompleteTransactionResult;
        }
        const stored = await this.lockConversation(
          tx,
          input.userId,
          input.conversationId,
        );
        if (!stored || !activeTurnMatches(stored, input.turn)) {
          return { kind: 'stale' } satisfies CompleteTransactionResult;
        }
        mapStoredConversation(stored);
        const chargeAttempt = await loadCurrentChargeAttempt(tx, stored);
        if (
          chargeAttempt.id !== input.turn.chargeAttemptId ||
          chargeAttempt.ownerTurnId !== input.turn.turnId ||
          chargeAttempt.status !== StoredChargeStatus.charged
        ) {
          return { kind: 'stale' } satisfies CompleteTransactionResult;
        }
        if (input.turn.kind === 'tool-continuation') {
          const assistantRow = stored.messages[stored.messages.length - 1];
          if (
            assistantRow?.role !== CopilotMessageRole.assistant ||
            assistantRow.messageId !== serializedResponse.message.id
          ) {
            return {
              kind: 'conflict',
              code: 'COPILOT_TOOL_CONTINUATION_INVALID',
            } satisfies CompleteTransactionResult;
          }
          assertMonotonicServerContinuation(
            assistantRow.payload as unknown as UIMessage,
            serializedResponse.message,
          );
          const nextMessageBytes =
            stored.messageBytes -
            assistantRow.byteSize +
            serializedResponse.byteSize;
          const terminalConflict =
            serializedResponse.byteSize > COPILOT_MAX_ASSISTANT_MESSAGE_BYTES
              ? 'COPILOT_MESSAGE_TOO_LARGE'
              : nextMessageBytes > COPILOT_MAX_CANONICAL_BYTES
                ? 'COPILOT_HISTORY_LIMIT_REACHED'
                : null;
          if (terminalConflict) {
            await markCurrentChargeAttemptRefundPending(
              tx,
              stored,
              input.turn.turnId,
              'failed',
              now,
            );
            await tx.copilotConversation.update({
              where: { id: stored.id },
              data: {
                revision: { increment: 1 },
                status: StoredConversationStatus.limit_exceeded,
                ...clearActiveTurn(),
                updatedAt: now,
              },
            });
            await releaseUserStreamState(tx, input.userId, now);
            return {
              kind: 'conflict',
              code: terminalConflict,
            } satisfies CompleteTransactionResult;
          }
          await tx.copilotMessage.update({
            where: { id: assistantRow.id },
            data: {
              payload:
                serializedResponse.message as unknown as Prisma.InputJsonValue,
              byteSize: serializedResponse.byteSize,
            },
          });
          await markChargeAttemptAfterSuccessfulResponse(
            tx,
            chargeAttempt.id,
            serializedResponse.message,
            now,
            this.config.clientToolWaitTtlMs,
          );
          await tx.copilotConversation.update({
            where: { id: stored.id },
            data: {
              revision: { increment: 1 },
              status: StoredConversationStatus.ready,
              messageBytes: nextMessageBytes,
              ...clearActiveTurn(),
              updatedAt: now,
            },
          });
          await releaseUserStreamState(tx, input.userId, now);
          return { kind: 'completed' } satisfies CompleteTransactionResult;
        }
        if (
          stored.messages.some(
            (message) => message.messageId === serializedResponse.message.id,
          )
        ) {
          return {
            kind: 'conflict',
            code: 'COPILOT_MESSAGE_ALREADY_EXISTS',
          } satisfies CompleteTransactionResult;
        }
        const terminalConflict =
          serializedResponse.byteSize > COPILOT_MAX_ASSISTANT_MESSAGE_BYTES
            ? 'COPILOT_MESSAGE_TOO_LARGE'
            : stored.messageCount + 1 > COPILOT_MAX_CANONICAL_MESSAGES ||
                stored.messageBytes + serializedResponse.byteSize >
                  COPILOT_MAX_CANONICAL_BYTES
              ? 'COPILOT_HISTORY_LIMIT_REACHED'
              : null;
        if (terminalConflict) {
          await markCurrentChargeAttemptRefundPending(
            tx,
            stored,
            input.turn.turnId,
            'failed',
            now,
          );
          await tx.copilotConversation.update({
            where: { id: stored.id },
            data: {
              revision: { increment: 1 },
              status: StoredConversationStatus.limit_exceeded,
              ...clearActiveTurn(),
              updatedAt: now,
            },
          });
          await releaseUserStreamState(tx, input.userId, now);
          return {
            kind: 'conflict',
            code: terminalConflict,
          } satisfies CompleteTransactionResult;
        }

        await tx.copilotMessage.create({
          data: {
            conversationId: stored.id,
            ordinal: stored.messageCount,
            messageId: serializedResponse.message.id,
            role: CopilotMessageRole.assistant,
            payload:
              serializedResponse.message as unknown as Prisma.InputJsonValue,
            byteSize: serializedResponse.byteSize,
          },
        });
        await markChargeAttemptAfterSuccessfulResponse(
          tx,
          chargeAttempt.id,
          serializedResponse.message,
          now,
          this.config.clientToolWaitTtlMs,
        );
        await tx.copilotConversation.update({
          where: { id: stored.id },
          data: {
            revision: { increment: 1 },
            status: StoredConversationStatus.ready,
            messageCount: { increment: 1 },
            messageBytes: { increment: serializedResponse.byteSize },
            turnProposalUserMessageId: null,
            turnProposal: Prisma.DbNull,
            ...clearActiveTurn(),
            updatedAt: now,
          },
        });
        await releaseUserStreamState(tx, input.userId, now);
        return { kind: 'completed' } satisfies CompleteTransactionResult;
      }),
    );
    if (result.kind === 'stale') return false;
    if (result.kind === 'conflict') {
      throw new CopilotStoreConflictError(result.code);
    }
    return true;
  }

  /**
   * Canonicalize the first Story proposal while retaining the Copilot
   * user/conversation locks in the caller's transaction. The caller must take
   * any downstream domain lock only after this method returns.
   */
  async canonicalizeTurnProposalInTransaction<
    T extends Record<string, unknown>,
  >(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      conversationId: string;
      sessionId: string;
      turn: CopilotActiveTurn;
      proposal: T;
    },
  ): Promise<T> {
    if (input.turn.kind !== 'user') {
      throw new CopilotStoreConflictError('COPILOT_TURN_STALE');
    }
    if (!UUID_PATTERN.test(input.sessionId)) {
      throw new Error('Invalid Copilot proposal session.');
    }
    const proposal = serializeProposal(input.proposal);
    const state = await this.lockUserStreamState(tx, input.userId);
    const now = await databaseNow(tx);
    if (!userFenceMatches(state, input.conversationId, input.turn, now)) {
      throw new CopilotStoreConflictError('COPILOT_TURN_STALE');
    }
    const stored = await this.lockConversation(
      tx,
      input.userId,
      input.conversationId,
    );
    if (
      !stored ||
      stored.sessionId !== input.sessionId ||
      !activeTurnMatches(stored, input.turn)
    ) {
      throw new CopilotStoreConflictError('COPILOT_TURN_STALE');
    }
    mapStoredConversation(stored);
    const chargeAttempt = await loadCurrentChargeAttempt(tx, stored);
    if (
      chargeAttempt.id !== input.turn.chargeAttemptId ||
      chargeAttempt.ownerTurnId !== input.turn.turnId ||
      chargeAttempt.status !== StoredChargeStatus.charged
    ) {
      throw new CopilotStoreConflictError('COPILOT_TURN_STALE');
    }
    if (
      stored.turnProposalUserMessageId === null &&
      stored.turnProposal === null
    ) {
      const updated = await tx.copilotConversation.update({
        where: { id: stored.id },
        data: {
          turnProposalUserMessageId: input.turn.userMessageId,
          turnProposal: proposal as Prisma.InputJsonValue,
          updatedAt: now,
        },
        select: { turnProposal: true },
      });
      if (!isRecord(updated.turnProposal)) {
        throw new Error('Canonical Copilot proposal is invalid.');
      }
      return updated.turnProposal as T;
    }
    if (
      stored.turnProposalUserMessageId !== input.turn.userMessageId ||
      !isRecord(stored.turnProposal)
    ) {
      throw new Error('Canonical Copilot proposal metadata is invalid.');
    }
    return stored.turnProposal as T;
  }

  async terminalizeTurn(input: {
    userId: string;
    conversationId: string;
    turn: CopilotActiveTurn;
    status: 'failed' | 'aborted';
  }): Promise<boolean> {
    return this.databaseOperation(() =>
      this.prisma.$transaction(async (tx) => {
        const state = await this.lockUserStreamState(tx, input.userId);
        const now = await databaseNow(tx);
        if (!userFenceMatches(state, input.conversationId, input.turn, now)) {
          return false;
        }
        const stored = await this.lockConversation(
          tx,
          input.userId,
          input.conversationId,
        );
        if (!stored || !activeTurnMatches(stored, input.turn)) return false;
        mapStoredConversation(stored);
        if (stored.billingChargeAttemptId !== input.turn.chargeAttemptId) {
          return false;
        }
        await markCurrentChargeAttemptRefundPending(
          tx,
          stored,
          input.turn.turnId,
          input.status,
          now,
        );
        await tx.copilotConversation.update({
          where: { id: stored.id },
          data: {
            revision: { increment: 1 },
            status:
              input.status === 'failed'
                ? StoredConversationStatus.failed
                : StoredConversationStatus.aborted,
            ...clearActiveTurn(),
            updatedAt: now,
          },
        });
        await releaseUserStreamState(tx, input.userId, now);
        return true;
      }),
    );
  }

  async resetConversation(
    userId: string,
    conversationId: string,
    expectedRevision: number,
    expectedSessionId: string | null,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('Invalid expected Copilot revision.');
    }
    if (expectedSessionId !== null && !UUID_PATTERN.test(expectedSessionId)) {
      throw new Error('Invalid expected Copilot session.');
    }
    const result = await this.databaseOperation(() =>
      this.prisma.$transaction(async (tx) => {
        const stored = await this.lockConversation(tx, userId, conversationId);
        if (!stored) return 'missing' as const;
        const now = await databaseNow(tx);
        mapStoredConversation(stored);
        if (
          stored.revision !== expectedRevision ||
          expectedSessionId === null ||
          stored.sessionId !== expectedSessionId
        ) {
          return 'stale' as const;
        }
        if (
          stored.status === StoredConversationStatus.streaming &&
          stored.activeExpiresAt &&
          stored.activeExpiresAt.getTime() > now.getTime()
        ) {
          return 'active' as const;
        }
        if (stored.status === StoredConversationStatus.streaming) {
          await markCurrentChargeAttemptRefundPending(
            tx,
            stored,
            stored.activeTurnId,
            'failed',
            now,
          );
          await tx.copilotConversation.update({
            where: { id: stored.id },
            data: {
              revision: { increment: 1 },
              status: StoredConversationStatus.failed,
              ...clearActiveTurn(),
              updatedAt: now,
            },
          });
          return 'settlement_pending' as const;
        }
        const chargeAttempt = await loadCurrentChargeAttempt(tx, stored);
        if (chargeAttempt.status === StoredChargeStatus.charged) {
          await tx.copilotQuotaChargeAttempt.update({
            where: { id: chargeAttempt.id },
            data: {
              // A ready+charged conversation can only be waiting for a client
              // tool result. Reset is an explicit abandonment, so it follows
              // the same refund path as business expiry rather than charging
              // for an interaction the creator discarded.
              status: StoredChargeStatus.refund_pending,
              refundReason: 'aborted',
              clientToolExpiresAt: null,
              updatedAt: now,
            },
          });
        } else if (
          chargeAttempt.status !== StoredChargeStatus.refunded &&
          chargeAttempt.status !== StoredChargeStatus.settled
        ) {
          return 'settlement_pending' as const;
        }
        await tx.copilotConversation.delete({ where: { id: stored.id } });
        return 'reset' as const;
      }),
    );
    if (result === 'missing') return false;
    if (result === 'stale') {
      throw new CopilotStoreConflictError('COPILOT_TURN_STALE');
    }
    if (result === 'active') {
      throw new CopilotStoreConflictError('COPILOT_STREAM_IN_PROGRESS');
    }
    if (result === 'settlement_pending') {
      throw new CopilotStoreConflictError('COPILOT_QUOTA_SETTLEMENT_PENDING');
    }
    return true;
  }

  async load(
    userId: string,
    conversationId: string,
  ): Promise<CopilotConversation | null> {
    const stored = await this.databaseOperation(() =>
      this.prisma.copilotConversation.findUnique({
        where: { userId_conversationId: { userId, conversationId } },
        include: { messages: { orderBy: { ordinal: 'asc' } } },
      }),
    );
    if (!stored) return null;
    const conversation = mapStoredConversation(stored);
    if (conversation.status === 'streaming' && conversation.activeTurn) {
      const expired = await this.expireTurnIfElapsed(
        userId,
        conversationId,
        conversation.activeTurn,
      );
      if (expired) return this.load(userId, conversationId);
    }
    return conversation;
  }

  private async expireTurnIfElapsed(
    userId: string,
    conversationId: string,
    turn: CopilotActiveTurn,
  ): Promise<boolean> {
    return this.databaseOperation(() =>
      this.prisma.$transaction(async (tx) => {
        const streamState = await this.lockUserStreamState(tx, userId);
        const now = await databaseNow(tx);
        const stored = await this.lockConversation(tx, userId, conversationId);
        if (!stored || !activeTurnMatches(stored, turn)) return false;
        mapStoredConversation(stored);
        if (
          !stored.activeExpiresAt ||
          stored.activeExpiresAt.getTime() > now.getTime()
        ) {
          return false;
        }
        await markCurrentChargeAttemptRefundPending(
          tx,
          stored,
          turn.turnId,
          'failed',
          now,
        );
        await tx.copilotConversation.update({
          where: { id: stored.id },
          data: {
            revision: { increment: 1 },
            status: StoredConversationStatus.failed,
            ...clearActiveTurn(),
            updatedAt: now,
          },
        });
        if (userFenceIdentityMatches(streamState, conversationId, turn)) {
          await releaseUserStreamState(tx, userId, now);
        }
        return true;
      }),
    );
  }

  async list(userId: string, limit = 50): Promise<string[]> {
    const safeLimit = Math.min(
      MAX_LIST_LIMIT,
      Math.max(1, Number.isSafeInteger(limit) ? limit : 50),
    );
    const rows = await this.databaseOperation(() =>
      this.prisma.copilotConversation.findMany({
        where: { userId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: safeLimit,
        select: { conversationId: true },
      }),
    );
    return rows.map((row) => row.conversationId);
  }

  private async lockConversation(
    tx: Prisma.TransactionClient,
    userId: string,
    conversationId: string,
  ): Promise<StoredConversation | null> {
    // The advisory lock closes the missing-row race for first claim/reset.
    // Existing rows additionally use FOR UPDATE as the transition mutex.
    const lockKey = `copilot:${userId}:${conversationId}`;
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "copilot_conversations"
      WHERE "user_id" = ${userId}
        AND "conversation_id" = ${conversationId}
      FOR UPDATE
    `);
    const id = locked[0]?.id;
    if (!id) return null;
    return tx.copilotConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { ordinal: 'asc' } } },
    });
  }

  private async databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof CopilotStoreConflictError ||
        (error instanceof Error && error.message.startsWith('Invalid Copilot'))
      ) {
        throw error;
      }
      this.logger.error(
        `copilot.postgres_unavailable error=${errorMessage(error)}`,
      );
      throw new CopilotStoreUnavailableError();
    }
  }

  private async lockUserStreamState(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const lockKey = `copilot-user-stream:${userId}`;
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
    const locked = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
      SELECT "user_id" AS "userId"
      FROM "copilot_user_stream_states"
      WHERE "user_id" = ${userId}
      FOR UPDATE
    `);
    if (!locked[0]) return null;
    return tx.copilotUserStreamState.findUnique({ where: { userId } });
  }
}

function serializeMessage(
  message: UIMessage,
  expectedRole: 'user' | 'assistant',
  maximumBytes = Number.POSITIVE_INFINITY,
): { message: UIMessage; byteSize: number } {
  assertMessageShape(message);
  if (message.role !== expectedRole) {
    throw new Error(
      expectedRole === 'user'
        ? 'A Copilot turn must contain exactly one user message.'
        : 'A completed Copilot turn must contain one assistant response.',
    );
  }
  let raw: string;
  try {
    raw = JSON.stringify(message);
  } catch {
    throw new Error('Invalid Copilot UI message.');
  }
  const byteSize = Buffer.byteLength(raw, 'utf8');
  if (byteSize > maximumBytes) {
    throw new CopilotStoreConflictError('COPILOT_MESSAGE_TOO_LARGE');
  }
  const canonical = JSON.parse(raw) as UIMessage;
  assertMessageShape(canonical);
  return { message: canonical, byteSize };
}

function serializeProposal<T extends Record<string, unknown>>(proposal: T): T {
  let raw: string;
  try {
    raw = JSON.stringify(proposal);
  } catch {
    throw new Error('Invalid Copilot proposal.');
  }
  if (Buffer.byteLength(raw, 'utf8') > COPILOT_MAX_ASSISTANT_MESSAGE_BYTES) {
    throw new CopilotStoreConflictError('COPILOT_MESSAGE_TOO_LARGE');
  }
  const canonical = JSON.parse(raw) as unknown;
  if (!isRecord(canonical)) throw new Error('Invalid Copilot proposal.');
  return canonical as T;
}

function assertClientToolContinuation(
  canonical: UIMessage,
  candidate: UIMessage,
): void {
  const { parts: canonicalParts, ...canonicalEnvelope } = canonical;
  const { parts: candidateParts, ...candidateEnvelope } = candidate;
  if (
    canonical.role !== 'assistant' ||
    candidate.role !== 'assistant' ||
    !isDeepStrictEqual(canonicalEnvelope, candidateEnvelope) ||
    canonicalParts.length !== candidateParts.length
  ) {
    throw new CopilotStoreConflictError('COPILOT_TOOL_CONTINUATION_INVALID');
  }

  let completedCalls = 0;
  for (let index = 0; index < canonicalParts.length; index += 1) {
    const original = canonicalParts[index];
    const resolved = candidateParts[index];
    if (!isToolUIPart(original) || !isToolUIPart(resolved)) {
      if (!isDeepStrictEqual(original, resolved)) {
        throw new CopilotStoreConflictError(
          'COPILOT_TOOL_CONTINUATION_INVALID',
        );
      }
      continue;
    }
    if (
      original.type !== resolved.type ||
      original.toolCallId !== resolved.toolCallId ||
      original.providerExecuted ||
      resolved.providerExecuted
    ) {
      if (!isDeepStrictEqual(original, resolved)) {
        throw new CopilotStoreConflictError(
          'COPILOT_TOOL_CONTINUATION_INVALID',
        );
      }
      continue;
    }
    if (original.state !== 'input-available') {
      if (!isDeepStrictEqual(original, resolved)) {
        throw new CopilotStoreConflictError(
          'COPILOT_TOOL_CONTINUATION_INVALID',
        );
      }
      continue;
    }
    if (
      resolved.state !== 'output-available' &&
      resolved.state !== 'output-error'
    ) {
      throw new CopilotStoreConflictError('COPILOT_TOOL_CONTINUATION_INVALID');
    }
    if (
      !isDeepStrictEqual(
        immutableToolPart(original as unknown as Record<string, unknown>),
        immutableToolPart(resolved as unknown as Record<string, unknown>),
      )
    ) {
      throw new CopilotStoreConflictError('COPILOT_TOOL_CONTINUATION_INVALID');
    }
    completedCalls += 1;
  }

  if (
    completedCalls === 0 ||
    !lastAssistantMessageIsCompleteWithToolCalls({ messages: [candidate] })
  ) {
    throw new CopilotStoreConflictError('COPILOT_TOOL_CONTINUATION_INVALID');
  }
}

function assistantHasPendingClientToolCalls(message: UIMessage): boolean {
  return message.parts.some(
    (part) =>
      isToolUIPart(part) &&
      !part.providerExecuted &&
      part.state !== 'output-available' &&
      part.state !== 'output-error',
  );
}

function assertMonotonicServerContinuation(
  canonical: UIMessage,
  candidate: UIMessage,
): void {
  const {
    parts: canonicalParts,
    metadata: canonicalMetadata,
    ...canonicalEnvelope
  } = canonical;
  const {
    parts: candidateParts,
    metadata: candidateMetadata,
    ...candidateEnvelope
  } = candidate;
  if (
    !isDeepStrictEqual(canonicalEnvelope, candidateEnvelope) ||
    candidateParts.length <= canonicalParts.length ||
    !canonicalParts.every((part, index) =>
      isDeepStrictEqual(part, candidateParts[index]),
    ) ||
    !jsonContains(candidateMetadata, canonicalMetadata)
  ) {
    throw new CopilotStoreConflictError('COPILOT_TOOL_CONTINUATION_INVALID');
  }
}

function jsonContains(candidate: unknown, canonical: unknown): boolean {
  if (canonical === undefined) return true;
  if (Array.isArray(canonical)) {
    return (
      Array.isArray(candidate) &&
      candidate.length >= canonical.length &&
      canonical.every((value, index) => jsonContains(candidate[index], value))
    );
  }
  if (isRecord(canonical)) {
    return (
      isRecord(candidate) &&
      Object.entries(canonical).every(([key, value]) =>
        jsonContains(candidate[key], value),
      )
    );
  }
  return isDeepStrictEqual(candidate, canonical);
}

function immutableToolPart(
  part: Record<string, unknown>,
): Record<string, unknown> {
  const immutable = { ...part };
  delete immutable.state;
  delete immutable.output;
  delete immutable.errorText;
  return immutable;
}

function mapStoredConversation(
  stored: StoredConversation,
): CopilotConversation {
  if (
    stored.messageCount !== stored.messages.length ||
    stored.messageCount < 1 ||
    stored.messageCount > COPILOT_MAX_CANONICAL_MESSAGES ||
    stored.messageBytes < 1 ||
    stored.messageBytes > COPILOT_MAX_CANONICAL_BYTES
  ) {
    throw new Error('Invalid Copilot canonical message counters.');
  }
  const messages: UIMessage[] = [];
  let actualBytes = 0;
  for (let index = 0; index < stored.messages.length; index += 1) {
    const row = stored.messages[index];
    if (row.ordinal !== index) {
      throw new Error('Invalid Copilot canonical message ordinal.');
    }
    if (!isRecord(row.payload)) {
      throw new Error('Invalid Copilot canonical message payload.');
    }
    const message = row.payload as unknown as UIMessage;
    assertMessageShape(message);
    const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
    if (
      message.role !== expectedRole ||
      row.role !== expectedRole ||
      message.id !== row.messageId
    ) {
      throw new Error('Invalid Copilot canonical message sequence.');
    }
    const actualMessageBytes = Buffer.byteLength(
      JSON.stringify(message),
      'utf8',
    );
    const maximum =
      expectedRole === 'user'
        ? COPILOT_MAX_USER_MESSAGE_BYTES
        : COPILOT_MAX_ASSISTANT_MESSAGE_BYTES;
    if (actualMessageBytes !== row.byteSize || row.byteSize > maximum) {
      throw new Error('Invalid Copilot canonical message byte size.');
    }
    actualBytes += row.byteSize;
    messages.push(message);
  }
  if (actualBytes !== stored.messageBytes) {
    throw new Error('Invalid Copilot canonical byte counter.');
  }

  const status = parseConversationStatus(stored.status);
  const last = messages[messages.length - 1];
  const activeTurn = parseActiveTurn(stored, status);
  const expectedTailRole =
    status === 'ready'
      ? 'assistant'
      : status === 'streaming'
        ? activeTurn?.kind === 'tool-continuation'
          ? 'assistant'
          : 'user'
        : null;
  if (expectedTailRole !== null && last?.role !== expectedTailRole) {
    throw new Error('Invalid Copilot canonical status/message tail.');
  }
  if (activeTurn?.kind === 'user' && activeTurn.userMessageId !== last?.id) {
    throw new Error('Invalid Copilot active user message.');
  }
  if (activeTurn?.kind === 'tool-continuation') {
    const origin = messages[messages.length - 2];
    if (
      last?.role !== 'assistant' ||
      origin?.role !== 'user' ||
      activeTurn.userMessageId !== origin.id
    ) {
      throw new Error('Invalid Copilot continuation origin.');
    }
  }
  const mode = fromStoredMode(stored.mode);
  const selectedSkillKeys = parseSelectedSkillKeys(
    stored.selectedSkillKeys,
    mode,
  );
  validateStoredProposal(stored, last?.id);
  return {
    schemaVersion: 1,
    sessionId: stored.sessionId,
    conversationId: stored.conversationId,
    userId: stored.userId,
    projectId: stored.projectId,
    mode,
    selectedSkillKeys,
    messages,
    revision: stored.revision,
    status,
    activeTurn,
    updatedAt: stored.updatedAt.getTime(),
  };
}

function parseActiveTurn(
  stored: StoredConversation,
  status: CopilotConversationStatus,
): CopilotActiveTurn | null {
  const fields = [
    stored.activeTurnId,
    stored.activeTurnKind,
    stored.activeClaimToken,
    stored.activeRevision,
    stored.activeUserMessageId,
    stored.activeAdmissionToken,
    stored.activeAdmissionRevision,
    stored.activeStartedAt,
    stored.activeExpiresAt,
  ];
  if (status !== 'streaming') {
    if (fields.some((field) => field !== null)) {
      throw new Error('Invalid terminal Copilot active claim.');
    }
    return null;
  }
  if (fields.some((field) => field === null)) {
    throw new Error('Invalid streaming Copilot active claim.');
  }
  if (
    stored.activeRevision !== stored.revision ||
    !stored.activeTurnId ||
    !stored.activeTurnKind ||
    !stored.activeClaimToken ||
    !stored.activeUserMessageId ||
    !stored.activeAdmissionToken ||
    stored.activeAdmissionRevision === null ||
    !stored.activeStartedAt ||
    !stored.activeExpiresAt
  ) {
    throw new Error('Invalid Copilot active claim revision.');
  }
  return {
    kind:
      stored.activeTurnKind === StoredTurnKind.user
        ? 'user'
        : 'tool-continuation',
    turnId: stored.activeTurnId,
    billingOperationId: stored.billingOperationId,
    chargeAttemptId: stored.billingChargeAttemptId,
    claimToken: stored.activeClaimToken,
    claimRevision: stored.activeRevision,
    userMessageId: stored.activeUserMessageId,
    admissionToken: stored.activeAdmissionToken,
    admissionFencingRevision: stored.activeAdmissionRevision,
    startedAt: stored.activeStartedAt.getTime(),
    expiresAt: stored.activeExpiresAt.getTime(),
  };
}

function activeTurnMatches(
  stored: StoredConversation,
  turn: CopilotActiveTurn,
): boolean {
  return (
    stored.status === StoredConversationStatus.streaming &&
    stored.activeTurnKind === toStoredTurnKind(turn.kind) &&
    stored.billingOperationId === turn.billingOperationId &&
    stored.billingChargeAttemptId === turn.chargeAttemptId &&
    stored.revision === turn.claimRevision &&
    stored.activeRevision === turn.claimRevision &&
    stored.activeTurnId === turn.turnId &&
    stored.activeClaimToken === turn.claimToken &&
    stored.activeUserMessageId === turn.userMessageId &&
    stored.activeAdmissionToken === turn.admissionToken &&
    stored.activeAdmissionRevision === turn.admissionFencingRevision
  );
}

function clearActiveTurn() {
  return {
    activeTurnId: null,
    activeTurnKind: null,
    activeClaimToken: null,
    activeRevision: null,
    activeUserMessageId: null,
    activeAdmissionToken: null,
    activeAdmissionRevision: null,
    activeStartedAt: null,
    activeExpiresAt: null,
  } as const;
}

function quotaBucketsForDate(now: Date): {
  dayBucket: string;
  monthBucket: string;
} {
  const iso = now.toISOString();
  return { dayBucket: iso.slice(0, 10), monthBucket: iso.slice(0, 7) };
}

async function loadCurrentChargeAttempt(
  tx: Prisma.TransactionClient,
  stored: StoredConversation,
) {
  const attempt = await tx.copilotQuotaChargeAttempt.findUnique({
    where: { id: stored.billingChargeAttemptId },
  });
  if (
    !attempt ||
    attempt.billingOperationId !== stored.billingOperationId ||
    attempt.userId !== stored.userId ||
    attempt.conversationId !== stored.conversationId ||
    attempt.sessionId !== stored.sessionId
  ) {
    throw new Error('Invalid canonical Copilot quota charge attempt.');
  }
  return attempt;
}

async function markCurrentChargeAttemptRefundPending(
  tx: Prisma.TransactionClient,
  stored: StoredConversation,
  ownerTurnId: string | null,
  reason: 'failed' | 'aborted',
  now: Date,
): Promise<void> {
  if (!ownerTurnId) {
    throw new Error('Active Copilot charge attempt has no owner turn.');
  }
  const attempt = await loadCurrentChargeAttempt(tx, stored);
  if (attempt.ownerTurnId !== ownerTurnId) {
    throw new Error('Copilot quota charge attempt lost its turn fence.');
  }
  if (
    attempt.status === StoredChargeStatus.consume_pending ||
    attempt.status === StoredChargeStatus.charged
  ) {
    await tx.copilotQuotaChargeAttempt.update({
      where: { id: attempt.id },
      data: {
        status: StoredChargeStatus.refund_pending,
        refundReason: reason,
        clientToolExpiresAt: null,
        updatedAt: now,
      },
    });
    return;
  }
  if (
    attempt.status === StoredChargeStatus.refund_pending &&
    attempt.refundReason === reason
  ) {
    return;
  }
  throw new Error('Invalid Copilot quota charge attempt refund transition.');
}

async function markChargeAttemptAfterSuccessfulResponse(
  tx: Prisma.TransactionClient,
  attemptId: string,
  response: UIMessage,
  now: Date,
  clientToolWaitTtlMs: number,
): Promise<void> {
  if (assistantHasPendingClientToolCalls(response)) {
    const updated = await tx.copilotQuotaChargeAttempt.updateMany({
      where: {
        id: attemptId,
        status: StoredChargeStatus.charged,
      },
      data: {
        clientToolExpiresAt: new Date(now.getTime() + clientToolWaitTtlMs),
        updatedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error('Copilot quota attempt lost its client-tool fence.');
    }
    return;
  }
  const updated = await tx.copilotQuotaChargeAttempt.updateMany({
    where: {
      id: attemptId,
      status: StoredChargeStatus.charged,
    },
    data: {
      status: StoredChargeStatus.settle_pending,
      clientToolExpiresAt: null,
      updatedAt: now,
    },
  });
  if (updated.count !== 1) {
    throw new Error('Copilot quota charge attempt lost its success fence.');
  }
}

function validateStoredProposal(
  stored: StoredConversation,
  lastMessageId: string | undefined,
): void {
  const hasUserMessageId = stored.turnProposalUserMessageId !== null;
  const hasProposal = stored.turnProposal !== null;
  if (hasUserMessageId !== hasProposal) {
    throw new Error('Invalid Copilot proposal metadata.');
  }
  if (!hasProposal) return;
  if (
    stored.turnProposalUserMessageId !== lastMessageId ||
    !isRecord(stored.turnProposal)
  ) {
    throw new Error('Invalid Copilot proposal metadata.');
  }
}

function parseSelectedSkillKeys(
  value: Prisma.JsonValue,
  mode: 'canvas' | 'story-canvas',
): StoryDirectingSkillKey[] {
  const allowed = new Set<string>(STORY_DIRECTING_SKILL_KEYS);
  if (
    !Array.isArray(value) ||
    value.length > 1 ||
    (mode === 'canvas' && value.length !== 0) ||
    !value.every((item) => typeof item === 'string' && allowed.has(item)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('Invalid Copilot selected skills metadata.');
  }
  return value as StoryDirectingSkillKey[];
}

function assertSelectedSkillKeys(
  value: StoryDirectingSkillKey[],
  mode: 'canvas' | 'story-canvas',
): void {
  parseSelectedSkillKeys(value, mode);
}

function parseConversationStatus(
  value: StoredConversationStatus,
): CopilotConversationStatus {
  return value;
}

function toStoredMode(mode: 'canvas' | 'story-canvas'): StoredConversationMode {
  return mode === 'canvas'
    ? StoredConversationMode.canvas
    : StoredConversationMode.story_canvas;
}

function fromStoredMode(
  mode: StoredConversationMode,
): 'canvas' | 'story-canvas' {
  return mode === StoredConversationMode.canvas ? 'canvas' : 'story-canvas';
}

function toStoredTurnKind(kind: CopilotActiveTurn['kind']): StoredTurnKind {
  return kind === 'user'
    ? StoredTurnKind.user
    : StoredTurnKind.tool_continuation;
}

function userFenceIdentityMatches(
  state: StoredUserStreamState | null,
  conversationId: string,
  turn: CopilotActiveTurn,
): boolean {
  return (
    state !== null &&
    state.claimToken === turn.admissionToken &&
    state.conversationId === conversationId &&
    state.fencingRevision === turn.admissionFencingRevision
  );
}

function userFenceMatches(
  state: StoredUserStreamState | null,
  conversationId: string,
  turn: CopilotActiveTurn,
  now: Date,
): boolean {
  return (
    userFenceIdentityMatches(state, conversationId, turn) &&
    state !== null &&
    state.leaseExpiresAt !== null &&
    state.leaseExpiresAt.getTime() > now.getTime()
  );
}

async function releaseUserStreamState(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<void> {
  await tx.copilotUserStreamState.update({
    where: { userId },
    data: {
      claimToken: null,
      conversationId: null,
      leaseExpiresAt: null,
      updatedAt: now,
    },
  });
}

function assertConversationScope(
  stored: StoredConversation,
  input: { projectId: string; mode: 'canvas' | 'story-canvas' },
): void {
  if (
    stored.projectId !== input.projectId ||
    fromStoredMode(stored.mode) !== input.mode
  ) {
    throw new Error('Invalid Copilot conversation scope.');
  }
}

function assertStoreIdentity(input: {
  userId: string;
  conversationId: string;
  projectId: string;
  mode: 'canvas' | 'story-canvas';
}): void {
  if (
    !input.userId ||
    input.userId.length > 64 ||
    !input.conversationId ||
    input.conversationId.length > 180 ||
    !UUID_PATTERN.test(input.projectId) ||
    (input.mode !== 'canvas' && input.mode !== 'story-canvas')
  ) {
    throw new Error('Invalid Copilot conversation identity.');
  }
}

function assertLeaseIdentity(userId: string, conversationId: string): void {
  if (
    !userId ||
    userId.length > 64 ||
    !conversationId ||
    conversationId.length > 180
  ) {
    throw new Error('Invalid Copilot admission identity.');
  }
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  const now = rows[0]?.now;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('Invalid Copilot database clock.');
  }
  return now;
}

function assertMessageShape(message: UIMessage): void {
  if (
    !message ||
    typeof message.id !== 'string' ||
    message.id.trim().length === 0 ||
    message.id.trim() !== message.id ||
    message.id.length > 128 ||
    !Array.isArray(message.parts) ||
    message.parts.length === 0 ||
    !message.parts.every(
      (part) =>
        isRecord(part) &&
        typeof part.type === 'string' &&
        part.type.trim().length > 0,
    )
  ) {
    throw new Error('Invalid Copilot UI message.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
