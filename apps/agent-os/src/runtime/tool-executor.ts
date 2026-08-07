import { requiresApproval, type AgentMode, type PermissionMode } from "@repo/agent-policy";
import {
  buildToolIdempotencyKey,
  getTool,
  parseToolInput,
  parseToolOutput,
  type DomainPort,
  type ToolExecuteResult,
  type ToolExecutionContext,
} from "@repo/agent-tools";

export interface ProposedToolCall {
  toolCallId: string;
  toolId: string;
  arguments: unknown;
}

export type ToolGateResult =
  | { status: "executed"; result: ToolExecuteResult }
  | {
      status: "approval_required";
      approvalId: string;
      toolCallId: string;
      toolId: string;
      arguments: unknown;
      title: string;
      description: string;
    }
  | { status: "rejected_policy"; code: string; message: string }
  | { status: "invalid_input"; code: string; message: string };

/**
 * Policy-aware tool execution. Domain writes only happen after approval when required.
 */
export async function executeToolCall(input: {
  call: ProposedToolCall;
  domain: DomainPort;
  mode: AgentMode;
  permissionMode: PermissionMode;
  context: Omit<ToolExecutionContext, "idempotencyKey" | "toolCallId">;
  /** When resuming after approval, skip the gate. */
  forceExecute?: boolean;
}): Promise<ToolGateResult> {
  let tool;
  try {
    tool = getTool(input.call.toolId);
  } catch {
    return {
      status: "rejected_policy",
      code: "UNKNOWN_TOOL",
      message: `Tool not registered: ${input.call.toolId}`,
    };
  }

  let parsedInput: unknown;
  try {
    parsedInput = parseToolInput(input.call.toolId, input.call.arguments);
  } catch (error) {
    return {
      status: "invalid_input",
      code: "TOOL_INPUT_INVALID",
      message: error instanceof Error ? error.message : "Invalid tool input",
    };
  }

  const gate = requiresApproval({
    mode: input.mode,
    permissionMode: input.permissionMode,
    risk: tool.risk,
  });

  if (gate.required && !input.forceExecute) {
    if (input.mode === "DISCUSS" && tool.risk !== "read") {
      return {
        status: "rejected_policy",
        code: "DISCUSS_WRITE_FORBIDDEN",
        message: gate.reason,
      };
    }
    return {
      status: "approval_required",
      approvalId: crypto.randomUUID(),
      toolCallId: input.call.toolCallId,
      toolId: input.call.toolId,
      arguments: parsedInput,
      title: `Approve ${input.call.toolId}`,
      description: gate.reason,
    };
  }

  const context: ToolExecutionContext = {
    ...input.context,
    toolCallId: input.call.toolCallId,
    idempotencyKey: buildToolIdempotencyKey({
      projectId: input.context.projectId,
      runId: input.context.runId,
      toolCallId: input.call.toolCallId,
    }),
  };

  const result = await input.domain.execute(input.call.toolId, parsedInput, context);
  if (result.ok) {
    try {
      parseToolOutput(input.call.toolId, result.data);
    } catch (error) {
      return {
        status: "executed",
        result: {
          ok: false,
          code: "TOOL_OUTPUT_INVALID",
          message: error instanceof Error ? error.message : "Invalid tool output",
          retryable: false,
        },
      };
    }
  }
  return { status: "executed", result };
}
