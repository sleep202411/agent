import type { AgentMode, PermissionMode } from "@repo/agent-policy";
import type { AgentRunStatus } from "@repo/agent-protocol";
import { getTool, type DomainPort } from "@repo/agent-tools";

import { EventJournal } from "./event-journal.js";
import { executeToolCall, type ProposedToolCall } from "./tool-executor.js";

export interface TurnRunnerConfig {
  sessionId: string;
  runId: string;
  conversationId: string;
  projectId: string;
  actorId: string;
  mode: AgentMode;
  permissionMode: PermissionMode;
  domain: DomainPort;
  journal?: EventJournal;
  /** Wall-clock budget for this interactive turn (STABILITY §6). */
  wallClockMs?: number;
}

export interface PlannedTurn {
  /** Optional user-visible plan lines. */
  planSteps?: string[];
  /** Ordered tool calls (from model or a test planner). */
  toolCalls: ProposedToolCall[];
  /** Final assistant text after tools (or when waiting on approval). */
  assistantText?: string;
}

export interface TurnResult {
  status: AgentRunStatus;
  journal: EventJournal;
  pendingApproval?: {
    approvalId: string;
    toolCallId: string;
    toolId: string;
    arguments: unknown;
  };
  /** Remaining tool calls after a pause (for resume). */
  remainingToolCalls: ProposedToolCall[];
}

/**
 * Multi-step tool turn without LLM binding yet.
 *
 * Production will obtain `toolCalls` from LangGraph + LiteLLM; this runner is
 * the durable execution + event spine those nodes will call into.
 */
export class TurnRunner {
  readonly journal: EventJournal;
  private readonly startedAt = Date.now();
  private readonly wallClockMs: number;

  constructor(private readonly config: TurnRunnerConfig) {
    this.journal = config.journal ?? new EventJournal();
    this.wallClockMs = config.wallClockMs ?? 10 * 60_000;
  }

  private assertBudget(): void {
    if (Date.now() - this.startedAt > this.wallClockMs) {
      throw new TurnBudgetExceededError(this.wallClockMs);
    }
  }

  private emit(
    type: Parameters<EventJournal["append"]>[0]["type"],
    data: Record<string, unknown>
  ): void {
    this.journal.append({
      sessionId: this.config.sessionId,
      runId: this.config.runId,
      conversationId: this.config.conversationId,
      type,
      data,
    });
  }

  async run(plan: PlannedTurn): Promise<TurnResult> {
    this.emit("RunStarted", {
      status: "running",
      workspaceType: "project_canvas",
      modelProfileId: "unset",
    });

    if (plan.planSteps?.length) {
      this.emit("PlanCreated", {
        steps: plan.planSteps,
      });
    }

    return this.continueTools(plan.toolCalls, plan.assistantText);
  }

  /**
   * Resume the same run after approval (STABILITY: same runId, not a parallel attempt).
   */
  async resumeAfterApproval(input: {
    approvalId: string;
    decision: "approve" | "reject";
    toolCall: ProposedToolCall;
    remainingToolCalls: ProposedToolCall[];
    assistantText?: string;
  }): Promise<TurnResult> {
    this.emit("ApprovalResolved", {
      approvalId: input.approvalId,
      decision: input.decision,
    });

    if (input.decision === "reject") {
      this.emit("RunCancelled", {
        status: "cancelled",
        error: {
          code: "APPROVAL_REJECTED",
          message: "User rejected the proposed write.",
          retryable: false,
        },
      });
      return {
        status: "cancelled",
        journal: this.journal,
        remainingToolCalls: [],
      };
    }

    this.emit("ToolStarted", {
      toolCallId: input.toolCall.toolCallId,
      toolId: input.toolCall.toolId,
    });

    const gate = await executeToolCall({
      call: input.toolCall,
      domain: this.config.domain,
      mode: this.config.mode,
      permissionMode: this.config.permissionMode,
      forceExecute: true,
      context: {
        runId: this.config.runId,
        conversationId: this.config.conversationId,
        projectId: this.config.projectId,
        actorId: this.config.actorId,
      },
    });

    if (gate.status !== "executed") {
      this.emit("ToolFailed", {
        toolCallId: input.toolCall.toolCallId,
        toolId: input.toolCall.toolId,
        code: "EXECUTION_GATE_ERROR",
        message: "Unexpected gate state after forced approval execute",
        retryable: false,
      });
      this.emit("RunFailed", {
        status: "failed",
        error: {
          code: "TOOL_GATE_ERROR",
          message: "Failed to execute approved tool",
          retryable: false,
        },
      });
      return { status: "failed", journal: this.journal, remainingToolCalls: [] };
    }

    this.emitToolResult(input.toolCall, gate.result);
    if (!gate.result.ok) {
      this.emit("RunFailed", {
        status: "failed",
        error: {
          code: gate.result.code,
          message: gate.result.message,
          retryable: gate.result.retryable,
        },
      });
      return { status: "failed", journal: this.journal, remainingToolCalls: [] };
    }

    return this.continueTools(input.remainingToolCalls, input.assistantText);
  }

