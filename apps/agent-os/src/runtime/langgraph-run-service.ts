import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { Command, isInterrupted } from "@langchain/langgraph";
import type { AgentMode, PermissionMode } from "@repo/agent-policy";
import type { AgentRunStatus } from "@repo/agent-protocol";
import type { DomainPort } from "@repo/agent-tools";

import { createAgentOsGraph } from "../graph/create-agent-graph.js";
import type { ApprovalInterruptValue } from "../graph/build-langchain-tools.js";
import { EventJournal } from "./event-journal.js";
import { reportJournalToNest } from "./journal-reporter.js";

export interface StartLangGraphRunInput {
  runId: string;
  conversationId: string;
  projectId: string;
  actorId: string;
  sessionId: string;
  message: string;
  /** Required product model profile — never defaulted here. */
  modelProfileId: string;
  mode?: AgentMode;
  permissionMode?: PermissionMode;
  model: BaseChatModel;
  domain: DomainPort;
  /** Shared checkpointer so resume works across requests / restarts. */
  checkpointer: BaseCheckpointSaver;
}

export interface LangGraphRunSnapshot {
  runId: string;
  status: AgentRunStatus;
  journal: EventJournal;
  pendingApproval?: ApprovalInterruptValue & { approvalId: string };
  assistantText?: string;
  projectId?: string;
  actorId?: string;
  modelProfileId?: string;
  conversationId?: string;
}

function extractInterrupts(result: unknown): ApprovalInterruptValue[] {
  if (!result || typeof result !== "object") return [];
  const interrupts = (result as { __interrupt__?: Array<{ value: unknown }> }).__interrupt__;
  if (!Array.isArray(interrupts)) return [];
  return interrupts
    .map((item) => item.value)
    .filter((value): value is ApprovalInterruptValue => {
      return (
        typeof value === "object" &&
        value !== null &&
        (value as ApprovalInterruptValue).kind === "tool_approval"
      );
    });
}

/**
 * Product run service on top of LangGraph createReactAgent.
 * Emits fizz.agent.v1 events for UI step timelines and reports them to Nest.
 */
export class LangGraphRunService {
  private readonly snapshots = new Map<string, LangGraphRunSnapshot>();

  getSnapshot(runId: string): LangGraphRunSnapshot | undefined {
    return this.snapshots.get(runId);
  }

