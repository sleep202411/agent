import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { Command, isInterrupted } from "@langchain/langgraph";
import type { AgentProjectKind } from "@repo/agent-capabilities";
import type { AgentMode, PermissionMode } from "@repo/agent-policy";
import type { AgentRunStatus } from "@repo/agent-protocol";
import type { ProjectSkillResolutionSnapshot } from "@repo/agent-skills";
import type { DomainPort } from "@repo/agent-tools";

import { createAgentOsGraph, resolveAgentOsSkillMount } from "../graph/create-agent-graph.js";
import type { ApprovalInterruptValue } from "../graph/build-langchain-tools.js";
import { agentOsAbly } from "./ably-publisher.js";
import { EventJournal } from "./event-journal.js";
import { fetchJournalFromNest, reportJournalToNest } from "./journal-reporter.js";

export interface StartLangGraphRunInput {
  runId: string;
  conversationId: string;
  projectId: string;
  actorId: string;
  sessionId: string;
  /** Exact user-authored text persisted to the product transcript. */
  message: string;
  /** Optional trusted runtime context visible to the model, never the transcript. */
  modelMessage?: string;
  /** Required product model profile — never defaulted here. */
  modelProfileId: string;
  /** Trusted server-resolved product kind. */
  projectKind: AgentProjectKind;
  /** Trusted product workbench mode. */
  workbenchMode: string;
  /** Server-validated scope selected inside the workbench. */
  workbenchContext?: Readonly<Record<string, string>>;
  /** Per-turn skill ids (composer). Mounted when registered. */
  turnSkillIds?: readonly string[];
  /** Immutable project catalog mount resolved and signed by Nest. */
  skillMountSnapshot: ProjectSkillResolutionSnapshot;
  agentMode?: AgentMode;
  permissionMode?: PermissionMode;
  model: BaseChatModel;
  domain: DomainPort;
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
  projectKind?: AgentProjectKind;
  workbenchMode?: string;
  workbenchContext?: Readonly<Record<string, string>>;
  permissionMode?: PermissionMode;
  agentMode?: AgentMode;
  turnSkillIds?: readonly string[];
  skillMountSnapshot?: ProjectSkillResolutionSnapshot;
  errorMessage?: string;
}

/**
 * How a pending approval is answered. Both values RESUME the graph — a reject
 * is an answer, not an abandonment, and the tool turns it into an
 * APPROVAL_REJECTED result the model can close the turn on.
 */
type ApprovalDecision = "approve" | "reject";

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

function chunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";
  const content = (chunk as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function assistantFromMessages(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const last = messages.at(-1) as { content?: unknown };
  if (typeof last?.content === "string") return last.content;
  if (Array.isArray(last?.content)) return JSON.stringify(last.content);
  return "";
}

/**
 * Product run service on top of LangGraph createReactAgent.
 * Streams tokens as fizz.agent.v1 MessageDelta for progressive chat UI.
 */
const TERMINAL_STATUSES = new Set<AgentRunStatus>(["completed", "failed", "cancelled"]);

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  if (name === "AbortError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /abort/i.test(message);
}

/**
 * Carry product context when rewriting a snapshot. Project kind and workbench
 * mode must survive HITL pause/resume because they determine the mounted tools.
 */
function carryRunContext(
  prev: LangGraphRunSnapshot | undefined,
  input: {
    projectId?: string;
    actorId?: string;
    modelProfileId?: string;
    conversationId?: string;
    projectKind: AgentProjectKind;
    workbenchMode: string;
    workbenchContext?: Readonly<Record<string, string>>;
    agentMode?: AgentMode;
    permissionMode?: PermissionMode;
    turnSkillIds?: readonly string[];
    skillMountSnapshot?: ProjectSkillResolutionSnapshot;
  }
): Pick<
  LangGraphRunSnapshot,
  | "projectId"
  | "actorId"
  | "modelProfileId"
  | "conversationId"
  | "projectKind"
  | "workbenchMode"
  | "workbenchContext"
  | "agentMode"
  | "permissionMode"
  | "turnSkillIds"
  | "skillMountSnapshot"
> {
  return {
    projectId: input.projectId ?? prev?.projectId,
    actorId: input.actorId ?? prev?.actorId,
    modelProfileId: input.modelProfileId ?? prev?.modelProfileId,
    conversationId: input.conversationId ?? prev?.conversationId,
    projectKind: input.projectKind ?? prev?.projectKind,
    workbenchMode: input.workbenchMode ?? prev?.workbenchMode,
    workbenchContext: input.workbenchContext ?? prev?.workbenchContext,
    agentMode: input.agentMode ?? prev?.agentMode,
    permissionMode: input.permissionMode ?? prev?.permissionMode,
    turnSkillIds: input.turnSkillIds ?? prev?.turnSkillIds,
    skillMountSnapshot: input.skillMountSnapshot ?? prev?.skillMountSnapshot,
  };
}

export class LangGraphRunService {
  private readonly snapshots = new Map<string, LangGraphRunSnapshot>();
  private readonly inflight = new Map<string, Promise<void>>();
  /** Per-run abort — Stop aborts the LangGraph stream + model calls. */
  private readonly aborts = new Map<string, AbortController>();

  getSnapshot(runId: string): LangGraphRunSnapshot | undefined {
    return this.snapshots.get(runId);
  }

  /**
   * Cancel an in-flight run (user Stop). Abort signal stops stream/model work;
   * snapshot flips to cancelled so polls see a terminal status.
   */
  cancel(runId: string, reason = "Stopped by user"): LangGraphRunSnapshot | undefined {
    const existing = this.snapshots.get(runId);
    if (!existing) return undefined;

    this.aborts.get(runId)?.abort();

    if (TERMINAL_STATUSES.has(existing.status)) {
      return existing;
    }

    const sessionId = existing.conversationId
      ? `agent-os:v1:conversation:${existing.conversationId}`
      : `agent-os:v1:run:${runId}`;

    existing.journal.append({
      sessionId,
      runId,
      conversationId: existing.conversationId ?? runId,
      type: "RunCancelled",
      data: {
        status: "cancelled",
        error: {
          code: "RUN_CANCELLED",
          message: reason,
          retryable: false,
        },
      },
    });

    const cancelled: LangGraphRunSnapshot = {
      ...existing,
      status: "cancelled",
      pendingApproval: undefined,
      errorMessage: reason,
    };
    this.snapshots.set(runId, cancelled);
    void this.persist(cancelled);
    this.publishSnapshot(cancelled);
    return cancelled;
  }

  /**
   * HTTP path: return immediately with status=running; stream continues in background.
   * Clients poll GET /events (or Nest journal) for MessageDelta until terminal status.
   */
  beginStart(input: StartLangGraphRunInput): LangGraphRunSnapshot {
    if (!input.modelProfileId.trim()) {
      throw new Error("modelProfileId is required");
    }
    const journal = this.createJournal(input.conversationId);
    const messageId = `msg:${input.runId}`;
    const mountPreview = resolveAgentOsSkillMount({
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      turnSkillIds: input.turnSkillIds,
      skillMountSnapshot: input.skillMountSnapshot,
    });
    journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "RunStarted",
      data: {
        status: "running",
        workspaceType: "project_canvas",
        modelProfileId: input.modelProfileId,
        projectKind: input.projectKind,
        workbenchMode: input.workbenchMode,
        workbenchContext: input.workbenchContext,
        skillIds: mountPreview.systemSkillIds,
        projectSkillResolutionId: input.skillMountSnapshot.resolutionId,
        projectSkillVersionIds: mountPreview.projectSkillVersionIds,
        projectSkillChecksum: input.skillMountSnapshot.checksum,
        toolIds: [...mountPreview.toolIds],
        skippedSkillIds: [...mountPreview.skippedSkillIds],
      },
    });
    // Durable user turn text — required to rebuild the transcript after
    // panel close / page reload (client state is not the source of truth).
    const userText = input.message.trim();
    if (userText) {
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "UserMessage",
        data: {
          messageId: `user:${input.runId}`,
          // Cap for journal size; full text already lives in the model turn.
          text: userText.length > 20_000 ? `${userText.slice(0, 19_999)}…` : userText,
        },
      });
    }
    journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "PlanCreated",
      data: {
        steps: [
          "Understand request under mounted skills",
          "Use tools allowed by skill mount",
          "Propose writes with approval when needed",
          "Summarize results",
        ],
      },
    });
    journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "MessageStarted",
      data: { messageId },
    });

    const snapshot: LangGraphRunSnapshot = {
      runId: input.runId,
      status: "running",
      journal,
      projectId: input.projectId,
      actorId: input.actorId,
      modelProfileId: input.modelProfileId,
      conversationId: input.conversationId,
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      workbenchContext: input.workbenchContext,
      permissionMode: input.permissionMode ?? "smart",
      agentMode: input.agentMode ?? "ASSIST",
      turnSkillIds: input.turnSkillIds,
      skillMountSnapshot: input.skillMountSnapshot,
      assistantText: "",
    };
    this.snapshots.set(input.runId, snapshot);
    void this.persist(snapshot);
    this.publishSnapshot(snapshot);

    const abort = new AbortController();
    this.aborts.set(input.runId, abort);

    const work = this.runGraphTurn({
      input: {
        ...input,
        permissionMode: snapshot.permissionMode,
        agentMode: snapshot.agentMode,
      },
      journal,
      messageId,
      resume: null,
      signal: abort.signal,
    }).catch(async (error) => {
      if (this.snapshots.get(input.runId)?.status === "cancelled" || isAbortError(error)) {
        if (this.snapshots.get(input.runId)?.status !== "cancelled") {
          this.cancel(input.runId, "Stopped by user");
        }
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "RunFailed",
        data: {
          status: "failed",
          error: { code: "RUN_FAILED", message, retryable: true },
        },
      });
      const prev = this.snapshots.get(input.runId);
      const failed: LangGraphRunSnapshot = {
        runId: input.runId,
        status: "failed",
        journal,
        ...carryRunContext(prev, input),
        errorMessage: message,
      };
      this.snapshots.set(input.runId, failed);
      await this.persist(failed);
      this.publishSnapshot(failed);
    });
    this.inflight.set(input.runId, work);
    void work.finally(() => {
      this.inflight.delete(input.runId);
      this.aborts.delete(input.runId);
    });
    return snapshot;
  }

  /** Await full turn (tests / scripts). */
  async start(input: StartLangGraphRunInput): Promise<LangGraphRunSnapshot> {
    const begun = this.beginStart(input);
    await this.inflight.get(input.runId);
    return this.snapshots.get(input.runId) ?? begun;
  }

  /**
   * Rebuild a run the worker no longer holds in memory.
   *
   * The LangGraph thread checkpoint is durable, so what a conversation is
   * waiting on survives a restart — but the service's snapshot map does not,
   * and without this a deploy mid-approval strands the user on a dead card
   * ("Unknown run"). The checkpoint is the source of truth for the pending
   * interrupt; the transcript comes back from the gateway's journal so later
   * snapshots extend it instead of truncating it.
   *
   * Returns true when a resumable run is now in memory.
   */
  async rehydrateFromCheckpoint(input: {
    runId: string;
    conversationId: string;
    projectId: string;
    actorId: string;
    sessionId: string;
    modelProfileId: string;
    model: BaseChatModel;
    domain: DomainPort;
    checkpointer: BaseCheckpointSaver;
    projectKind: AgentProjectKind;
    workbenchMode: string;
    workbenchContext?: Readonly<Record<string, string>>;
    agentMode?: AgentMode;
    permissionMode?: PermissionMode;
    skillMountSnapshot?: ProjectSkillResolutionSnapshot;
  }): Promise<boolean> {
    if (this.snapshots.has(input.runId)) return true;

    const durable = await fetchJournalFromNest(input.runId);
    const skillMountSnapshot = input.skillMountSnapshot ?? durable?.skillMountSnapshot ?? undefined;
    if (!skillMountSnapshot) return false;

    const graph = createAgentOsGraph({
      model: input.model,
      checkpointer: input.checkpointer,
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      skillMountSnapshot,
      runtime: {
        runId: input.runId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        actorId: input.actorId,
        skillResolutionId: skillMountSnapshot.resolutionId,
        skillVersionIds: skillMountSnapshot.skills.map((skill) => skill.versionId),
        workbenchContext: input.workbenchContext,
        agentMode: input.agentMode ?? "ASSIST",
        permissionMode: input.permissionMode ?? "smart",
        domain: input.domain,
      },
    });

    const state = await graph.getState({
      configurable: { thread_id: input.conversationId },
    });
    const interrupts = interruptsFromState(state);
    const approval = interrupts[0];
    if (!approval) return false;

    const journal = this.createJournal(input.conversationId);
    if (durable?.events?.length) journal.restore(durable.events);

    const snapshot: LangGraphRunSnapshot = {
      runId: input.runId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      actorId: input.actorId,
      modelProfileId: input.modelProfileId,
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      workbenchContext: input.workbenchContext,
      status: "waiting_for_approval",
      journal,
      assistantText: durable?.assistantText ?? "",
      agentMode: input.agentMode ?? "ASSIST",
      permissionMode: input.permissionMode ?? "smart",
      skillMountSnapshot,
      pendingApproval: { ...approval, approvalId: crypto.randomUUID() },
    };
    this.snapshots.set(input.runId, snapshot);
    return true;
  }

  beginResumeApproval(input: {
    runId: string;
    sessionId: string;
    conversationId: string;
    decision: "approve" | "reject";
    modelProfileId: string;
    model: BaseChatModel;
    domain: DomainPort;
    checkpointer: BaseCheckpointSaver;
    projectKind?: AgentProjectKind;
    workbenchMode?: string;
    workbenchContext?: Readonly<Record<string, string>>;
    agentMode?: AgentMode;
    permissionMode?: PermissionMode;
    projectId: string;
    actorId: string;
  }): LangGraphRunSnapshot {
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

    if (
      (input.projectKind && existing.projectKind !== input.projectKind) ||
      (input.workbenchMode && existing.workbenchMode !== input.workbenchMode) ||
      (input.workbenchContext &&
        JSON.stringify(existing.workbenchContext) !== JSON.stringify(input.workbenchContext))
    ) {
      throw new Error(`Run ${input.runId} capability context does not match the approval request`);
    }
    if (!existing.projectKind || !existing.workbenchMode) {
      throw new Error(`Run ${input.runId} is missing its capability context`);
    }
    if (!existing.skillMountSnapshot) {
      throw new Error(`Run ${input.runId} is missing its frozen Skill snapshot`);
    }

    // Prefer explicit agent mode; else keep the mode from run start.
    if (input.permissionMode) existing.permissionMode = input.permissionMode;
    if (input.agentMode) existing.agentMode = input.agentMode;

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

    existing.status = "running";
    existing.pendingApproval = undefined;
    this.snapshots.set(input.runId, existing);
    void this.persist(existing);
    this.publishSnapshot(existing);

    const messageId = `msg:${input.runId}:resume`;
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "MessageStarted",
      data: { messageId },
    });

    const abort = new AbortController();
    this.aborts.set(input.runId, abort);

    const work = this.runGraphTurn({
      input: {
        runId: input.runId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        actorId: input.actorId,
        sessionId: input.sessionId,
        message: "",
        modelProfileId: input.modelProfileId,
        projectKind: existing.projectKind,
        workbenchMode: existing.workbenchMode,
        workbenchContext: existing.workbenchContext,
        model: input.model,
        domain: input.domain,
        checkpointer: input.checkpointer,
        agentMode: existing.agentMode ?? "ASSIST",
        permissionMode: existing.permissionMode ?? "smart",
        turnSkillIds: existing.turnSkillIds,
        skillMountSnapshot: existing.skillMountSnapshot,
      },
      journal: existing.journal,
      messageId,
      resume: input.decision,
      signal: abort.signal,
    }).catch(async (error) => {
      if (this.snapshots.get(input.runId)?.status === "cancelled" || isAbortError(error)) {
        if (this.snapshots.get(input.runId)?.status !== "cancelled") {
          this.cancel(input.runId, "Stopped by user");
        }
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      existing.journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "RunFailed",
        data: {
          status: "failed",
          error: { code: "RUN_FAILED", message, retryable: true },
        },
      });
      const failed: LangGraphRunSnapshot = {
        ...existing,
        status: "failed",
        errorMessage: message,
      };
      this.snapshots.set(input.runId, failed);
      await this.persist(failed);
      this.publishSnapshot(failed);
    });
    this.inflight.set(input.runId, work);
    void work.finally(() => {
      this.inflight.delete(input.runId);
      this.aborts.delete(input.runId);
    });
    return existing;
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
    projectKind?: AgentProjectKind;
    workbenchMode?: string;
    workbenchContext?: Readonly<Record<string, string>>;
    agentMode?: AgentMode;
    permissionMode?: PermissionMode;
    projectId: string;
    actorId: string;
  }): Promise<LangGraphRunSnapshot> {
    const begun = this.beginResumeApproval(input);
    await this.inflight.get(input.runId);
    return this.snapshots.get(input.runId) ?? begun;
  }

  private async runGraphTurn(args: {
    input: StartLangGraphRunInput;
    journal: EventJournal;
    messageId: string;
    resume: ApprovalDecision | null;
    signal: AbortSignal;
  }): Promise<void> {
    const { input, journal, messageId, resume, signal } = args;
    const agentMode = input.agentMode ?? "ASSIST";
    const permissionMode = input.permissionMode ?? "smart";
    let streamed = "";
    let lastPersistAt = 0;
    let deltaCount = 0;

    if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
      return;
    }

    journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "StepStarted",
      data: {
        step: "permission",
        permissionMode,
        agentMode,
        projectKind: input.projectKind,
        workbenchMode: input.workbenchMode,
        workbenchContext: input.workbenchContext,
      },
    });

    const graph = createAgentOsGraph({
      model: input.model,
      checkpointer: input.checkpointer,
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      turnSkillIds: input.turnSkillIds,
      skillMountSnapshot: input.skillMountSnapshot,
      runtime: {
        runId: input.runId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        actorId: input.actorId,
        skillResolutionId: input.skillMountSnapshot.resolutionId,
        skillVersionIds: input.skillMountSnapshot.skills.map((skill) => skill.versionId),
        workbenchContext: input.workbenchContext,
        agentMode,
        permissionMode,
        domain: input.domain,
        onToolEvent: (event) => {
          journal.append({
            sessionId: input.sessionId,
            runId: input.runId,
            conversationId: input.conversationId,
            type: event.type,
            data: {
              toolCallId: event.toolCallId,
              toolId: event.toolId,
              ...(event.data ?? {}),
            },
          });
          // Keep live pollers / Ably subscribers current during long tool turns.
          const live = this.snapshots.get(input.runId);
          if (live && live.status === "running") {
            void this.persist(live);
          }
        },
      },
    });

    const threadConfig = {
      configurable: { thread_id: input.conversationId },
      signal,
    };
    // Resuming answers the pending interrupt — including a rejection, which the
    // tool turns into an APPROVAL_REJECTED ToolMessage. Short-circuiting a
    // reject instead would leave the tool call unanswered in the durable
    // thread, and every later turn would replay that phantom to the model.
    const payload = resume
      ? new Command({ resume })
      : { messages: [new HumanMessage(input.modelMessage ?? input.message)] };

    let finalResult: unknown;
    let usedStream = false;

    try {
      const eventStream = graph.streamEvents(payload, {
        ...threadConfig,
        version: "v2",
      });
      usedStream = true;
      for await (const event of eventStream) {
        if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
          return;
        }
        if (event.event !== "on_chat_model_stream") continue;
        const piece = chunkText(event.data?.chunk);
        if (!piece) continue;
        streamed += piece;
        journal.append({
          sessionId: input.sessionId,
          runId: input.runId,
          conversationId: input.conversationId,
          type: "MessageDelta",
          data: { messageId, delta: piece },
        });
        const live = this.snapshots.get(input.runId);
        if (live && live.status !== "cancelled") {
          live.assistantText = streamed;
          live.status = "running";
          this.snapshots.set(input.runId, live);
        }
        deltaCount += 1;
        const now = Date.now();
        // Keep Nest journal reasonably fresh as fallback; live polls hit worker.
        if (deltaCount >= 4 || now - lastPersistAt > 200) {
          deltaCount = 0;
          lastPersistAt = now;
          const snap = this.snapshots.get(input.runId);
          if (snap && snap.status !== "cancelled") void this.persist(snap);
        }
      }
      if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
        return;
      }
      finalResult = await graph.getState(threadConfig).then((state) => ({
        messages: state.values?.messages,
        tasks: state.tasks,
      }));
    } catch (error) {
      if (
        signal.aborted ||
        isAbortError(error) ||
        this.snapshots.get(input.runId)?.status === "cancelled"
      ) {
        if (this.snapshots.get(input.runId)?.status !== "cancelled") {
          this.cancel(input.runId, "Stopped by user");
        }
        return;
      }
      usedStream = false;
    }

    if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
      return;
    }

    if (!usedStream) {
      finalResult = await graph.invoke(payload, threadConfig);
    }

    if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
      return;
    }

    if (!streamed.trim()) {
      const messages =
        (finalResult as { messages?: unknown })?.messages ??
        (finalResult as { values?: { messages?: unknown } })?.values?.messages;
      streamed = assistantFromMessages(messages);
    }

    let interrupts = extractInterrupts(finalResult);
    if (interrupts.length === 0) {
      interrupts = interruptsFromState(finalResult);
    }
    if (interrupts.length === 0 && isInterrupted(finalResult)) {
      // invoke-style interrupt object without extractable value — still pause
      interrupts = extractInterrupts(finalResult);
    }

    // Re-read graph state for HITL after stream (authoritative for createReactAgent)
    try {
      const state = await graph.getState(threadConfig);
      const fromState = interruptsFromState(state);
      if (fromState.length > 0) interrupts = fromState;
      if (!streamed.trim()) {
        streamed = assistantFromMessages(state.values?.messages) || streamed;
      }
      if (isInterrupted(state) && interrupts.length === 0) {
        // last resort: try __interrupt__ on state
        interrupts = extractInterrupts(state);
      }
    } catch {
      /* ignore */
    }

    if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
      return;
    }

    if (interrupts.length > 0) {
      // Resuming an approval re-runs the WHOLE tools node, so every other tool
      // call in the same assistant message executes again — the approved write
      // lands twice and the next one hits a stale revision. The model is bound
      // with parallel_tool_calls disabled to make this unreachable; if a
      // provider ignores that, fail the turn rather than double-write behind
      // the user's back.
      const pendingCallCount = toolCallCountOfLastAssistantMessage(finalResult);
      if (pendingCallCount > 1) {
        throw new Error(
          `Turn proposed ${pendingCallCount} tool calls in one message while one needs approval; ` +
            `Agent OS approves one write at a time.`
        );
      }
    }

    if (interrupts.length > 0) {
      const approval = interrupts[0]!;
      const approvalId = crypto.randomUUID();
      journal.append({
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
      journal.append({
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
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "RunPaused",
        data: {
          status: "waiting_for_approval",
          projectKind: input.projectKind,
          workbenchMode: input.workbenchMode,
          workbenchContext: input.workbenchContext,
        },
      });
      const prev = this.snapshots.get(input.runId);
      const snapshot: LangGraphRunSnapshot = {
        runId: input.runId,
        status: "waiting_for_approval",
        journal,
        pendingApproval: { ...approval, approvalId },
        ...carryRunContext(prev, input),
        assistantText: streamed,
      };
      this.snapshots.set(input.runId, snapshot);
      await this.persist(snapshot);
      this.publishSnapshot(snapshot);
      return;
    }

    if (streamed.trim()) {
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "MessageCompleted",
        data: { messageId, text: streamed },
      });
    }

    journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "RunCompleted",
      data: { status: "completed" },
    });

    const prev = this.snapshots.get(input.runId);
    const snapshot: LangGraphRunSnapshot = {
      runId: input.runId,
      status: "completed",
      journal,
      ...carryRunContext(prev, input),
      assistantText: streamed,
    };
    this.snapshots.set(input.runId, snapshot);
    await this.persist(snapshot);
    this.publishSnapshot(snapshot);
  }

  private createJournal(conversationId: string): EventJournal {
    return new EventJournal((event) => {
      agentOsAbly.publishEvent(event);
      // Status transitions also emit a compact snapshot so the UI can leave
      // "running" without waiting for the next poll.
      if (
        event.type === "RunCompleted" ||
        event.type === "RunFailed" ||
        event.type === "RunCancelled" ||
        event.type === "RunPaused" ||
        event.type === "ApprovalRequired"
      ) {
        const live = this.snapshots.get(event.runId);
        if (live) this.publishSnapshot(live);
      }
    });
  }

  private publishSnapshot(snapshot: LangGraphRunSnapshot): void {
    if (!snapshot.conversationId) return;
    agentOsAbly.publishSnapshot({
      runId: snapshot.runId,
      conversationId: snapshot.conversationId,
      status: snapshot.status,
      lastSequence: snapshot.journal.lastSequence,
      assistantText: snapshot.assistantText ?? null,
      pendingApproval: snapshot.pendingApproval ?? null,
    });
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
      projectKind: snapshot.projectKind,
      workbenchMode: snapshot.workbenchMode,
      workbenchContext: snapshot.workbenchContext,
      skillMountSnapshot: snapshot.skillMountSnapshot,
    });
  }
}

/**
 * How many tool calls the assistant asked for in the message currently awaiting
 * approval. More than one means resuming would re-execute the siblings.
 */
function toolCallCountOfLastAssistantMessage(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const messages = (result as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const calls = (messages[index] as { tool_calls?: unknown })?.tool_calls;
    if (Array.isArray(calls) && calls.length > 0) return calls.length;
  }
  return 0;
}

function interruptsFromState(state: unknown): ApprovalInterruptValue[] {
  if (!state || typeof state !== "object") return [];
  const tasks = (state as { tasks?: unknown[] }).tasks;
  if (!Array.isArray(tasks)) return [];
  const out: ApprovalInterruptValue[] = [];
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    const interrupts = (task as { interrupts?: Array<{ value?: unknown }> }).interrupts;
    if (!Array.isArray(interrupts)) continue;
    for (const item of interrupts) {
      const value = item?.value;
      if (
        value &&
        typeof value === "object" &&
        (value as ApprovalInterruptValue).kind === "tool_approval"
      ) {
        out.push(value as ApprovalInterruptValue);
      }
    }
  }
  return out;
}