  private async continueTools(
    toolCalls: ProposedToolCall[],
    assistantText?: string
  ): Promise<TurnResult> {
    for (let i = 0; i < toolCalls.length; i++) {
      this.assertBudget();
      const call = toolCalls[i]!;
      const remaining = toolCalls.slice(i + 1);

      const risk = getTool(call.toolId).risk;
      this.emit("ToolProposed", {
        toolCallId: call.toolCallId,
        toolId: call.toolId,
        arguments:
          typeof call.arguments === "object" && call.arguments !== null
            ? (call.arguments as Record<string, unknown>)
            : { value: call.arguments },
        risk,
      });

      const gate = await executeToolCall({
        call,
        domain: this.config.domain,
        mode: this.config.mode,
        permissionMode: this.config.permissionMode,
        context: {
          runId: this.config.runId,
          conversationId: this.config.conversationId,
          projectId: this.config.projectId,
          actorId: this.config.actorId,
        },
      });

      if (gate.status === "approval_required") {
        this.emit("ApprovalRequired", {
          approvalId: gate.approvalId,
          toolCallId: gate.toolCallId,
          title: gate.title,
          description: gate.description,
          reversible: false,
          actions: ["approve", "edit_and_approve", "reject"],
        });
        this.emit("RunPaused", { status: "waiting_for_approval" });
        return {
          status: "waiting_for_approval",
          journal: this.journal,
          pendingApproval: {
            approvalId: gate.approvalId,
            toolCallId: gate.toolCallId,
            toolId: gate.toolId,
            arguments: gate.arguments,
          },
          remainingToolCalls: remaining,
        };
      }

      if (gate.status === "rejected_policy" || gate.status === "invalid_input") {
        this.emit("ToolFailed", {
          toolCallId: call.toolCallId,
          toolId: call.toolId,
          code: gate.code,
          message: gate.message,
          retryable: false,
        });
        this.emit("RunFailed", {
          status: "failed",
          error: {
            code: gate.code,
            message: gate.message,
            retryable: false,
          },
        });
        return { status: "failed", journal: this.journal, remainingToolCalls: remaining };
      }

      this.emit("ToolStarted", {
        toolCallId: call.toolCallId,
        toolId: call.toolId,
      });
      this.emitToolResult(call, gate.result);

      if (!gate.result.ok) {
        this.emit("RunFailed", {
          status: "failed",
          error: {
            code: gate.result.code,
            message: gate.result.message,
            retryable: gate.result.retryable,
          },
        });
        return { status: "failed", journal: this.journal, remainingToolCalls: remaining };
      }
    }

    if (assistantText) {
      const messageId = crypto.randomUUID();
      this.emit("MessageStarted", { messageId });
      this.emit("MessageCompleted", { messageId, text: assistantText });
    }

    this.emit("RunCompleted", { status: "completed" });
    return {
      status: "completed",
      journal: this.journal,
      remainingToolCalls: [],
    };
  }

  private emitToolResult(
    call: ProposedToolCall,
    result:
      | { ok: true; data: unknown }
      | { ok: false; code: string; message: string; retryable: boolean }
  ): void {
    if (result.ok) {
      this.emit("ToolCompleted", {
        toolCallId: call.toolCallId,
        toolId: call.toolId,
        result:
          typeof result.data === "object" && result.data !== null
            ? (result.data as Record<string, unknown>)
            : { value: result.data },
      });
      if (call.toolId === "characters.upsert" || call.toolId === "canvas.applyPatch") {
        this.emit("ProjectPatchApplied", {
          toolCallId: call.toolCallId,
          projectVersion:
            typeof result.data === "object" &&
            result.data !== null &&
            "projectRevision" in result.data &&
            typeof (result.data as { projectRevision: unknown }).projectRevision === "number"
              ? (result.data as { projectRevision: number }).projectRevision
              : typeof result.data === "object" &&
                  result.data !== null &&
                  "draftRevision" in result.data &&
                  typeof (result.data as { draftRevision: unknown }).draftRevision === "number"
                ? (result.data as { draftRevision: number }).draftRevision
                : 0,
        });
      }
      return;
    }
    this.emit("ToolFailed", {
      toolCallId: call.toolCallId,
      toolId: call.toolId,
      code: result.code,
      message: result.message,
      retryable: result.retryable,
    });
  }
}

export class TurnBudgetExceededError extends Error {
  constructor(budgetMs: number) {
    super(`Interactive turn exceeded wall-clock budget of ${budgetMs}ms`);
    this.name = "TurnBudgetExceededError";
  }
}
