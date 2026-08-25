import type { AgentProjectKind } from '@repo/agent-capabilities';

export interface AgentOsStartExecutionProof {
  executionToken: string;
  executionAttemptId: string;
  executionEpoch: number;
  executionOwnerId: string;
}

export interface AgentOsContinuationExecutionProof {
  executionToken: string;
  executionAttemptId: string;
  executionEpoch: number;
  executionOwnerId: string;
}

/** Opaque lease passed only to command handlers after durable admission. */
export interface AgentOsToolExecutionReceiptContext {
  receiptId: string;
  leaseId: string;
  requestFingerprint: string;
}

export interface AgentOsCapabilityExecuteInput {
  toolId: string;
  runId: string;
  conversationId: string;
  turnId: string;
  toolCallId: string;
  actorId: string;
  projectId: string;
  skillResolutionId: string;
  skillVersionIds: readonly string[];
  workbenchContext?: Readonly<Record<string, string>>;
  idempotencyKey: string;
  startExecution?: AgentOsStartExecutionProof;
  /**
   * Present while resuming a durable approval/input continuation. It fences
   * every new or executing product write to the current DB-clock lease.
   */
  continuationExecution?: AgentOsContinuationExecutionProof;
  toolExecutionReceipt?: AgentOsToolExecutionReceiptContext;
  arguments: unknown;
}

/** Compiled business execution boundary for one Agent OS project kind. */
export interface AgentOsCapabilityHandler {
  readonly projectKind: AgentProjectKind;
  supports(toolId: string): boolean;
  execute(input: AgentOsCapabilityExecuteInput): Promise<unknown>;
}
