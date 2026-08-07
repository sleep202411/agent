import type { RiskLevel } from "@repo/agent-policy";
import type { z } from "zod";

/**
 * Every tool is either a pure query or a domain command.
 * Commands never execute inside the model provider callback without going
 * through the Agent OS executor + policy gate.
 */
export type ToolKind = "query" | "command";

export interface ToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  id: string;
  description: string;
  kind: ToolKind;
  risk: RiskLevel;
  inputSchema: TInput;
  outputSchema: TOutput;
}

export interface ToolExecutionContext {
  runId: string;
  conversationId: string;
  projectId: string;
  actorId: string;
  /** Stable key: projectId + runId + toolCallId + operationVersion */
  idempotencyKey: string;
  toolCallId: string;
  abortSignal?: AbortSignal;
}

export type ToolExecuteResult<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      message: string;
      retryable: boolean;
      details?: Record<string, unknown>;
    };

/**
 * Port implemented by the product Domain layer (Nest later).
 * Agent OS and tools never open a DB connection themselves.
 */
export interface DomainPort {
  execute(
    toolId: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecuteResult>;
}