  async start(input: StartLangGraphRunInput): Promise<LangGraphRunSnapshot> {
    const journal = new EventJournal();
    const mode = input.mode ?? "ASSIST";
    const permissionMode = input.permissionMode ?? "smart";

    if (!input.modelProfileId.trim()) {
      throw new Error("modelProfileId is required");
    }

    journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "RunStarted",
      data: {
        status: "running",
        workspaceType: "project_canvas",
        modelProfileId: input.modelProfileId,
      },
    });
    journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "PlanCreated",
      data: {
        steps: [
          "Understand request",
          "Use tools to read project/script",
          "Propose writes with approval when needed",
          "Summarize results",
        ],
      },
    });

    const graph = createAgentOsGraph({
      model: input.model,
      checkpointer: input.checkpointer,
      runtime: {
        runId: input.runId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        actorId: input.actorId,
        mode,
        permissionMode,
        domain: input.domain,
      },
    });

    const config = { configurable: { thread_id: input.runId } };
    const result = await graph.invoke({ messages: [new HumanMessage(input.message)] }, config);

    return this.materialize({
      runId: input.runId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      actorId: input.actorId,
      modelProfileId: input.modelProfileId,
      journal,
      result,
    });
  }

  async resumeApproval(input: {
    runId: string;
    sessionId: string;
    conversationId: string;
    decision: "approve" | "reject";
    modelProfileId: string;
    model: BaseChatModel;
    domain: DomainPort;
    checkpointer: BaseCheckpointSaver;
    mode?: AgentMode;
    permissionMode?: PermissionMode;
    projectId: string;
    actorId: string;
  }): Promise<LangGraphRunSnapshot> {
    if (!input.modelProfileId.trim()) {
      throw new Error("modelProfileId is required");
    }
    const existing = this.snapshots.get(input.runId);
    if (!existing) {
      throw new Error(`Unknown run ${input.runId}`);
    }
    if (existing.status !== "waiting_for_approval" || !existing.pendingApproval) {
      throw new Error(`Run ${input.runId} is not waiting for approval`);
    }

    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "ApprovalResolved",
      data: {
        approvalId: existing.pendingApproval.approvalId,
        decision: input.decision,
      },
    });

    if (input.decision === "reject") {
      existing.journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "RunCancelled",
        data: {
          status: "cancelled",
          error: {
            code: "APPROVAL_REJECTED",
            message: "User rejected the proposed write.",
            retryable: false,
          },
        },
      });
      const cancelled: LangGraphRunSnapshot = {
        ...existing,
        status: "cancelled",
        pendingApproval: undefined,
        projectId: input.projectId,
        actorId: input.actorId,
        modelProfileId: input.modelProfileId,
        conversationId: input.conversationId,
      };
      this.snapshots.set(input.runId, cancelled);
      await this.persist(cancelled);
      return cancelled;
    }

    const graph = createAgentOsGraph({
      model: input.model,
      checkpointer: input.checkpointer,
      runtime: {
        runId: input.runId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        actorId: input.actorId,
        mode: input.mode ?? "ASSIST",
        permissionMode: input.permissionMode ?? "smart",
        domain: input.domain,
      },
    });

    const config = { configurable: { thread_id: input.runId } };
    const result = await graph.invoke(new Command({ resume: "approve" }), config);

    return this.materialize({
      runId: input.runId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      actorId: input.actorId,
      modelProfileId: input.modelProfileId,
      journal: existing.journal,
      result,
    });
  }

  private async materialize(input: {
    runId: string;
    sessionId: string;
    conversationId: string;
    projectId: string;
    actorId: string;
    modelProfileId: string;
    journal: EventJournal;
    result: unknown;
  }): Promise<LangGraphRunSnapshot> {
    const interrupts = extractInterrupts(input.result);
    if (isInterrupted(input.result) || interrupts.length > 0) {
      const approval = interrupts[0]!;
      const approvalId = crypto.randomUUID();
      input.journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "ToolProposed",
        data: {
          toolCallId: approval.toolCallId,
          toolId: approval.toolId,
          arguments:
            typeof approval.arguments === "object" && approval.arguments !== null
              ? (approval.arguments as Record<string, unknown>)
              : { value: approval.arguments },
          risk: "sensitive",
        },
      });
      input.journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "ApprovalRequired",
        data: {
          approvalId,
          toolCallId: approval.toolCallId,
          title: approval.title,
          description: approval.description,
          reversible: false,
          actions: ["approve", "edit_and_approve", "reject"],
        },
      });
      input.journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "RunPaused",
        data: { status: "waiting_for_approval" },
      });

      const snapshot: LangGraphRunSnapshot = {
        runId: input.runId,
        status: "waiting_for_approval",
        journal: input.journal,
        pendingApproval: { ...approval, approvalId },
        projectId: input.projectId,
        actorId: input.actorId,
        modelProfileId: input.modelProfileId,
        conversationId: input.conversationId,
      };
      this.snapshots.set(input.runId, snapshot);
      await this.persist(snapshot);
      return snapshot;
    }

    const messages = (input.result as { messages?: Array<{ content?: unknown }> }).messages;
    const last = messages?.at(-1);
    const assistantText =
      typeof last?.content === "string"
        ? last.content
        : Array.isArray(last?.content)
          ? JSON.stringify(last.content)
          : undefined;

    if (assistantText) {
      const messageId = crypto.randomUUID();
      input.journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "MessageCompleted",
        data: { messageId, text: assistantText },
      });
    }

    input.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "RunCompleted",
      data: { status: "completed" },
    });

    const snapshot: LangGraphRunSnapshot = {
      runId: input.runId,
      status: "completed",
      journal: input.journal,
      assistantText,
      projectId: input.projectId,
      actorId: input.actorId,
      modelProfileId: input.modelProfileId,
      conversationId: input.conversationId,
    };
    this.snapshots.set(input.runId, snapshot);
    await this.persist(snapshot);
    return snapshot;
  }

  private async persist(snapshot: LangGraphRunSnapshot): Promise<void> {
    if (
      !snapshot.projectId ||
      !snapshot.actorId ||
      !snapshot.modelProfileId ||
      !snapshot.conversationId
    ) {
      return;
    }
    await reportJournalToNest({
      runId: snapshot.runId,
      projectId: snapshot.projectId,
      conversationId: snapshot.conversationId,
      actorId: snapshot.actorId,
      modelProfileId: snapshot.modelProfileId,
      status: snapshot.status,
      events: snapshot.journal.all(),
      pendingApproval: snapshot.pendingApproval ?? null,
      assistantText: snapshot.assistantText ?? null,
    });
  }
}
