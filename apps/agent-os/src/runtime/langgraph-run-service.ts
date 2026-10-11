import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { Command, isInterrupted } from "@langchain/langgraph";
import type { AgentProjectKind } from "@repo/agent-capabilities";
import type { AgentMode, PermissionMode } from "@repo/agent-policy";
import {
  AgentApprovalResponseTextSchema,
  AgentDisplayLocaleSchema,
  AgentRunStatusSchema,
  approvalAcknowledgementText,
  type AgentDisplayLocale,
  type AgentMessageSegmentKind,
  type AgentRunStatus,
} from "@repo/agent-protocol";
import type { ProjectSkillResolutionSnapshot } from "@repo/agent-skills";
import {
  agentExternalJobHandoffFromResult,
  type AgentExternalJobHandoff,
  type DomainPort,
} from "@repo/agent-tools";

import { createAgentOsGraph, resolveAgentOsSkillMount } from "../graph/create-agent-graph.js";
import type {
  ApprovalInterruptValue,
  UserInputInterruptValue,
} from "../graph/build-langchain-tools.js";
import { EventJournal } from "./event-journal.js";
import {
  acquireAgentOsCheckpointExecution,
  AgentOsCheckpointExecutionSupersededError,
} from "./checkpointer.js";
import {
  AgentOsJournalReportError,
  fetchJournalFromNest,
  reportJournalToNest,
  type JournalReportReceipt,
  type DurableAgentRunJournal,
  type ContinuationCommand,
  type ContinuationExecutionProof,
  type StartExecutionProof,
} from "./journal-reporter.js";
import {
  classifyTerminalExecutionFailure,
  type TerminalExecutionFailure,
} from "./execution-failure.js";

export interface StartLangGraphRunInput {
  runId: string;
  conversationId: string;
  projectId: string;
  actorId: string;
  sessionId: string;
  /** Stable browser-owned identities for an exactly replayable start. */
  clientSubmissionId?: string;
  turnId?: string;
  messageId?: string;
  attachments?: readonly { id: string; filename: string }[];
  startExecution?: Omit<StartExecutionProof, "executionOwnerId">;
  continuationExecution?: ContinuationExecutionProof;
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
  /** Current user turn. The runId remains stable across HITL resumes. */
  activeTurnId?: string;
  status: AgentRunStatus;
  journal: EventJournal;
  pendingApproval?: ApprovalInterruptValue & { approvalId: string };
  pendingUserInput?: UserInputInterruptValue & { requestId: string };
  pendingExternal?: AgentExternalJobHandoff & {
    turnId: string;
    toolCallId: string;
    toolId: string;
  };
  assistantText?: string;
  /** Open streamed segment, used to durably close cancellation/failure. */
  activeMessage?: {
    messageId: string;
    turnId: string;
    segmentKind: AgentMessageSegmentKind;
    text: string;
  };
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
  clientSubmissionId?: string;
  startMessageId?: string;
  startExecution?: StartExecutionProof;
  continuationCommand?: ContinuationCommand;
  continuationExecution?: ContinuationExecutionProof;
}

export interface ResumeDurableContinuationInput {
  command: ContinuationCommand;
  continuationExecution: Omit<ContinuationExecutionProof, "executionOwnerId">;
  sessionId: string;
  model: BaseChatModel;
  domain: DomainPort;
  checkpointer: BaseCheckpointSaver;
}

/** Common HTTP response view for a live in-memory run or a durable replay. */
export interface AgentRunSnapshotView {
  runId: string;
  status: AgentRunStatus;
  journal: EventJournal;
  pendingApproval?: unknown;
  pendingUserInput?: unknown;
  pendingExternal?: unknown;
  assistantText?: string;
}

type ToolLifecycleEvent = {
  type: "ToolStarted" | "ToolCompleted" | "ToolFailed";
  toolId: string;
  toolCallId: string;
  data?: Record<string, unknown>;
};

type StoryGenerationBatchArtifact = {
  artifactId: string;
  artifact: {
    kind: "story_generation_batch";
    generationBatchId: string;
    storyProjectId: string;
    storyChapterId: string;
    schemaVersion: "story-generation-batch-artifact/v1";
  };
};

/**
 * Project a paid Story generation confirmation into one durable transcript
 * reference. The journal deliberately stores no queue progress or media URLs:
 * those continue to belong to the generation and Asset domains after the
 * Agent run has finished.
 */
export function storyGenerationBatchArtifactFromToolEvent(
  event: ToolLifecycleEvent
): StoryGenerationBatchArtifact | null {
  if (event.type !== "ToolCompleted" || event.toolId !== "story.generation.confirmBatch") {
    return null;
  }
  const result = asUnknownRecord(event.data?.result);
  const generationBatchId = requiredResultString(result.id);
  const storyProjectId = requiredResultString(result.projectId);
  const storyChapterId = requiredResultString(result.chapterId);
  const confirmedAt = requiredResultString(result.confirmedAt);
  if (!generationBatchId || !storyProjectId || !storyChapterId || !confirmedAt) {
    return null;
  }
  return {
    artifactId: generationBatchId,
    artifact: {
      kind: "story_generation_batch",
      generationBatchId,
      storyProjectId,
      storyChapterId,
      schemaVersion: "story-generation-batch-artifact/v1",
    },
  };
}

function asUnknownRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredResultString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * How a pending approval is answered. Both values RESUME the graph — a reject
 * is an answer, not an abandonment, and the tool turns it into an
 * APPROVAL_REJECTED result the model can close the turn on.
 */
type ApprovalDecision = "approve" | "reject";
type UserInputDecision = { requestId: string; answers: Record<string, string> };
type AgentInterruptValue = ApprovalInterruptValue | UserInputInterruptValue;

interface ResumeApprovalInput {
  runId: string;
  sessionId: string;
  conversationId: string;
  approvalId: string;
  responseId: string;
  decision: ApprovalDecision;
  /** User-visible copy only; structured ids + decision remain authoritative. */
  responseText: string;
  /** Chooses server-owned durable Assistant acknowledgement copy. */
  locale: AgentDisplayLocale;
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
}

function extractInterrupts(result: unknown): AgentInterruptValue[] {
  if (!result || typeof result !== "object") return [];
  const interrupts = (result as { __interrupt__?: Array<{ value: unknown }> }).__interrupt__;
  if (!Array.isArray(interrupts)) return [];
  return interrupts
    .map((item) => item.value)
    .filter((value): value is AgentInterruptValue => {
      return (
        typeof value === "object" &&
        value !== null &&
        ((value as AgentInterruptValue).kind === "tool_approval" ||
          (value as AgentInterruptValue).kind === "user_input")
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

function assistantFromMessages(messages: unknown, afterMessageId?: string): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const boundary = afterMessageId
    ? messages.findIndex(
        (message) =>
          Boolean(message) &&
          typeof message === "object" &&
          (message as { id?: unknown }).id === afterMessageId
      )
    : -1;
  if (afterMessageId && boundary < 0) return "";
  for (let index = messages.length - 1; index > boundary; index -= 1) {
    const message = messages[index] as {
      content?: unknown;
      role?: unknown;
      type?: unknown;
      tool_call_id?: unknown;
      _getType?: () => unknown;
      constructor?: { name?: unknown };
    };
    let messageType = "";
    try {
      messageType =
        typeof message?._getType === "function"
          ? String(message._getType()).toLowerCase()
          : String(
              message?.role ?? message?.type ?? message?.constructor?.name ?? ""
            ).toLowerCase();
    } catch {
      messageType = "";
    }
    if (
      message?.tool_call_id ||
      messageType.includes("tool") ||
      messageType.includes("human") ||
      messageType === "user" ||
      messageType.includes("system")
    ) {
      continue;
    }
    if (typeof message?.content === "string") return message.content;
    if (Array.isArray(message?.content)) return JSON.stringify(message.content);
  }
  return "";
}

function stateMessages(state: unknown): unknown[] {
  if (!state || typeof state !== "object") return [];
  const values = (state as { values?: { messages?: unknown } }).values;
  if (Array.isArray(values?.messages)) return values.messages;
  const direct = (state as { messages?: unknown }).messages;
  return Array.isArray(direct) ? direct : [];
}

function stateHasMessageId(state: unknown, messageId: string): boolean {
  return stateMessages(state).some(
    (message) =>
      Boolean(message) &&
      typeof message === "object" &&
      (message as { id?: unknown }).id === messageId
  );
}

/**
 * A completed Story stage is an orchestration boundary, not necessarily a
 * pending LangGraph node. The authoritative external-result command therefore
 * owns one stable, checkpoint-only trigger message for the next canonical
 * stage decision. It is deliberately absent from the public transcript: the
 * durable external result already records the creator-visible transition.
 */
function storyContinuationTrigger(
  command: ContinuationCommand | undefined
): { id: string; content: string } | null {
  if (command?.kind !== "external_result" || !command.storyContinuation) {
    return null;
  }
  return {
    id: command.responseId,
    content: "Continue the persisted Story production plan from canonical state.",
  };
}

function stateHasToolResult(state: unknown, toolCallId: string): boolean {
  return stateMessages(state).some((message) => {
    if (!message || typeof message !== "object") return false;
    const value = message as {
      tool_call_id?: unknown;
      toolCallId?: unknown;
      additional_kwargs?: { tool_call_id?: unknown };
    };
    return (
      value.tool_call_id === toolCallId ||
      value.toolCallId === toolCallId ||
      value.additional_kwargs?.tool_call_id === toolCallId
    );
  });
}

function restoreExternalHandoff(
  events: readonly { type: string; data: Record<string, unknown> }[],
  turnId: string
):
  | (AgentExternalJobHandoff & {
      turnId: string;
      toolCallId: string;
      toolId: string;
    })
  | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type !== "ToolCompleted" || event.data.turnId !== turnId) continue;
    const handoff = agentExternalJobHandoffFromResult(event.data);
    const toolCallId = event.data.toolCallId;
    const toolId = event.data.toolId;
    if (
      handoff &&
      !externalHandoffWasResolved(events, { turnId, jobId: handoff.jobId }) &&
      typeof toolCallId === "string" &&
      typeof toolId === "string"
    ) {
      return { ...handoff, turnId, toolCallId, toolId };
    }
  }
  return undefined;
}

/**
 * External jobs can be reused across production stages, so terminal identity
 * is the durable (turnId, jobId) correlation — never jobId alone. Once this
 * correlation has resumed, replaying an old ToolCompleted event must not move
 * the run back to waiting_for_external.
 */
function externalHandoffWasResolved(
  events: readonly { type: string; data: Record<string, unknown> }[],
  handoff: { turnId: string; jobId: string }
): boolean {
  return events.some((event) => {
    if (event.type !== "RunResumed") return false;
    const reason = event.data.reason;
    return (
      event.data.turnId === handoff.turnId &&
      event.data.externalJobId === handoff.jobId &&
      typeof reason === "string" &&
      reason.startsWith("external_job_")
    );
  });
}

function restoreOpenAssistantMessage(
  events: readonly { type: string; data: Record<string, unknown> }[],
  turnId: string
): LangGraphRunSnapshot["activeMessage"] {
  const open = new Map<
    string,
    { messageId: string; turnId: string; segmentKind: AgentMessageSegmentKind; text: string }
  >();
  for (const event of events) {
    if (event.type === "MessageStarted" && event.data.turnId === turnId) {
      const messageId = event.data.messageId;
      const segmentKind = event.data.segmentKind;
      if (typeof messageId === "string" && typeof segmentKind === "string") {
        open.set(messageId, {
          messageId,
          turnId,
          segmentKind: segmentKind as AgentMessageSegmentKind,
          text: "",
        });
      }
      continue;
    }
    if (event.type === "MessageDelta" && event.data.turnId === turnId) {
      const messageId = event.data.messageId;
      const delta = event.data.delta;
      const current = typeof messageId === "string" ? open.get(messageId) : undefined;
      if (current && typeof delta === "string") current.text += delta;
      continue;
    }
    if (event.type === "MessageCompleted" && event.data.turnId === turnId) {
      const messageId = event.data.messageId;
      if (typeof messageId === "string") open.delete(messageId);
    }
  }
  if (open.size > 1) {
    throw new Error("Durable start journal contains multiple open assistant messages");
  }
  return [...open.values()][0];
}

function checkpointConfigurable(state: unknown): Record<string, unknown> | null {
  if (!state || typeof state !== "object") return null;
  const configurable = (state as { config?: { configurable?: unknown } }).config?.configurable;
  return configurable && typeof configurable === "object" && !Array.isArray(configurable)
    ? (configurable as Record<string, unknown>)
    : null;
}

function userInputAnswerText(
  request: UserInputInterruptValue,
  answers: Readonly<Record<string, string>>
): string {
  return request.questions
    .map((question) => {
      const value = answers[question.id];
      const option = question.options.find((candidate) => candidate.value === value);
      return `${question.header}: ${option?.label ?? value ?? ""}`;
    })
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

/**
 * Product run service on top of LangGraph createReactAgent.
 * Streams tokens as fizz.agent.v1 MessageDelta for progressive chat UI.
 */
const TERMINAL_STATUSES = new Set<AgentRunStatus>(["completed", "failed", "cancelled"]);

function isCheckpointedStartBoundary(status: AgentRunStatus): boolean {
  return (
    status === "waiting_for_approval" ||
    status === "waiting_for_input" ||
    status === "waiting_for_external" ||
    status === "paused" ||
    TERMINAL_STATUSES.has(status)
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  if (name === "AbortError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /abort/i.test(message);
}

function isStartExecutionFenceError(error: unknown): boolean {
  return (
    error instanceof AgentOsJournalReportError &&
    error.status === 409 &&
    /AGENT_OS_START_EXECUTION_FENCED/.test(error.message)
  );
}

function isContinuationExecutionFenceError(error: unknown): boolean {
  return (
    error instanceof AgentOsJournalReportError &&
    error.status === 409 &&
    /AGENT_OS_CONTINUATION_EXECUTION_FENCED/.test(error.message)
  );
}

class StartExecutionSupersededError extends Error {
  constructor(readonly runId: string) {
    super(`Initial execution for ${runId} was superseded by a newer fenced epoch`);
    this.name = "StartExecutionSupersededError";
  }
}

class ContinuationExecutionSupersededError extends Error {
  constructor(readonly runId: string) {
    super(`Continuation execution for ${runId} was superseded by a newer fenced epoch`);
    this.name = "ContinuationExecutionSupersededError";
  }
}

function isContinuationExecutionSupersededError(
  error: unknown
): error is ContinuationExecutionSupersededError {
  return error instanceof ContinuationExecutionSupersededError;
}

function isStartExecutionSupersededError(error: unknown): error is StartExecutionSupersededError {
  return error instanceof StartExecutionSupersededError;
}

function isCheckpointExecutionSupersededError(
  error: unknown
): error is AgentOsCheckpointExecutionSupersededError {
  return error instanceof AgentOsCheckpointExecutionSupersededError;
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
    clientSubmissionId?: string;
    startMessageId?: string;
    startExecution?: StartExecutionProof | Omit<StartExecutionProof, "executionOwnerId">;
    continuationExecution?: ContinuationExecutionProof;
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
  | "clientSubmissionId"
  | "startMessageId"
  | "startExecution"
  | "continuationCommand"
  | "continuationExecution"
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
    clientSubmissionId: input.clientSubmissionId ?? prev?.clientSubmissionId,
    startMessageId: input.startMessageId ?? prev?.startMessageId,
    startExecution: pickRicherExecutionProof(
      input.startExecution && "executionOwnerId" in input.startExecution
        ? input.startExecution
        : undefined,
      prev?.startExecution
    ),
    continuationCommand: prev?.continuationCommand,
    continuationExecution: pickRicherExecutionProof(
      input.continuationExecution,
      prev?.continuationExecution
    ),
  };
}

/**
 * Boundary snapshots are rebuilt from the run-loop INPUT, whose execution
 * proof is the original grant WITHOUT the checkpoint receipt that a later
 * capture attached to the live snapshot. The Gateway finalizes a recoverable
 * command only when the boundary report carries that receipt, so for the same
 * execution attempt the checkpoint-enriched proof must win — otherwise no
 * continuation ever finalizes and the next approval in the run is fenced.
 */
function pickRicherExecutionProof<T extends { executionAttemptId: string; checkpointId?: string }>(
  incoming: T | undefined,
  previous: T | undefined
): T | undefined {
  if (!incoming) return previous;
  if (!previous) return incoming;
  if (
    previous.executionAttemptId === incoming.executionAttemptId &&
    previous.checkpointId &&
    !incoming.checkpointId
  ) {
    return previous;
  }
  return incoming;
}

export class LangGraphRunService {
  private readonly snapshots = new Map<string, LangGraphRunSnapshot>();
  private readonly inflight = new Map<string, Promise<void>>();
  /** Per-run abort — Stop aborts the LangGraph stream + model calls. */
  private readonly aborts = new Map<string, AbortController>();
  private readonly gatewayCancellations = new Map<string, Promise<LangGraphRunSnapshot>>();
  /** Full snapshot writes must never overtake one another for the same run. */
  private readonly persistQueues = new Map<string, Promise<JournalReportReceipt>>();
  /** Lease renewal is independent of model/tool events, which may be silent. */
  private readonly startHeartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  /** One start admission per runId, including concurrent HTTP retries. */
  private readonly startAdmissions = new Map<
    string,
    {
      id: symbol;
      promise: Promise<AgentRunSnapshotView>;
      startExecution?: Omit<StartExecutionProof, "executionOwnerId">;
    }
  >();
  /** In-worker fast path; responseId is also persisted for Gateway dedupe. */
  private readonly inputResponses = new Map<
    string,
    { requestId: string; answersFingerprint: string; durable: Promise<void> }
  >();
  /** In-process concurrency guard; responseId is also durable in ApprovalResolved. */
  private readonly approvalResponses = new Map<
    string,
    {
      approvalId: string;
      decision: ApprovalDecision;
      responseText: string;
      locale: AgentDisplayLocale;
      durable: Promise<void>;
      resumeStarted: boolean;
    }
  >();
  /** One semantic answer wins for a pending approval even if callers invent different ids. */
  private readonly approvalClaims = new Map<string, string>();

  constructor(private readonly graphFactory: typeof createAgentOsGraph = createAgentOsGraph) {}

  getSnapshot(runId: string): LangGraphRunSnapshot | undefined {
    return this.snapshots.get(runId);
  }

  /**
   * Idempotent Worker-side acceptance of a Gateway-reserved start command.
   *
   * The Gateway commits `queued` before dispatch. On retry or Worker restart,
   * PostgreSQL decides whether inference has already begun; a durable event or
   * any non-queued status is replayed and must never create a second model
   * turn. The per-run promise closes the smaller in-process race where two HTTP
   * requests both arrive before the first has populated `snapshots`.
   */
  async beginDurableStart(input: StartLangGraphRunInput): Promise<AgentRunSnapshotView> {
    const existing = this.snapshots.get(input.runId);
    if (existing) {
      const attempt = this.compareStartAttempt(existing, input);
      if (attempt === "same") {
        // A response-lost retry with the same grant confirms the durable owner
        // instead of merely trusting this process's memory.
        await this.persist(existing);
        return existing;
      }
      if (attempt !== "supersede") {
        throw new Error("The Worker already holds a different fenced start attempt");
      }
      this.aborts.get(input.runId)?.abort();
      this.stopStartHeartbeat(input.runId);
      this.snapshots.delete(input.runId);
    }
    const inFlight = this.startAdmissions.get(input.runId);
    if (inFlight) {
      const relation = this.compareExecutionAttempt(inFlight.startExecution, input.startExecution);
      if (relation === "same") return inFlight.promise;
      if (relation !== "supersede") {
        throw new Error("The Worker is admitting a different fenced start attempt");
      }
    }

    const admissionId = Symbol(input.runId);
    const admission = this.admitDurableStart(input, admissionId);
    const admissionRecord = {
      id: admissionId,
      promise: admission,
      startExecution: input.startExecution,
    };
    this.startAdmissions.set(input.runId, admissionRecord);
    try {
      return await admission;
    } finally {
      if (this.startAdmissions.get(input.runId) === admissionRecord) {
        this.startAdmissions.delete(input.runId);
      }
    }
  }

  /**
   * Cheap preflight for the HTTP route, before model/checkpointer/domain
   * construction. A durable retry must remain answerable even while an AI
   * provider is temporarily unavailable; those dependencies are needed only
   * for a genuinely new queued run.
   *
   * PostgreSQL decides this, never Worker memory. A snapshot left behind by an
   * execution that died mid-turn still reads as `running`, so answering from it
   * would turn every redispatch of a still-pending start into a no-op reply and
   * strand the run on its admission prefix forever. Whenever the Gateway says a
   * start execution is pending, fall through to `beginDurableStart`, which owns
   * the same-grant/supersede decision.
   */
  async replayDurableStart(
    runId: string,
    conversationId: string
  ): Promise<AgentRunSnapshotView | null> {
    const durable = await fetchJournalFromNest(runId, { requireExisting: true });
    if (durable?.startExecutionPending) return null;
    const existing = this.snapshots.get(runId);
    if (existing) {
      if (existing.conversationId !== conversationId) {
        throw new Error(`Agent OS run ${runId} does not belong to conversation ${conversationId}`);
      }
      return existing;
    }
    if (!durable) return null;
    if (durable.events.some((event) => event.conversationId !== conversationId)) {
      throw new Error(`Agent OS run ${runId} does not belong to conversation ${conversationId}`);
    }
    const status = AgentRunStatusSchema.parse(durable.status);

    const journal = this.createJournal();
    journal.restore(durable.events);
    return {
      runId,
      status,
      journal,
      pendingApproval: durable.pendingApproval,
      pendingUserInput: durable.pendingUserInput,
      pendingExternal: durable.pendingExternal,
      assistantText: durable.assistantText ?? "",
    };
  }

  private async admitDurableStart(
    input: StartLangGraphRunInput,
    admissionId: symbol
  ): Promise<AgentRunSnapshotView> {
    const existing = this.snapshots.get(input.runId);
    if (existing) return existing;

    // When Gateway is configured this read is fail-closed: missing/malformed
    // reservations and network errors cannot be reinterpreted as permission to
    // launch inference. Explicit in-memory mode has no Nest journal and remains
    // available for unit tests and offline development.
    const durable = await fetchJournalFromNest(input.runId, { requireExisting: true });
    if (durable && !durable.startExecutionPending) {
      const journal = this.createJournal();
      journal.restore(durable.events);
      return {
        runId: input.runId,
        status: AgentRunStatusSchema.parse(durable.status),
        journal,
        pendingApproval: durable.pendingApproval,
        pendingUserInput: durable.pendingUserInput,
        pendingExternal: durable.pendingExternal,
        assistantText: durable.assistantText ?? "",
      };
    }

    if (this.startAdmissions.get(input.runId)?.id !== admissionId) {
      throw new Error("The fenced start admission was superseded by a newer epoch");
    }

    return this.beginStart(input, durable ?? undefined);
  }

  private compareExecutionAttempt(
    current: StartExecutionProof | Omit<StartExecutionProof, "executionOwnerId"> | undefined,
    incoming: Omit<StartExecutionProof, "executionOwnerId"> | undefined
  ): "same" | "supersede" | "conflict" {
    if (!incoming || !current) return "conflict";
    if (
      incoming.executionToken === current.executionToken &&
      incoming.executionAttemptId === current.executionAttemptId &&
      incoming.executionEpoch === current.executionEpoch
    ) {
      return "same";
    }
    if (
      incoming.executionToken === current.executionToken &&
      incoming.executionEpoch > current.executionEpoch
    ) {
      return "supersede";
    }
    return "conflict";
  }

  private compareStartAttempt(
    snapshot: LangGraphRunSnapshot,
    input: StartLangGraphRunInput
  ): "same" | "supersede" | "conflict" {
    return this.compareExecutionAttempt(snapshot.startExecution, input.startExecution);
  }

  private assertDurableAdmissionEvent(input: StartLangGraphRunInput, journal: EventJournal): void {
    const first = journal.all()[0];
    const data = first?.data;
    if (
      first?.sequence !== 1 ||
      first.type !== "UserMessage" ||
      first.runId !== input.runId ||
      first.conversationId !== input.conversationId ||
      data?.turnId !== input.turnId ||
      data?.messageId !== input.messageId ||
      data?.text !== input.message ||
      JSON.stringify(data?.attachments ?? []) !== JSON.stringify(input.attachments ?? [])
    ) {
      throw new Error("Gateway durable UserMessage#1 diverges from the fenced start request");
    }
  }

  private assertDurableExecutionPrefix(input: StartLangGraphRunInput, journal: EventJournal): void {
    const runStarted = journal.all()[1];
    const executionMarker = journal.all()[2];
    // Immutable journals created before the permission-step marker used the
    // synthetic PlanCreated event in this slot. Keep those runs recoverable,
    // while every new start records the real execution step below.
    const executionStarted = Boolean(
      executionMarker &&
      executionMarker.data.turnId === input.turnId &&
      (executionMarker.type === "PlanCreated" ||
        (executionMarker.type === "StepStarted" && executionMarker.data.step === "permission"))
    );
    if (
      runStarted?.type !== "RunStarted" ||
      runStarted.data.turnId !== input.turnId ||
      !executionStarted
    ) {
      throw new Error(
        "Recoverable start journal must begin UserMessage#1, RunStarted#2, and an execution marker for the admitted turn"
      );
    }
  }

  private startStartHeartbeat(snapshot: LangGraphRunSnapshot): ReturnType<typeof setInterval> {
    this.stopStartHeartbeat(snapshot.runId);
    const timer = setInterval(() => {
      const current = this.snapshots.get(snapshot.runId);
      if (current !== snapshot || (!current.startExecution && !current.continuationExecution)) {
        this.stopStartHeartbeat(snapshot.runId, timer);
        return;
      }
      void this.persist(current).catch((error) => {
        if (isStartExecutionFenceError(error) || isContinuationExecutionFenceError(error)) {
          if (this.snapshots.get(snapshot.runId) === snapshot) {
            this.aborts.get(snapshot.runId)?.abort();
          }
          this.stopStartHeartbeat(snapshot.runId, timer);
          return;
        }
        process.stderr.write(
          `${JSON.stringify({
            level: "warn",
            msg: "agent-os.start_execution.heartbeat_failed",
            runId: snapshot.runId,
            error: error instanceof Error ? error.message : String(error),
          })}\n`
        );
      });
    }, 20_000);
    timer.unref();
    this.startHeartbeatTimers.set(snapshot.runId, timer);
    return timer;
  }

  private stopStartHeartbeat(runId: string, expectedTimer?: ReturnType<typeof setInterval>): void {
    const timer = this.startHeartbeatTimers.get(runId);
    if (expectedTimer && timer !== expectedTimer) return;
    if (timer) clearInterval(timer);
    this.startHeartbeatTimers.delete(runId);
  }

  /**
   * Cancel an in-flight run (user Stop). Abort signal stops stream/model work;
   * snapshot flips to cancelled so polls see a terminal status.
   */
  async cancel(
    runId: string,
    reason = "Stopped by user"
  ): Promise<LangGraphRunSnapshot | undefined> {
    // In production Nest commits cancellation before notifying this Worker.
    // Adopting that journal is the only valid response; generating another
    // random-id RunCancelled at the same sequence corrupts the shared prefix.
    if (process.env.AGENT_OS_DOMAIN_URL?.trim()) {
      return this.adoptGatewayCancellation(runId);
    }
    const existing = this.snapshots.get(runId);
    if (!existing) return undefined;

    this.aborts.get(runId)?.abort();

    if (TERMINAL_STATUSES.has(existing.status)) {
      if (existing.status === "cancelled") await this.persist(existing);
      return existing;
    }

    const sessionId = existing.conversationId
      ? `agent-os:v1:conversation:${existing.conversationId}`
      : `agent-os:v1:run:${runId}`;
    const turnId = existing.activeTurnId ?? crypto.randomUUID();

    if (existing.activeMessage) {
      existing.journal.append({
        sessionId,
        runId,
        conversationId: existing.conversationId ?? runId,
        type: "MessageCompleted",
        data: {
          turnId: existing.activeMessage.turnId,
          messageId: existing.activeMessage.messageId,
          text: existing.activeMessage.text,
          finishReason: "cancelled",
        },
      });
    }

    existing.journal.append({
      sessionId,
      runId,
      conversationId: existing.conversationId ?? runId,
      type: "RunCancelled",
      data: {
        turnId,
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
      pendingUserInput: undefined,
      pendingExternal: undefined,
      activeMessage: undefined,
      errorMessage: reason,
    };
    this.snapshots.set(runId, cancelled);
    await this.persist(cancelled);
    return cancelled;
  }

  private async adoptGatewayCancellation(runId: string): Promise<LangGraphRunSnapshot> {
    const pending = this.gatewayCancellations.get(runId);
    if (pending) return pending;
    // Install the promise before aborting: the graph's abort handler calls
    // cancel too and must await the same authoritative read, never append.
    const work = Promise.resolve().then(async () => {
      const durable = await fetchJournalFromNest(runId, { requireExisting: true });
      if (!durable) throw new Error("Gateway cancellation requires durable journal configuration");
      const status = AgentRunStatusSchema.parse(durable.status);
      if (!TERMINAL_STATUSES.has(status)) {
        throw new Error(`Gateway has not committed a terminal state for Agent OS run ${runId}`);
      }
      const existing = this.snapshots.get(runId);
      if (
        !durable.events.length ||
        durable.events.some(
          (event, index) =>
            event.sequence !== index + 1 ||
            event.runId !== runId ||
            (existing?.conversationId && event.conversationId !== existing.conversationId)
        )
      ) {
        throw new Error(
          `Gateway cancellation returned the wrong journal for Agent OS run ${runId}`
        );
      }
      const tail = durable.events.at(-1)!;
      const terminalType = {
        cancelled: "RunCancelled",
        completed: "RunCompleted",
        failed: "RunFailed",
      };
      if (
        tail.type !== terminalType[status as keyof typeof terminalType] ||
        tail.data.status !== status
      ) {
        throw new Error(
          `Gateway cancellation returned an incomplete terminal journal for Agent OS run ${runId}`
        );
      }
      const journal = this.createJournal();
      journal.restore(durable.events);
      const terminal: LangGraphRunSnapshot = {
        ...existing,
        runId,
        status,
        journal,
        activeTurnId: typeof tail.data.turnId === "string" ? tail.data.turnId : undefined,
        conversationId: existing?.conversationId ?? durable.events[0]!.conversationId,
        assistantText: durable.assistantText ?? "",
        pendingApproval: undefined,
        pendingUserInput: undefined,
        pendingExternal: undefined,
        activeMessage: undefined,
        startExecution: undefined,
        continuationExecution: undefined,
        continuationCommand: undefined,
        errorMessage:
          status === "completed"
            ? undefined
            : typeof asUnknownRecord(tail.data.error).message === "string"
              ? String(asUnknownRecord(tail.data.error).message)
              : undefined,
      };
      this.snapshots.set(runId, terminal);
      return terminal;
    });
    this.gatewayCancellations.set(runId, work);
    this.aborts.get(runId)?.abort();
    this.stopStartHeartbeat(runId);
    try {
      return await work;
    } finally {
      if (this.gatewayCancellations.get(runId) === work) this.gatewayCancellations.delete(runId);
    }
  }

  /**
   * HTTP path: return immediately with status=running; stream continues in background.
   * Clients poll GET /events (or Nest journal) for MessageDelta until terminal status.
   */
  async beginStart(
    input: StartLangGraphRunInput,
    durableStart?: DurableAgentRunJournal
  ): Promise<LangGraphRunSnapshot> {
    if (!input.modelProfileId.trim()) {
      throw new Error("modelProfileId is required");
    }
    const journal = this.createJournal();
    const fencedStart = Boolean(input.startExecution);
    if (
      fencedStart &&
      (!input.clientSubmissionId || !input.turnId || !input.messageId || !durableStart)
    ) {
      throw new Error(
        "A fenced start requires stable submission, turn, message, and durable admission identities"
      );
    }
    const turnId = input.turnId ?? crypto.randomUUID();
    const mountPreview = resolveAgentOsSkillMount({
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      workbenchContext: input.workbenchContext,
      turnSkillIds: input.turnSkillIds,
      skillMountSnapshot: input.skillMountSnapshot,
    });
    if (fencedStart) {
      journal.restore(durableStart!.events);
      this.assertDurableAdmissionEvent(input, journal);
    }
    if (!fencedStart || journal.lastSequence === 1) {
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "RunStarted",
        data: {
          turnId,
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
      // Legacy/offline callers have no Gateway admission row. Production
      // fenced starts already restored the exact UserMessage#1 and must never
      // manufacture a duplicate user bubble.
      if (!fencedStart) {
        const userText = input.message.trim();
        if (input.message.length > 20_000) {
          throw new Error("User message exceeded the 20,000 character protocol limit");
        }
        if (userText || input.attachments?.length) {
          journal.append({
            sessionId: input.sessionId,
            runId: input.runId,
            conversationId: input.conversationId,
            type: "UserMessage",
            data: {
              turnId,
              messageId: input.messageId ?? crypto.randomUUID(),
              text: input.message,
              ...(input.attachments?.length ? { attachments: input.attachments } : {}),
            },
          });
        }
      }
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "StepStarted",
        data: {
          turnId,
          step: "permission",
          permissionMode: input.permissionMode ?? "smart",
          agentMode: input.agentMode ?? "ASSIST",
          projectKind: input.projectKind,
          workbenchMode: input.workbenchMode,
          workbenchContext: input.workbenchContext,
        },
      });
    } else if (fencedStart) {
      this.assertDurableExecutionPrefix(input, journal);
    }
    const startExecution: StartExecutionProof | undefined = input.startExecution
      ? {
          ...input.startExecution,
          executionOwnerId: crypto.randomUUID(),
          ...(durableStart?.startExecutionCheckpointId &&
          durableStart.startExecutionCheckpointNamespace !== null &&
          durableStart.startExecutionCheckpointThreadId === input.conversationId &&
          durableStart.startExecutionCheckpointMessageId === input.messageId
            ? {
                checkpointId: durableStart.startExecutionCheckpointId,
                checkpointNamespace: durableStart.startExecutionCheckpointNamespace,
                checkpointThreadId: durableStart.startExecutionCheckpointThreadId,
                checkpointMessageId: durableStart.startExecutionCheckpointMessageId,
              }
            : {}),
        }
      : undefined;
    const checkpointLease = startExecution
      ? await acquireAgentOsCheckpointExecution(input.checkpointer, {
          kind: "start",
          runId: input.runId,
          conversationId: input.conversationId,
          executionToken: startExecution.executionToken,
          executionAttemptId: startExecution.executionAttemptId,
          executionEpoch: startExecution.executionEpoch,
          executionOwnerId: startExecution.executionOwnerId,
        })
      : undefined;
    if (startExecution && !checkpointLease) {
      throw new StartExecutionSupersededError(input.runId);
    }
    const executionInput = checkpointLease
      ? { ...input, checkpointer: checkpointLease.checkpointer }
      : input;
    const restoredOpenMessage = fencedStart
      ? restoreOpenAssistantMessage(journal.all(), turnId)
      : undefined;
    const snapshot: LangGraphRunSnapshot = {
      runId: input.runId,
      activeTurnId: turnId,
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
      assistantText: restoredOpenMessage?.text ?? durableStart?.assistantText ?? "",
      activeMessage: restoredOpenMessage,
      clientSubmissionId: input.clientSubmissionId,
      startMessageId: input.messageId,
      startExecution,
    };
    this.snapshots.set(input.runId, snapshot);
    // Do not start inference until the durable user turn exists. Otherwise a
    // fast model/tool can outpace the journal and leave an un-replayable run.
    let admissionReceipt: JournalReportReceipt;
    try {
      admissionReceipt = await this.persist(snapshot);
    } catch (error) {
      if (this.snapshots.get(input.runId) === snapshot) {
        this.snapshots.delete(input.runId);
      }
      await checkpointLease?.release();
      throw error;
    }
    if (startExecution && !admissionReceipt.startExecutionDisposition) {
      if (this.snapshots.get(input.runId) === snapshot) {
        this.snapshots.delete(input.runId);
      }
      await checkpointLease?.release();
      throw new Error("Gateway did not grant or acknowledge the fenced start execution");
    }
    const abort = new AbortController();
    this.aborts.set(input.runId, abort);
    const heartbeatTimer = startExecution ? this.startStartHeartbeat(snapshot) : undefined;

    const work = this.runGraphTurn({
      input: {
        ...executionInput,
        permissionMode: snapshot.permissionMode,
        agentMode: snapshot.agentMode,
      },
      journal,
      turnId,
      resume: null,
      signal: abort.signal,
      expectedStartExecutionOwnerId: startExecution?.executionOwnerId,
    }).catch(async (error) => {
      if (
        isStartExecutionFenceError(error) ||
        isStartExecutionSupersededError(error) ||
        isCheckpointExecutionSupersededError(error)
      ) {
        abort.abort();
        return;
      }
      if (
        startExecution &&
        this.snapshots.get(input.runId)?.startExecution?.executionOwnerId !==
          startExecution.executionOwnerId
      ) {
        // An older work promise can reject after the next epoch has installed
        // its snapshot. It must never cancel or terminalize the new owner.
        return;
      }
      if (this.snapshots.get(input.runId)?.status === "cancelled" || isAbortError(error)) {
        if (this.snapshots.get(input.runId)?.status !== "cancelled") {
          await this.cancel(input.runId, "Stopped by user");
        }
        return;
      }
      if (
        await this.failIfTerminalExecutionError({
          runId: input.runId,
          conversationId: input.conversationId,
          sessionId: input.sessionId,
          turnId,
          journal,
          error,
        })
      ) {
        return;
      }
      const liveBeforeFailure = this.snapshots.get(input.runId);
      if (liveBeforeFailure?.startExecution) {
        // A caught Worker/runtime failure is not a checkpointed graph outcome.
        // Even when an earlier input/model checkpoint exists, it may predate a
        // ToolMessage (notably an external-job handoff) or the latest model
        // output. Publishing RunFailed with that stale proof would clear the
        // admission command and make the missing graph suffix unrecoverable.
        // Retain the command, stop heartbeating in finally, and let a later
        // fenced epoch inspect the authoritative conversation checkpoint.
        //
        // Deferring is silent to the creator by design, so it must never be
        // silent to the operator: a failure that repeats every epoch (a missing
        // grant, an unreachable dependency) otherwise presents as a run frozen
        // on its admission prefix with no error anywhere.
        process.stderr.write(
          `${JSON.stringify({
            level: "warn",
            msg: "agent-os.start.execution_deferred",
            runId: input.runId,
            conversationId: input.conversationId,
            turnId,
            executionEpoch: liveBeforeFailure.startExecution.executionEpoch,
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          })}\n`
        );
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.completeOpenMessage(input.runId, "failed");
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "RunFailed",
        data: {
          turnId,
          status: "failed",
          error: { code: "RUN_FAILED", message, retryable: true },
        },
      });
      const prev = this.snapshots.get(input.runId);
      const failed: LangGraphRunSnapshot = {
        runId: input.runId,
        activeTurnId: turnId,
        status: "failed",
        journal,
        ...carryRunContext(prev, input),
        errorMessage: message,
      };
      this.snapshots.set(input.runId, failed);
      await this.persistUntilAccepted(failed, "run_failed");
    });
    this.inflight.set(input.runId, work);
    this.observeExecutionWork({
      work,
      runId: input.runId,
      kind: "start",
      cleanup: async () => {
        if (this.inflight.get(input.runId) === work) {
          this.inflight.delete(input.runId);
        }
        if (this.aborts.get(input.runId) === abort) {
          this.aborts.delete(input.runId);
        }
        if (heartbeatTimer) {
          this.stopStartHeartbeat(input.runId, heartbeatTimer);
        }
        await checkpointLease?.release();
      },
    });
    return snapshot;
  }

  /** Await full turn (tests / scripts). */
  async start(input: StartLangGraphRunInput): Promise<LangGraphRunSnapshot> {
    const begun = await this.beginStart(input);
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

    // A configured Gateway is the transcript authority. A network/read error
    // must not be reinterpreted as an empty journal and then overwritten by a
    // reconstructed Worker snapshot. In explicit local/in-memory mode the
    // reporter has no Gateway configuration and still returns null here.
    const durable = await fetchJournalFromNest(input.runId, { requireExisting: true });
    const skillMountSnapshot = input.skillMountSnapshot ?? durable?.skillMountSnapshot ?? undefined;
    if (!skillMountSnapshot) return false;
    const restoredTurnId =
      latestDurableTurnId(durable?.events) ??
      durableInteractionId(durable?.pendingApproval, "turnId") ??
      durableInteractionId(durable?.pendingUserInput, "turnId") ??
      crypto.randomUUID();

    const graph = this.graphFactory({
      model: input.model,
      checkpointer: input.checkpointer,
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      skillMountSnapshot,
      runtime: {
        runId: input.runId,
        turnId: restoredTurnId,
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
      configurable: { thread_id: input.conversationId, checkpoint_ns: "" },
    });
    const interrupts = interruptsFromState(state);
    const pending = interrupts[0];
    if (!pending) return false;

    const journal = this.createJournal();
    if (durable?.events?.length) journal.restore(durable.events);

    const snapshot: LangGraphRunSnapshot = {
      runId: input.runId,
      activeTurnId: durableInteractionId(pending, "turnId") ?? restoredTurnId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      actorId: input.actorId,
      modelProfileId: input.modelProfileId,
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      workbenchContext: input.workbenchContext,
      status: pending.kind === "tool_approval" ? "waiting_for_approval" : "waiting_for_input",
      journal,
      assistantText: durable?.assistantText ?? "",
      agentMode: input.agentMode ?? "ASSIST",
      permissionMode: input.permissionMode ?? "smart",
      skillMountSnapshot,
      ...(pending.kind === "tool_approval"
        ? {
            pendingApproval: {
              ...pending,
              approvalId:
                durableInteractionId(pending, "approvalId") ??
                durableInteractionId(durable?.pendingApproval, "approvalId") ??
                crypto.randomUUID(),
              turnId: durableInteractionId(pending, "turnId") ?? restoredTurnId,
            },
          }
        : {
            pendingUserInput: {
              ...pending,
              requestId:
                durableInteractionId(pending, "requestId") ??
                durableInteractionId(durable?.pendingUserInput, "requestId") ??
                crypto.randomUUID(),
              turnId: durableInteractionId(pending, "turnId") ?? restoredTurnId,
              leadIn:
                durableString(pending, "leadIn") ||
                durableString(durable?.pendingUserInput, "leadIn") ||
                "I need your answer before I can continue.",
              resumeAcknowledgement:
                durableString(pending, "resumeAcknowledgement") ||
                durableString(durable?.pendingUserInput, "resumeAcknowledgement") ||
                "Thanks — I have your answer and will continue.",
            },
          }),
    };
    this.snapshots.set(input.runId, snapshot);
    return true;
  }

  async beginResumeApproval(input: ResumeApprovalInput): Promise<LangGraphRunSnapshot> {
    const responseText = AgentApprovalResponseTextSchema.parse(input.responseText);
    const locale = AgentDisplayLocaleSchema.parse(input.locale);
    const responseKey = `${input.runId}:${input.responseId}`;
    const priorResponse = this.approvalResponses.get(responseKey);
    if (priorResponse) {
      if (
        priorResponse.approvalId !== input.approvalId ||
        priorResponse.decision !== input.decision ||
        priorResponse.responseText !== responseText ||
        priorResponse.locale !== locale
      ) {
        throw new Error(`Response ${input.responseId} was already used for a different approval`);
      }
      try {
        await priorResponse.durable;
      } catch {
        const currentEntry = this.approvalResponses.get(responseKey);
        if (currentEntry === priorResponse) {
          const retrySnapshot = this.snapshots.get(input.runId);
          if (!retrySnapshot) throw new Error(`Unknown run ${input.runId}`);
          const retryEntry = {
            ...priorResponse,
            durable: this.persist(retrySnapshot).then(() => undefined),
          };
          this.approvalResponses.set(responseKey, retryEntry);
          await retryEntry.durable;
        } else if (currentEntry) {
          await currentEntry.durable;
        } else {
          throw new Error(`Response ${input.responseId} lost its durable retry state`);
        }
      }
      const current = this.snapshots.get(input.runId);
      if (!current) throw new Error(`Unknown run ${input.runId}`);
      return current;
    }
    if (!input.modelProfileId.trim()) {
      throw new Error("modelProfileId is required");
    }
    const existing = this.snapshots.get(input.runId);
    if (!existing) {
      throw new Error(`Unknown run ${input.runId}`);
    }
    if (existing.conversationId !== input.conversationId) {
      throw new Error(`Run ${input.runId} does not belong to conversation ${input.conversationId}`);
    }
    const approvalKey = `${input.runId}:${input.approvalId}`;
    const claimedResponseId = this.approvalClaims.get(approvalKey);
    if (claimedResponseId && claimedResponseId !== input.responseId) {
      throw new Error(`Approval ${input.approvalId} was already answered by another response`);
    }
    if (existing.status !== "waiting_for_approval" || !existing.pendingApproval) {
      throw new Error(`Run ${input.runId} is not waiting for approval`);
    }
    if (existing.pendingApproval.approvalId !== input.approvalId) {
      throw new Error(`Approval ${input.approvalId} is no longer pending`);
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

    const approvalId = input.approvalId;
    const turnId = crypto.randomUUID();
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "UserMessage",
      data: {
        turnId,
        messageId: crypto.randomUUID(),
        text: responseText,
        interaction: {
          kind: "approval",
          approvalId,
          responseId: input.responseId,
          decision: input.decision,
          locale,
        },
      },
    });
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "ApprovalResolved",
      data: { turnId, approvalId, responseId: input.responseId, decision: input.decision },
    });
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "RunResumed",
      data: { turnId, reason: "approval_resolved", approvalId },
    });

    const acknowledgement = approvalAcknowledgementText(locale, input.decision);
    const acknowledgementMessageId = crypto.randomUUID();
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "MessageStarted",
      data: {
        turnId,
        messageId: acknowledgementMessageId,
        segmentKind: "acknowledgement",
      },
    });
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "MessageDelta",
      data: { turnId, messageId: acknowledgementMessageId, delta: acknowledgement },
    });
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "MessageCompleted",
      data: {
        turnId,
        messageId: acknowledgementMessageId,
        text: acknowledgement,
        finishReason: "stop",
      },
    });

    existing.status = "running";
    existing.activeTurnId = turnId;
    existing.assistantText = acknowledgement;
    existing.pendingApproval = undefined;
    existing.continuationCommand = {
      kind: "approval",
      runId: input.runId,
      turnId,
      responseId: input.responseId,
      approvalId,
      decision: input.decision,
      projectId: input.projectId,
      conversationId: input.conversationId,
      actorId: input.actorId,
      modelProfileId: input.modelProfileId,
      projectKind: existing.projectKind,
      workbenchMode: existing.workbenchMode,
      workbenchContext: existing.workbenchContext,
      permissionMode: existing.permissionMode ?? "smart",
      skillMountSnapshot: existing.skillMountSnapshot,
    };
    this.snapshots.set(input.runId, existing);
    this.approvalClaims.set(approvalKey, input.responseId);
    const responseEntry = {
      approvalId,
      decision: input.decision,
      responseText,
      locale,
      durable: this.persist(existing).then(() => undefined),
      resumeStarted: false,
    };
    this.approvalResponses.set(responseKey, responseEntry);
    // The decision, visible user message, and truthful acknowledgement must be
    // durable before LangGraph can execute the approved command.
    await responseEntry.durable;
    return existing;
  }

  async beginDurableContinuation(
    input: ResumeDurableContinuationInput
  ): Promise<LangGraphRunSnapshot> {
    const { command } = input;
    const durable = await fetchJournalFromNest(command.runId, {
      requireExisting: true,
    });
    if (!durable?.continuationExecutionPending) {
      throw new Error(`Run ${command.runId} has no durable continuation awaiting execution`);
    }
    const resolutionMatches =
      command.kind === "external_result"
        ? durable.events.some(
            (event) =>
              event.type === "RunResumed" &&
              event.data.turnId === command.turnId &&
              event.data.reason === "external_job_completed" &&
              event.data.externalJobId === command.externalJobId
          ) &&
          durable.events.some(
            (event) =>
              event.type === "MessageCompleted" &&
              event.data.turnId === command.turnId &&
              event.data.messageId === command.resultMessageId &&
              event.data.finishReason === "external_result"
          )
        : durable.events.some((event) => {
            if (event.data.turnId !== command.turnId) return false;
            if (command.kind === "approval") {
              return (
                event.type === "ApprovalResolved" &&
                event.data.responseId === command.responseId &&
                event.data.approvalId === command.approvalId &&
                event.data.decision === command.decision
              );
            }
            return (
              event.type === "UserInputResolved" &&
              event.data.responseId === command.responseId &&
              event.data.requestId === command.requestId &&
              stableAnswerFingerprint(
                (event.data.answers as Record<string, string> | undefined) ?? {}
              ) === stableAnswerFingerprint(command.answers)
            );
          });
    if (!resolutionMatches) {
      throw new Error(
        `Continuation ${command.responseId} diverges from the durable response journal`
      );
    }

    const previous = this.snapshots.get(command.runId);
    if (previous?.continuationExecution) {
      const current = previous.continuationExecution;
      const incoming = input.continuationExecution;
      if (
        current.executionToken !== incoming.executionToken ||
        incoming.executionEpoch < current.executionEpoch
      ) {
        throw new ContinuationExecutionSupersededError(command.runId);
      }
      if (incoming.executionEpoch > current.executionEpoch) {
        this.aborts.get(command.runId)?.abort();
      } else if (
        current.executionAttemptId === incoming.executionAttemptId &&
        this.inflight.has(command.runId)
      ) {
        return previous;
      }
    }

    const journal = this.createJournal();
    journal.restore(durable.events);
    const continuationExecution: ContinuationExecutionProof = {
      ...input.continuationExecution,
      executionOwnerId: crypto.randomUUID(),
    };
    const checkpointLease = await acquireAgentOsCheckpointExecution(input.checkpointer, {
      kind: "continuation",
      runId: command.runId,
      conversationId: command.conversationId,
      executionToken: continuationExecution.executionToken,
      executionAttemptId: continuationExecution.executionAttemptId,
      executionEpoch: continuationExecution.executionEpoch,
      executionOwnerId: continuationExecution.executionOwnerId,
    });
    if (!checkpointLease) {
      throw new ContinuationExecutionSupersededError(command.runId);
    }
    const snapshot: LangGraphRunSnapshot = {
      runId: command.runId,
      activeTurnId: command.turnId,
      status: "running",
      journal,
      projectId: command.projectId,
      actorId: command.actorId,
      modelProfileId: command.modelProfileId,
      conversationId: command.conversationId,
      projectKind: command.projectKind,
      workbenchMode: command.workbenchMode,
      workbenchContext: command.workbenchContext,
      permissionMode: command.permissionMode,
      agentMode: "ASSIST",
      skillMountSnapshot: command.skillMountSnapshot,
      assistantText: durable.assistantText ?? "",
      continuationCommand: command,
      continuationExecution,
    };
    this.snapshots.set(command.runId, snapshot);
    let receipt: JournalReportReceipt;
    try {
      receipt = await this.persist(snapshot);
    } catch (error) {
      if (this.snapshots.get(command.runId) === snapshot) {
        this.snapshots.delete(command.runId);
      }
      await checkpointLease.release();
      throw error;
    }
    if (!receipt.continuationExecutionDisposition) {
      if (this.snapshots.get(command.runId) === snapshot) {
        this.snapshots.delete(command.runId);
      }
      await checkpointLease.release();
      throw new Error("Gateway did not grant or acknowledge the continuation execution");
    }
    const abort = new AbortController();
    this.aborts.set(command.runId, abort);
    const heartbeatTimer = this.startStartHeartbeat(snapshot);
    const resume: ApprovalDecision | UserInputDecision | null =
      command.kind === "approval"
        ? command.decision
        : command.kind === "user_input"
          ? { requestId: command.requestId, answers: command.answers }
          : null;
    const work = this.runGraphTurn({
      input: {
        runId: command.runId,
        conversationId: command.conversationId,
        projectId: command.projectId,
        actorId: command.actorId,
        sessionId: input.sessionId,
        message: "",
        modelProfileId: command.modelProfileId,
        projectKind: command.projectKind,
        workbenchMode: command.workbenchMode,
        workbenchContext: command.workbenchContext,
        permissionMode: command.permissionMode,
        skillMountSnapshot: command.skillMountSnapshot,
        continuationExecution,
        model: input.model,
        domain: input.domain,
        checkpointer: checkpointLease.checkpointer,
      },
      journal,
      turnId: command.turnId,
      resume,
      signal: abort.signal,
      expectedContinuationExecutionOwnerId: continuationExecution.executionOwnerId,
      continuationCommand: command,
      externalResultContinuation: command.kind === "external_result",
    }).catch(async (error) => {
      if (
        isContinuationExecutionFenceError(error) ||
        isContinuationExecutionSupersededError(error) ||
        isCheckpointExecutionSupersededError(error) ||
        isAbortError(error)
      ) {
        return;
      }
      if (
        await this.failIfTerminalExecutionError({
          runId: command.runId,
          conversationId: command.conversationId,
          sessionId: input.sessionId,
          turnId: command.turnId,
          journal,
          error,
        })
      ) {
        return;
      }
      // Runtime/network ambiguity is not a terminal graph outcome. Retain the
      // durable command and let a later fenced epoch inspect the checkpoint.
      process.stderr.write(
        `${JSON.stringify({
          level: "warn",
          msg: "agent-os.continuation.execution_deferred",
          runId: command.runId,
          error: error instanceof Error ? error.message : String(error),
        })}\n`
      );
    });
    this.inflight.set(command.runId, work);
    this.observeExecutionWork({
      work,
      runId: command.runId,
      kind: "continuation",
      cleanup: async () => {
        if (this.inflight.get(command.runId) === work) {
          this.inflight.delete(command.runId);
        }
        if (this.aborts.get(command.runId) === abort) {
          this.aborts.delete(command.runId);
        }
        this.stopStartHeartbeat(command.runId, heartbeatTimer);
        await checkpointLease.release();
      },
    });
    return snapshot;
  }

  /**
   * A detached graph must always have an explicit terminal observer.
   * `promise.finally(cleanup)` is insufficient: it creates another rejecting
   * promise, so an unlock/cleanup error can still reach Node's fatal
   * unhandled-rejection policy even when the graph error itself was handled.
   *
   * Callers that intentionally await `work` retain its original result. This
   * observer owns only background reporting and cleanup for the HTTP execution.
   */
  private observeExecutionWork(input: {
    work: Promise<void>;
    runId: string;
    kind: "start" | "continuation";
    cleanup(): Promise<void>;
  }): void {
    const settle = async (workError?: unknown): Promise<void> => {
      if (workError !== undefined) {
        this.reportBackgroundExecutionError(input, "execution", workError);
      }
      try {
        await input.cleanup();
      } catch (cleanupError) {
        this.reportBackgroundExecutionError(input, "cleanup", cleanupError);
      }
    };
    void input.work
      .then(
        () => settle(),
        (error) => settle(error)
      )
      .catch((observerError) => {
        this.reportBackgroundExecutionError(input, "observer", observerError);
      });
  }

  private reportBackgroundExecutionError(
    input: { runId: string; kind: "start" | "continuation" },
    phase: "execution" | "cleanup" | "observer",
    error: unknown
  ): void {
    try {
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          msg: "agent-os.background_execution_failed",
          runId: input.runId,
          executionKind: input.kind,
          phase,
          error: error instanceof Error ? error.message : String(error),
        })}\n`
      );
    } catch {
      // Logging must not recreate the unhandled-rejection failure this
      // terminal observer exists to contain.
    }
  }

  async beginResumeUserInput(input: {
    runId: string;
    sessionId: string;
    conversationId: string;
    requestId: string;
    responseId: string;
    answers: Record<string, string>;
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
    const responseKey = `${input.runId}:${input.responseId}`;
    const answersFingerprint = stableAnswerFingerprint(input.answers);
    const priorResponse = this.inputResponses.get(responseKey);
    if (priorResponse) {
      if (
        priorResponse.requestId !== input.requestId ||
        priorResponse.answersFingerprint !== answersFingerprint
      ) {
        throw new Error(`Response ${input.responseId} was already used with different answers`);
      }
      // A concurrent retry must not observe the in-memory acknowledgement
      // before the first request's PostgreSQL write has been accepted. If the
      // first transport attempt failed, exactly one retry replaces its rejected
      // promise while every sibling awaits that same durable write.
      try {
        await priorResponse.durable;
      } catch {
        const currentEntry = this.inputResponses.get(responseKey);
        if (currentEntry === priorResponse) {
          const retrySnapshot = this.snapshots.get(input.runId);
          if (!retrySnapshot) throw new Error(`Unknown run ${input.runId}`);
          const retryEntry = {
            ...priorResponse,
            durable: this.persist(retrySnapshot).then(() => undefined),
          };
          this.inputResponses.set(responseKey, retryEntry);
          await retryEntry.durable;
        } else if (currentEntry) {
          await currentEntry.durable;
        } else {
          throw new Error(`Response ${input.responseId} lost its durable retry state`);
        }
      }
      const current = this.snapshots.get(input.runId);
      if (!current) throw new Error(`Unknown run ${input.runId}`);
      return current;
    }
    if (!input.modelProfileId.trim()) throw new Error("modelProfileId is required");
    const existing = this.snapshots.get(input.runId);
    if (!existing) throw new Error(`Unknown run ${input.runId}`);
    if (existing.conversationId !== input.conversationId) {
      throw new Error(`Run ${input.runId} does not belong to conversation ${input.conversationId}`);
    }
    if (existing.status !== "waiting_for_input" || !existing.pendingUserInput) {
      throw new Error(`Run ${input.runId} is not waiting for user input`);
    }
    if (existing.pendingUserInput.requestId !== input.requestId) {
      throw new Error(`User input request ${input.requestId} is no longer pending`);
    }
    if (
      (input.projectKind && existing.projectKind !== input.projectKind) ||
      (input.workbenchMode && existing.workbenchMode !== input.workbenchMode) ||
      (input.workbenchContext &&
        JSON.stringify(existing.workbenchContext) !== JSON.stringify(input.workbenchContext))
    ) {
      throw new Error(`Run ${input.runId} capability context does not match the input request`);
    }
    if (!existing.projectKind || !existing.workbenchMode) {
      throw new Error(`Run ${input.runId} is missing its capability context`);
    }
    if (!existing.skillMountSnapshot) {
      throw new Error(`Run ${input.runId} is missing its frozen Skill snapshot`);
    }

    const answers = validateUserInputAnswers(existing.pendingUserInput, input.answers);
    if (input.permissionMode) existing.permissionMode = input.permissionMode;
    if (input.agentMode) existing.agentMode = input.agentMode;

    const pendingInput = existing.pendingUserInput;
    const turnId = crypto.randomUUID();
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "UserMessage",
      data: {
        turnId,
        messageId: crypto.randomUUID(),
        text: userInputAnswerText(pendingInput, answers),
        interaction: {
          kind: "user_input",
          requestId: input.requestId,
          responseId: input.responseId,
          answers,
        },
      },
    });
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "UserInputResolved",
      data: {
        turnId,
        requestId: input.requestId,
        responseId: input.responseId,
        answers,
      },
    });
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "RunResumed",
      data: { turnId, reason: "user_input_resolved", requestId: input.requestId },
    });

    const acknowledgement = pendingInput.resumeAcknowledgement;
    const acknowledgementMessageId = crypto.randomUUID();
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "MessageStarted",
      data: {
        turnId,
        messageId: acknowledgementMessageId,
        segmentKind: "acknowledgement",
      },
    });
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "MessageDelta",
      data: {
        turnId,
        messageId: acknowledgementMessageId,
        delta: acknowledgement,
      },
    });
    existing.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "MessageCompleted",
      data: {
        turnId,
        messageId: acknowledgementMessageId,
        text: acknowledgement,
        finishReason: "stop",
      },
    });

    existing.status = "running";
    existing.activeTurnId = turnId;
    existing.assistantText = acknowledgement;
    existing.pendingUserInput = undefined;
    existing.continuationCommand = {
      kind: "user_input",
      runId: input.runId,
      turnId,
      responseId: input.responseId,
      requestId: input.requestId,
      answers,
      projectId: input.projectId,
      conversationId: input.conversationId,
      actorId: input.actorId,
      modelProfileId: input.modelProfileId,
      projectKind: existing.projectKind,
      workbenchMode: existing.workbenchMode,
      workbenchContext: existing.workbenchContext,
      permissionMode: existing.permissionMode ?? "smart",
      skillMountSnapshot: existing.skillMountSnapshot,
    };
    this.snapshots.set(input.runId, existing);
    const durable = this.persist(existing).then(() => undefined);
    this.inputResponses.set(responseKey, {
      requestId: input.requestId,
      answersFingerprint,
      durable,
    });
    // Persist the resolved answer before the graph resumes. Domain tools such
    // as story.confirmCreativeProfile validate against this durable journal;
    // starting inference first creates a race where a legitimate answer looks
    // unresolved to the server.
    await durable;
    return existing;
  }

  private async runGraphTurn(args: {
    input: StartLangGraphRunInput;
    journal: EventJournal;
    turnId: string;
    resume: ApprovalDecision | UserInputDecision | null;
    signal: AbortSignal;
    expectedStartExecutionOwnerId?: string;
    expectedContinuationExecutionOwnerId?: string;
    continuationCommand?: ContinuationCommand;
    externalResultContinuation?: boolean;
  }): Promise<void> {
    const {
      input,
      journal,
      turnId,
      resume,
      signal,
      expectedStartExecutionOwnerId,
      expectedContinuationExecutionOwnerId,
      continuationCommand,
      externalResultContinuation = false,
    } = args;
    const assertCurrentExecution = (): void => {
      if (
        expectedStartExecutionOwnerId &&
        this.snapshots.get(input.runId)?.startExecution?.executionOwnerId !==
          expectedStartExecutionOwnerId
      ) {
        throw new StartExecutionSupersededError(input.runId);
      }
      if (
        expectedContinuationExecutionOwnerId &&
        this.snapshots.get(input.runId)?.continuationExecution?.executionOwnerId !==
          expectedContinuationExecutionOwnerId
      ) {
        throw new ContinuationExecutionSupersededError(input.runId);
      }
    };
    const isCurrentExecution = (): boolean => {
      const current = this.snapshots.get(input.runId);
      if (
        expectedStartExecutionOwnerId &&
        current?.startExecution?.executionOwnerId !== expectedStartExecutionOwnerId
      ) {
        return false;
      }
      if (
        expectedContinuationExecutionOwnerId &&
        current?.continuationExecution?.executionOwnerId !== expectedContinuationExecutionOwnerId
      ) {
        return false;
      }
      return true;
    };
    assertCurrentExecution();
    const agentMode = input.agentMode ?? "ASSIST";
    const permissionMode = input.permissionMode ?? "smart";
    const durableOpenMessage = this.snapshots.get(input.runId)?.activeMessage;
    let streamed = durableOpenMessage?.text ?? "";
    let activeMessage:
      | { messageId: string; text: string; segmentKind: AgentMessageSegmentKind }
      | undefined = durableOpenMessage
      ? {
          messageId: durableOpenMessage.messageId,
          text: durableOpenMessage.text,
          segmentKind: durableOpenMessage.segmentKind,
        }
      : undefined;
    let lastCompletedText = activeMessage
      ? ""
      : (this.snapshots.get(input.runId)?.assistantText ?? "");
    let lastPersistAt = 0;
    let deltaCount = 0;
    let externalHandoff = restoreExternalHandoff(journal.all(), turnId);

    const ensureMessage = (segmentKind: AgentMessageSegmentKind = "response") => {
      assertCurrentExecution();
      if (activeMessage) return activeMessage;
      activeMessage = { messageId: crypto.randomUUID(), text: "", segmentKind };
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "MessageStarted",
        data: { turnId, messageId: activeMessage.messageId, segmentKind },
      });
      const live = this.snapshots.get(input.runId);
      if (live && live.status !== "cancelled") {
        live.activeMessage = { turnId, ...activeMessage };
      }
      return activeMessage;
    };

    const appendMessageText = (text: string, segmentKind: AgentMessageSegmentKind = "response") => {
      assertCurrentExecution();
      if (!text) return;
      const message = ensureMessage(segmentKind);
      const remaining = 200_000 - message.text.length;
      if (text.length > remaining) {
        throw new Error("Assistant message exceeded the 200,000 character protocol limit");
      }
      message.text += text;
      streamed += text;
      for (let offset = 0; offset < text.length; offset += 16_384) {
        journal.append({
          sessionId: input.sessionId,
          runId: input.runId,
          conversationId: input.conversationId,
          type: "MessageDelta",
          data: {
            turnId,
            messageId: message.messageId,
            delta: text.slice(offset, offset + 16_384),
          },
        });
      }
      const live = this.snapshots.get(input.runId);
      if (live && live.status !== "cancelled") {
        live.assistantText = message.text;
        live.activeMessage = { turnId, ...message };
        live.status = "running";
        this.snapshots.set(input.runId, live);
      }
    };

    const completeMessage = (
      finishReason: "stop" | "tool_call" | "external_result" | "cancelled" | "failed" | "superseded"
    ) => {
      assertCurrentExecution();
      if (!activeMessage) return;
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "MessageCompleted",
        data: {
          turnId,
          messageId: activeMessage.messageId,
          text: activeMessage.text,
          finishReason,
        },
      });
      lastCompletedText = activeMessage.text;
      const live = this.snapshots.get(input.runId);
      if (live) {
        live.assistantText = activeMessage.text;
        live.activeMessage = undefined;
      }
      activeMessage = undefined;
    };

    const reconcileAssistantFromCheckpoint = (messages: unknown): void => {
      const restored = assistantFromMessages(messages, input.messageId);
      if (!restored) return;
      if (activeMessage) {
        if (!restored.startsWith(activeMessage.text)) {
          throw new Error(
            "Durable assistant delta prefix diverges from the completed graph checkpoint"
          );
        }
        appendMessageText(restored.slice(activeMessage.text.length));
        return;
      }
      if (restored === lastCompletedText) return;
      if (!streamed.trim()) appendMessageText(restored);
    };

    const reconcileOpenMessageAtRecovery = (messages: unknown): void => {
      if (!activeMessage || !input.messageId) return;
      const checkpointAssistant = assistantFromMessages(messages, input.messageId);
      if (checkpointAssistant.length > 0 && checkpointAssistant.startsWith(activeMessage.text)) {
        appendMessageText(checkpointAssistant.slice(activeMessage.text.length));
        return;
      }
      // Gateway can durably receive deltas before LangGraph commits the
      // corresponding AIMessage. A newer epoch must not concatenate a retried
      // provider output onto that orphaned attempt. Close it as superseded and
      // let this same turn create a fresh segment from checkpointed state.
      completeMessage("superseded");
      streamed = "";
    };

    if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
      return;
    }
    assertCurrentExecution();

    if (
      !journal
        .all()
        .some(
          (event) =>
            event.type === "StepStarted" &&
            event.data.turnId === turnId &&
            event.data.step === "permission"
        )
    ) {
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "StepStarted",
        data: {
          turnId,
          step: "permission",
          permissionMode,
          agentMode,
          projectKind: input.projectKind,
          workbenchMode: input.workbenchMode,
          workbenchContext: input.workbenchContext,
        },
      });
    }

    const threadConfig = {
      configurable: { thread_id: input.conversationId, checkpoint_ns: "" },
      signal,
      // Pregel's default async durability leaves put()/putWrites() promises
      // detached until a later loop-finalizer. If Stop or epoch takeover
      // releases the execution guard first, a fenced rejection can reach
      // Node's unhandled-rejection policy before LangGraph observes it. A
      // production turn therefore crosses a persistence barrier at every
      // superstep; the typed superseded error then terminates only this old
      // execution through the normal stream/catch path.
      durability: "sync" as const,
    };
    const graph = this.graphFactory({
      model: input.model,
      checkpointer: input.checkpointer,
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      turnSkillIds: input.turnSkillIds,
      skillMountSnapshot: input.skillMountSnapshot,
      runtime: {
        runId: input.runId,
        turnId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        actorId: input.actorId,
        skillResolutionId: input.skillMountSnapshot.resolutionId,
        skillVersionIds: input.skillMountSnapshot.skills.map((skill) => skill.versionId),
        workbenchContext: input.workbenchContext,
        agentMode,
        permissionMode,
        domain: input.domain,
        startExecution: this.snapshots.get(input.runId)?.startExecution,
        continuationExecution: this.snapshots.get(input.runId)?.continuationExecution,
        ...(continuationCommand?.kind === "external_result" && continuationCommand.storyContinuation
          ? {
              storyContinuation: {
                responseId: continuationCommand.responseId,
                ...continuationCommand.storyContinuation,
              },
            }
          : {}),
        abortSignal: signal,
        onToolEvent: async (event) => {
          assertCurrentExecution();
          const batchArtifact = storyGenerationBatchArtifactFromToolEvent(event);
          const artifactAlreadyRecorded = batchArtifact
            ? journal
                .all()
                .some(
                  (existing) =>
                    existing.type === "ArtifactCreated" &&
                    existing.data.artifactId === batchArtifact.artifactId
                )
            : false;
          if (batchArtifact && !artifactAlreadyRecorded) {
            // Record the live domain reference before ToolCompleted. If the
            // worker dies between the two writes, the creator still sees a
            // truthful, recoverable batch instead of losing paid work.
            journal.append({
              sessionId: input.sessionId,
              runId: input.runId,
              conversationId: input.conversationId,
              type: "ArtifactCreated",
              data: {
                turnId,
                artifactId: batchArtifact.artifactId,
                artifact: batchArtifact.artifact,
                status: "active",
              },
            });
          }
          const duplicateLifecycleEvent = journal
            .all()
            .some(
              (existing) =>
                existing.type === event.type &&
                existing.data.turnId === turnId &&
                existing.data.toolCallId === event.toolCallId &&
                existing.data.toolId === event.toolId
            );
          if (!duplicateLifecycleEvent) {
            journal.append({
              sessionId: input.sessionId,
              runId: input.runId,
              conversationId: input.conversationId,
              type: event.type,
              data: {
                turnId,
                toolCallId: event.toolCallId,
                toolId: event.toolId,
                ...(event.data ?? {}),
              },
            });
          }
          if (event.type === "ToolCompleted" && !externalHandoff) {
            const handoff = agentExternalJobHandoffFromResult(event.data);
            if (
              handoff &&
              !externalHandoffWasResolved(journal.all(), {
                turnId,
                jobId: handoff.jobId,
              })
            ) {
              externalHandoff = {
                ...handoff,
                turnId,
                toolCallId: event.toolCallId,
                toolId: event.toolId,
              };
              completeMessage("tool_call");
              if (
                normalizeMessageText(lastCompletedText) !==
                normalizeMessageText(handoff.startedMessage)
              ) {
                appendMessageText(handoff.startedMessage, "acknowledgement");
                completeMessage("stop");
              }
            }
          }
          // Keep the Gateway journal current during long tool turns.
          const live = this.snapshots.get(input.runId);
          if (live && live.status === "running") {
            await this.persist(live);
          }
        },
      },
    });

    const finishExternalHandoffIfCheckpointed = async (
      suppliedState?: unknown
    ): Promise<boolean> => {
      assertCurrentExecution();
      if (!externalHandoff) return false;
      const handoff = externalHandoff;
      if (externalHandoffWasResolved(journal.all(), handoff)) {
        externalHandoff = undefined;
        return false;
      }
      const state = suppliedState ?? (await graph.getState(threadConfig));
      assertCurrentExecution();
      // ToolCompleted is emitted inside the tool wrapper before LangGraph has
      // committed the matching ToolMessage. A start command may be released
      // only after the exact tool result is visible in the checkpoint.
      if (!stateHasToolResult(state, handoff.toolCallId)) return false;
      const current = this.snapshots.get(input.runId);
      if (current?.startExecution || current?.continuationExecution) {
        const captured = await this.captureLatestStartCheckpoint(
          graph,
          threadConfig,
          input.runId,
          state,
          expectedStartExecutionOwnerId,
          expectedContinuationExecutionOwnerId
        );
        if (!captured) return false;
      }
      assertCurrentExecution();
      // Journal reporting and checkpoint capture are asynchronous. Recheck the
      // terminal correlation immediately before projecting a new pause so a
      // concurrent durable resume can never be overwritten by stale work.
      if (externalHandoffWasResolved(journal.all(), handoff)) {
        externalHandoff = undefined;
        return false;
      }
      if (
        !journal
          .all()
          .some(
            (event) =>
              event.type === "RunPaused" &&
              event.data.turnId === turnId &&
              event.data.status === "waiting_for_external" &&
              event.data.externalJobId === handoff.jobId
          )
      ) {
        journal.append({
          sessionId: input.sessionId,
          runId: input.runId,
          conversationId: input.conversationId,
          type: "RunPaused",
          data: {
            turnId,
            status: "waiting_for_external",
            externalJobId: handoff.jobId,
            toolCallId: handoff.toolCallId,
            toolId: handoff.toolId,
          },
        });
      }
      const prev = this.snapshots.get(input.runId);
      const waiting: LangGraphRunSnapshot = {
        runId: input.runId,
        activeTurnId: turnId,
        status: "waiting_for_external",
        journal,
        pendingExternal: handoff,
        ...carryRunContext(prev, input),
        assistantText: handoff.startedMessage,
        activeMessage: undefined,
      };
      this.snapshots.set(input.runId, waiting);
      await this.persistUntilAccepted(waiting, "external_handoff_checkpointed");
      return true;
    };

    // Resuming answers the pending interrupt — including a rejection, which the
    // tool turns into an APPROVAL_REJECTED ToolMessage. Short-circuiting a
    // reject instead would leave the tool call unanswered in the durable
    // thread, and every later turn would replay that phantom to the model.
    let finalResult: unknown;

    const before = await graph.getState(threadConfig);
    assertCurrentExecution();
    const stableMessageAlreadyCheckpointed =
      !resume && Boolean(input.messageId) && stateHasMessageId(before, input.messageId!);
    if (stableMessageAlreadyCheckpointed) {
      await this.captureLatestStartCheckpoint(
        graph,
        threadConfig,
        input.runId,
        before,
        expectedStartExecutionOwnerId,
        expectedContinuationExecutionOwnerId
      );
    }
    // Restore a checkpointed suffix onto the same durable segment before a
    // pending-node resume. If no matching current-turn AIMessage exists, the
    // deltas came from an attempt that died before checkpoint commit.
    reconcileOpenMessageAtRecovery(
      (before as { values?: { messages?: unknown } }).values?.messages
    );
    if (await finishExternalHandoffIfCheckpointed(before)) return;
    const checkpointHasPendingTasks = Array.isArray(before.tasks) && before.tasks.length > 0;
    const continuationTrigger = storyContinuationTrigger(continuationCommand);
    const continuationTriggerAlreadyCheckpointed = Boolean(
      continuationTrigger && stateHasMessageId(before, continuationTrigger.id)
    );
    // A Story stage proposal can finish its React graph before the creator
    // reviews it. Applying that proposal must start a new deterministic
    // read/decide/author cycle; stream(null) only resumes an unfinished cycle.
    const startsNewStoryStageCycle = Boolean(
      externalResultContinuation &&
      continuationTrigger &&
      !checkpointHasPendingTasks &&
      !continuationTriggerAlreadyCheckpointed
    );
    const checkpointInterrupts = interruptsFromState(before);
    const checkpointStillAwaitingResume = resume
      ? checkpointInterrupts.some((pending) =>
          continuationCommand?.kind === "approval"
            ? pending.kind === "tool_approval" &&
              pending.approvalId === continuationCommand.approvalId
            : continuationCommand?.kind === "user_input"
              ? pending.kind === "user_input" && pending.requestId === continuationCommand.requestId
              : typeof resume === "string"
                ? pending.kind === "tool_approval"
                : pending.kind === "user_input" && pending.requestId === resume.requestId
        )
      : false;
    // A previous owner may have committed the Command(resume) checkpoint and
    // crashed before it projected the next pause. A different interrupt here
    // is therefore an *outcome* to project, never a place to submit the old
    // answer again. Reconcile the authoritative checkpoint below and close
    // this durable continuation command at the new pause boundary.
    const continuationAdvancedToNewInterrupt = Boolean(
      resume &&
      continuationCommand &&
      checkpointInterrupts.length > 0 &&
      !checkpointStillAwaitingResume
    );
    const payload = resume
      ? checkpointStillAwaitingResume
        ? new Command({ resume })
        : null
      : startsNewStoryStageCycle
        ? {
            messages: [
              new HumanMessage({
                id: continuationTrigger!.id,
                content: continuationTrigger!.content,
                additional_kwargs: {
                  turnId,
                  internalContinuation: "story_stage",
                },
              }),
            ],
          }
        : externalResultContinuation || stableMessageAlreadyCheckpointed
          ? null
          : {
              messages: [
                input.messageId
                  ? new HumanMessage({
                      id: input.messageId,
                      content: input.modelMessage ?? input.message,
                      additional_kwargs: {
                        clientSubmissionId: input.clientSubmissionId,
                        turnId,
                      },
                    })
                  : new HumanMessage(input.modelMessage ?? input.message),
              ],
            };

    // A crash may happen after LangGraph completed its durable checkpoint but
    // before the Gateway journal received MessageCompleted/RunCompleted. In
    // that state `stream(null)` is not a resume; close the journal from the
    // checkpoint's final assistant state instead of submitting HumanMessage
    // again or treating EmptyInput as a failed turn.
    if (
      (stableMessageAlreadyCheckpointed ||
        (externalResultContinuation &&
          (!continuationTrigger || continuationTriggerAlreadyCheckpointed)) ||
        (resume && (!checkpointStillAwaitingResume || continuationAdvancedToNewInterrupt))) &&
      !checkpointHasPendingTasks
    ) {
      finalResult = before;
    }
    if (continuationAdvancedToNewInterrupt) {
      finalResult = before;
    }

    try {
      if (finalResult === undefined) {
        const eventStream = await graph.streamEvents(payload, {
          ...threadConfig,
          version: "v2",
        });
        for await (const event of eventStream) {
          if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
            return;
          }
          assertCurrentExecution();
          if (await finishExternalHandoffIfCheckpointed()) return;
          if (event.event === "on_chat_model_start") {
            await this.captureLatestStartCheckpoint(
              graph,
              threadConfig,
              input.runId,
              undefined,
              expectedStartExecutionOwnerId,
              expectedContinuationExecutionOwnerId
            );
            // A retried model call supersedes its interrupted visible fragment.
            completeMessage("superseded");
            continue;
          }
          if (event.event === "on_chat_model_stream") {
            const piece = chunkText(event.data?.chunk);
            if (!piece) continue;
            appendMessageText(piece);
            deltaCount += 1;
            const now = Date.now();
            // Persist a bounded stream snapshot; writes are serialized per run.
            if (deltaCount >= 4 || now - lastPersistAt > 200) {
              deltaCount = 0;
              lastPersistAt = now;
              const snap = this.snapshots.get(input.runId);
              if (snap && snap.status !== "cancelled") await this.persist(snap);
            }
            continue;
          }
          if (event.event === "on_chat_model_end") {
            const completeText = chunkText(event.data?.output);
            if (completeText && (!activeMessage || completeText.startsWith(activeMessage.text))) {
              appendMessageText(completeText.slice(activeMessage?.text.length ?? 0));
            }
            completeMessage(modelOutputHasToolCalls(event.data?.output) ? "tool_call" : "stop");
            await this.captureLatestStartCheckpoint(
              graph,
              threadConfig,
              input.runId,
              undefined,
              expectedStartExecutionOwnerId,
              expectedContinuationExecutionOwnerId
            );
          }
        }
      }
      if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
        return;
      }
      assertCurrentExecution();
      const after = await graph.getState(threadConfig);
      assertCurrentExecution();
      if (await finishExternalHandoffIfCheckpointed(after)) return;
      finalResult = {
        messages: after.values?.messages,
        tasks: after.tasks,
        config: after.config,
      };
      await this.captureLatestStartCheckpoint(
        graph,
        threadConfig,
        input.runId,
        after,
        expectedStartExecutionOwnerId,
        expectedContinuationExecutionOwnerId
      );
    } catch (error) {
      if (
        isStartExecutionFenceError(error) ||
        isStartExecutionSupersededError(error) ||
        isContinuationExecutionFenceError(error) ||
        isContinuationExecutionSupersededError(error) ||
        isCheckpointExecutionSupersededError(error)
      ) {
        throw error;
      }
      if (!isCurrentExecution()) return;
      if (
        signal.aborted ||
        isAbortError(error) ||
        this.snapshots.get(input.runId)?.status === "cancelled"
      ) {
        if (this.snapshots.get(input.runId)?.status !== "cancelled") {
          await this.cancel(input.runId, "Stopped by user");
        }
        return;
      }
      // Never replay the original HumanMessage through graph.invoke after a
      // streaming/checkpoint/report failure. The graph may already have
      // committed model or tool work; the next fenced epoch must inspect and
      // resume that checkpoint explicitly.
      throw error;
    }

    if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
      return;
    }
    assertCurrentExecution();

    if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
      return;
    }

    const finalMessages =
      (finalResult as { messages?: unknown })?.messages ??
      (finalResult as { values?: { messages?: unknown } })?.values?.messages;
    reconcileAssistantFromCheckpoint(finalMessages);

    let interrupts = extractInterrupts(finalResult);
    if (interrupts.length === 0) {
      interrupts = interruptsFromState(finalResult);
    }
    if (interrupts.length === 0 && isInterrupted(finalResult)) {
      // invoke-style interrupt object without extractable value — still pause
      interrupts = extractInterrupts(finalResult);
    }

    // Re-read graph state for HITL after stream (authoritative for
    // createReactAgent). Checkpoint/report failures are not optional: ignoring
    // them would let a pause clear the recoverable command without durable
    // state.
    const state = await graph.getState(threadConfig);
    assertCurrentExecution();
    await this.captureLatestStartCheckpoint(
      graph,
      threadConfig,
      input.runId,
      state,
      expectedStartExecutionOwnerId,
      expectedContinuationExecutionOwnerId
    );
    const fromState = interruptsFromState(state);
    if (fromState.length > 0) interrupts = fromState;
    reconcileAssistantFromCheckpoint(state.values?.messages);
    if (isInterrupted(state) && interrupts.length === 0) {
      // last resort: try __interrupt__ on state
      interrupts = extractInterrupts(state);
    }

    if (signal.aborted || this.snapshots.get(input.runId)?.status === "cancelled") {
      return;
    }

    if (interrupts.length > 0) {
      // Resuming an interrupt re-runs the WHOLE tools node, so every other tool
      // call in the same assistant message executes again — the approved write
      // lands twice and the next one hits a stale revision. The model is bound
      // with parallel_tool_calls disabled to make this unreachable; if a
      // provider ignores that, fail the turn rather than double-write behind
      // the user's back.
      const pendingCallCount = toolCallCountOfLastAssistantMessage(finalResult);
      if (pendingCallCount > 1) {
        throw new Error(
          `Turn proposed ${pendingCallCount} tool calls in one message while one needs user action; ` +
            `Agent OS resolves one interaction at a time; propose one write at a time.`
        );
      }
    }

    if (interrupts.length > 0) {
      const pending = interrupts[0]!;
      const interactionId =
        pending.kind === "tool_approval"
          ? (durableInteractionId(pending, "approvalId") ?? crypto.randomUUID())
          : (durableInteractionId(pending, "requestId") ?? crypto.randomUUID());
      completeMessage("tool_call");
      if (
        pending.kind === "user_input" &&
        normalizeMessageText(lastCompletedText) !== normalizeMessageText(pending.leadIn)
      ) {
        appendMessageText(pending.leadIn, "lead_in");
        completeMessage("tool_call");
      }
      if (pending.kind === "tool_approval") {
        journal.append({
          sessionId: input.sessionId,
          runId: input.runId,
          conversationId: input.conversationId,
          type: "ToolProposed",
          data: {
            turnId,
            toolCallId: pending.toolCallId,
            toolId: pending.toolId,
            arguments:
              typeof pending.arguments === "object" && pending.arguments !== null
                ? (pending.arguments as Record<string, unknown>)
                : { value: pending.arguments },
            risk: "sensitive",
          },
        });
        journal.append({
          sessionId: input.sessionId,
          runId: input.runId,
          conversationId: input.conversationId,
          type: "ApprovalRequired",
          data: {
            turnId,
            approvalId: interactionId,
            toolCallId: pending.toolCallId,
            title: pending.title,
            description: pending.description,
            reversible: false,
            actions: ["approve", "reject"],
          },
        });
      } else {
        journal.append({
          sessionId: input.sessionId,
          runId: input.runId,
          conversationId: input.conversationId,
          type: "UserInputRequired",
          data: {
            turnId,
            requestId: interactionId,
            toolCallId: pending.toolCallId,
            ...(pending.formId ? { formId: pending.formId } : {}),
            ...(pending.knownValues ? { knownValues: pending.knownValues } : {}),
            resumeAcknowledgement: pending.resumeAcknowledgement,
            questions: pending.questions,
          },
        });
      }
      const waitingStatus =
        pending.kind === "tool_approval" ? "waiting_for_approval" : "waiting_for_input";
      journal.append({
        sessionId: input.sessionId,
        runId: input.runId,
        conversationId: input.conversationId,
        type: "RunPaused",
        data: {
          turnId,
          status: waitingStatus,
          projectKind: input.projectKind,
          workbenchMode: input.workbenchMode,
          workbenchContext: input.workbenchContext,
        },
      });
      const prev = this.snapshots.get(input.runId);
      const snapshot: LangGraphRunSnapshot = {
        runId: input.runId,
        activeTurnId: turnId,
        status: waitingStatus,
        journal,
        ...(pending.kind === "tool_approval"
          ? {
              pendingApproval: {
                ...pending,
                turnId,
                approvalId: interactionId,
              },
            }
          : {
              pendingUserInput: {
                ...pending,
                turnId,
                requestId: interactionId,
              },
            }),
        ...carryRunContext(prev, input),
        assistantText: lastCompletedText || streamed,
        activeMessage: undefined,
      };
      this.snapshots.set(input.runId, snapshot);
      await this.persistUntilAccepted(snapshot, "human_interaction_pause");
      return;
    }

    completeMessage("stop");

    journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "RunCompleted",
      data: { turnId, status: "completed" },
    });

    const prev = this.snapshots.get(input.runId);
    const snapshot: LangGraphRunSnapshot = {
      runId: input.runId,
      activeTurnId: turnId,
      status: "completed",
      journal,
      ...carryRunContext(prev, input),
      assistantText: lastCompletedText || streamed,
      activeMessage: undefined,
    };
    this.snapshots.set(input.runId, snapshot);
    await this.persistUntilAccepted(snapshot, "run_completed");
  }

  private async captureLatestStartCheckpoint(
    graph: {
      getState(config: unknown): Promise<unknown>;
    },
    threadConfig: unknown,
    runId: string,
    suppliedState?: unknown,
    expectedStartExecutionOwnerId?: string,
    expectedContinuationExecutionOwnerId?: string
  ): Promise<boolean> {
    let snapshot = this.snapshots.get(runId);
    if (
      expectedStartExecutionOwnerId &&
      snapshot?.startExecution?.executionOwnerId !== expectedStartExecutionOwnerId
    ) {
      throw new StartExecutionSupersededError(runId);
    }
    if (
      expectedContinuationExecutionOwnerId &&
      snapshot?.continuationExecution?.executionOwnerId !== expectedContinuationExecutionOwnerId
    ) {
      throw new ContinuationExecutionSupersededError(runId);
    }
    if (
      (!snapshot?.startExecution || !snapshot.startMessageId) &&
      !snapshot?.continuationExecution
    ) {
      return false;
    }
    if (!snapshot?.conversationId) return false;
    const state = suppliedState ?? (await graph.getState(threadConfig));
    snapshot = this.snapshots.get(runId);
    if (
      expectedStartExecutionOwnerId &&
      snapshot?.startExecution?.executionOwnerId !== expectedStartExecutionOwnerId
    ) {
      throw new StartExecutionSupersededError(runId);
    }
    if (
      expectedContinuationExecutionOwnerId &&
      snapshot?.continuationExecution?.executionOwnerId !== expectedContinuationExecutionOwnerId
    ) {
      throw new ContinuationExecutionSupersededError(runId);
    }
    if (
      (!snapshot?.startExecution || !snapshot.startMessageId) &&
      !snapshot?.continuationExecution
    ) {
      return false;
    }
    if (!snapshot?.conversationId) return false;
    if (
      snapshot.startExecution &&
      snapshot.startMessageId &&
      !stateHasMessageId(state, snapshot.startMessageId)
    ) {
      return false;
    }
    const configurable = checkpointConfigurable(state);
    const checkpointId = configurable?.checkpoint_id;
    const threadId = configurable?.thread_id;
    const checkpointNamespace = configurable?.checkpoint_ns ?? "";
    if (
      typeof checkpointId !== "string" ||
      checkpointId.length === 0 ||
      threadId !== snapshot.conversationId ||
      checkpointNamespace !== ""
    ) {
      return false;
    }
    if (snapshot.startExecution && snapshot.startMessageId) {
      snapshot.startExecution = {
        ...snapshot.startExecution,
        checkpointId,
        checkpointNamespace,
        checkpointThreadId: threadId,
        checkpointMessageId: snapshot.startMessageId,
      };
    }
    if (snapshot.continuationExecution) {
      snapshot.continuationExecution = {
        ...snapshot.continuationExecution,
        checkpointId,
        checkpointNamespace,
        checkpointThreadId: threadId,
      };
    }
    const receipt = await this.persist(snapshot);
    if (snapshot.startExecution && !receipt.startExecutionDisposition) {
      throw new Error("Gateway did not acknowledge the durable start checkpoint");
    }
    if (snapshot.continuationExecution && !receipt.continuationExecutionDisposition) {
      throw new Error("Gateway did not acknowledge the durable continuation checkpoint");
    }
    return true;
  }

  private completeOpenMessage(runId: string, finishReason: "failed" | "cancelled"): void {
    const snapshot = this.snapshots.get(runId);
    const active = snapshot?.activeMessage;
    if (!snapshot || !active) return;
    snapshot.journal.append({
      sessionId: snapshot.conversationId
        ? `agent-os:v1:conversation:${snapshot.conversationId}`
        : `agent-os:v1:run:${runId}`,
      runId,
      conversationId: snapshot.conversationId ?? runId,
      type: "MessageCompleted",
      data: {
        turnId: active.turnId,
        messageId: active.messageId,
        text: active.text,
        finishReason,
      },
    });
    snapshot.assistantText = active.text;
    snapshot.activeMessage = undefined;
  }

  private async failExecution(input: {
    runId: string;
    conversationId: string;
    sessionId: string;
    turnId: string;
    journal: EventJournal;
    failure: TerminalExecutionFailure;
    cause: unknown;
  }): Promise<void> {
    const current = this.snapshots.get(input.runId);
    if (!current || TERMINAL_STATUSES.has(current.status)) return;

    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        msg: "agent-os.execution_terminal_failure",
        runId: input.runId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        code: input.failure.code,
        error:
          input.cause instanceof Error
            ? `${input.cause.name}: ${input.cause.message}`
            : String(input.cause),
      })}\n`
    );

    this.completeOpenMessage(input.runId, "failed");
    input.journal.append({
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      type: "RunFailed",
      data: {
        turnId: input.turnId,
        status: "failed",
        error: input.failure,
      },
    });
    const failed: LangGraphRunSnapshot = {
      ...current,
      activeTurnId: input.turnId,
      status: "failed",
      journal: input.journal,
      pendingApproval: undefined,
      pendingUserInput: undefined,
      pendingExternal: undefined,
      errorMessage: input.failure.message,
    };
    this.snapshots.set(input.runId, failed);
    await this.persistUntilAccepted(failed, "run_failed");
  }

  private async failIfTerminalExecutionError(input: {
    runId: string;
    conversationId: string;
    sessionId: string;
    turnId: string;
    journal: EventJournal;
    error: unknown;
  }): Promise<boolean> {
    // A Gateway report error describes durability, not the model/tool outcome.
    // Keep its fenced command recoverable even if the HTTP status resembles a
    // permanent provider rejection.
    if (input.error instanceof AgentOsJournalReportError) return false;
    const failure = classifyTerminalExecutionFailure(input.error);
    if (!failure) return false;
    await this.failExecution({
      ...input,
      failure,
      cause: input.error,
    });
    return true;
  }

  private createJournal(): EventJournal {
    // PostgreSQL is the worker's only publication path. The Gateway publishes
    // committed events to Ably, so realtime can never overtake durability.
    return new EventJournal();
  }

  /**
   * States that cannot safely be rolled back (external handoff, HITL pause,
   * terminal outcome) stay in-process and retry until PostgreSQL accepts them.
   * This is deliberately separate from action-boundary persists, which throw
   * to HTTP so the Gateway/client can safely retry the same idempotency key.
   */
  private async persistUntilAccepted(
    snapshot: LangGraphRunSnapshot,
    reason: string
  ): Promise<void> {
    let attempt = 0;
    for (;;) {
      try {
        await this.persist(snapshot);
        // The Gateway finalizes a recoverable start/continuation ONLY when the
        // boundary report carries its durable checkpoint receipt. Dropping the
        // execution proof on status alone breaks that handshake: every later
        // report (e.g. the next approval in the same run) would arrive
        // proof-less while the command is still armed and be fenced with
        // AGENT_OS_CONTINUATION_EXECUTION_FENCED, wedging the run. Keep the
        // proof until a report that provably finalized has been accepted; a
        // later checkpoint capture then completes the handshake.
        if (
          snapshot.startExecution &&
          isCheckpointedStartBoundary(snapshot.status) &&
          snapshot.startExecution.checkpointId
        ) {
          snapshot.startExecution = undefined;
          if (this.snapshots.get(snapshot.runId) === snapshot) {
            this.stopStartHeartbeat(snapshot.runId);
          }
        }
        if (
          snapshot.continuationExecution &&
          isCheckpointedStartBoundary(snapshot.status) &&
          snapshot.continuationExecution.checkpointId
        ) {
          snapshot.continuationExecution = undefined;
          snapshot.continuationCommand = undefined;
          if (this.snapshots.get(snapshot.runId) === snapshot) {
            this.stopStartHeartbeat(snapshot.runId);
          }
        }
        return;
      } catch (error) {
        if (error instanceof AgentOsJournalReportError && error.status === 409) {
          if (await this.reconcileEquivalentExternalHandoff(snapshot, error)) return;
          // Prefix divergence anywhere except an exactly-correlated external
          // handoff is a protocol violation. Retrying the same divergent
          // suffix forever hides corruption and can never succeed.
          throw error;
        }
        attempt += 1;
        const delayMs = Math.min(5_000, 100 * 2 ** Math.min(attempt - 1, 6));
        process.stderr.write(
          `${JSON.stringify({
            level: "error",
            msg: "agent-os.journal.retrying_required_state",
            runId: snapshot.runId,
            status: snapshot.status,
            reason,
            attempt,
            delayMs,
            error: error instanceof Error ? error.message : String(error),
          })}\n`
        );
        await delay(delayMs);
      }
    }
  }

  /**
   * Registration reconciliation may persist the external-job receipt while a
   * delayed Worker still owns a semantically identical random-id suffix. On a
   * 409 only, accept PostgreSQL as the winner when every handoff correlation
   * key is identical, then replace the local journal so no later action can
   * append to the divergent prefix.
   */
  private async reconcileEquivalentExternalHandoff(
    snapshot: LangGraphRunSnapshot,
    conflict: AgentOsJournalReportError
  ): Promise<boolean> {
    const local = snapshot.pendingExternal;
    if (snapshot.status !== "waiting_for_external" || !local) return false;

    let durable;
    try {
      durable = await fetchJournalFromNest(snapshot.runId, { requireExisting: true });
    } catch {
      // The comparison itself must be durable and authoritative. If PG cannot
      // be read, retain the original divergence error rather than guessing.
      throw conflict;
    }
    if (!durable || durable.status !== "waiting_for_external") return false;
    const remote = durable.pendingExternal;
    if (!remote || typeof remote !== "object" || Array.isArray(remote)) return false;
    const correlation = remote as Record<string, unknown>;
    if (
      correlation.kind !== "external_job" ||
      correlation.jobId !== local.jobId ||
      correlation.turnId !== local.turnId ||
      correlation.toolCallId !== local.toolCallId ||
      correlation.toolId !== local.toolId
    ) {
      return false;
    }

    const journal = this.createJournal();
    journal.restore(durable.events);
    snapshot.journal = journal;
    snapshot.status = "waiting_for_external";
    snapshot.pendingApproval = undefined;
    snapshot.pendingUserInput = undefined;
    snapshot.pendingExternal = {
      ...local,
      ...(typeof correlation.startedMessage === "string"
        ? { startedMessage: correlation.startedMessage }
        : {}),
    };
    snapshot.assistantText = durable.assistantText ?? local.startedMessage;
    snapshot.activeMessage = undefined;
    this.snapshots.set(snapshot.runId, snapshot);
    return true;
  }

  private async persist(snapshot: LangGraphRunSnapshot): Promise<JournalReportReceipt> {
    if (
      !snapshot.projectId ||
      !snapshot.actorId ||
      !snapshot.modelProfileId ||
      !snapshot.conversationId
    ) {
      throw new Error(`Run ${snapshot.runId} is missing durable journal identity`);
    }
    // Capture an immutable snapshot now. LangGraph continues mutating the live
    // journal while a previous network write may still be in flight.
    const payload = {
      runId: snapshot.runId,
      projectId: snapshot.projectId,
      conversationId: snapshot.conversationId,
      actorId: snapshot.actorId,
      modelProfileId: snapshot.modelProfileId,
      status: snapshot.status,
      lastSequence: snapshot.journal.lastSequence,
      events: [...snapshot.journal.all()],
      pendingApproval: snapshot.pendingApproval ? { ...snapshot.pendingApproval } : null,
      pendingUserInput: snapshot.pendingUserInput ? { ...snapshot.pendingUserInput } : null,
      pendingExternal: snapshot.pendingExternal ? { ...snapshot.pendingExternal } : null,
      assistantText: snapshot.assistantText ?? null,
      projectKind: snapshot.projectKind,
      workbenchMode: snapshot.workbenchMode,
      workbenchContext: snapshot.workbenchContext,
      skillMountSnapshot: snapshot.skillMountSnapshot,
      startExecution: snapshot.startExecution,
      continuationCommand: snapshot.continuationCommand,
      continuationExecution: snapshot.continuationExecution,
    };
    const previous = this.persistQueues.get(snapshot.runId) ?? Promise.resolve();
    // The previous caller observes its own rejection. A rejected write must
    // still release the per-run lane so an idempotent retry can submit the same
    // durable prefix instead of permanently poisoning the queue.
    const report = () => reportJournalToNest(payload);
    const queued = previous.then(report, report);
    this.persistQueues.set(snapshot.runId, queued);
    try {
      return await queued;
    } finally {
      if (this.persistQueues.get(snapshot.runId) === queued) {
        this.persistQueues.delete(snapshot.runId);
      }
    }
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

function interruptsFromState(state: unknown): AgentInterruptValue[] {
  if (!state || typeof state !== "object") return [];
  const tasks = (state as { tasks?: unknown[] }).tasks;
  if (!Array.isArray(tasks)) return [];
  const out: AgentInterruptValue[] = [];
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    const interrupts = (task as { interrupts?: Array<{ value?: unknown }> }).interrupts;
    if (!Array.isArray(interrupts)) continue;
    for (const item of interrupts) {
      const value = item?.value;
      if (
        value &&
        typeof value === "object" &&
        ((value as AgentInterruptValue).kind === "tool_approval" ||
          (value as AgentInterruptValue).kind === "user_input")
      ) {
        out.push(value as AgentInterruptValue);
      }
    }
  }
  return out;
}

function validateUserInputAnswers(
  pending: UserInputInterruptValue,
  raw: Record<string, string>
): Record<string, string> {
  const expectedIds = new Set(pending.questions.map((question) => question.id));
  const suppliedIds = Object.keys(raw);
  if (
    suppliedIds.length !== expectedIds.size ||
    suppliedIds.some((questionId) => !expectedIds.has(questionId))
  ) {
    throw new Error("User input answers do not match the pending questions");
  }
  const answers: Record<string, string> = {};
  for (const question of pending.questions) {
    const value = raw[question.id];
    if (!value || !question.options.some((option) => option.value === value)) {
      throw new Error(`Invalid answer for ${question.id}`);
    }
    answers[question.id] = value;
  }
  return answers;
}

function durableInteractionId(
  value: unknown,
  key: "approvalId" | "requestId" | "turnId"
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>)[key];
  return typeof id === "string" && id.length > 0 ? id : null;
}

function durableString(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const text = (value as Record<string, unknown>)[key];
  return typeof text === "string" ? text.trim() : "";
}

function latestDurableTurnId(events: unknown): string | null {
  if (!Array.isArray(events)) return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const data = (events[index] as { data?: unknown })?.data;
    const turnId = durableInteractionId(data, "turnId");
    if (turnId) return turnId;
  }
  return null;
}

function normalizeMessageText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stableAnswerFingerprint(answers: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.entries(answers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value])
  );
}

function modelOutputHasToolCalls(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const direct = (output as { tool_calls?: unknown }).tool_calls;
  if (Array.isArray(direct) && direct.length > 0) return true;
  const nested = (output as { additional_kwargs?: { tool_calls?: unknown } }).additional_kwargs
    ?.tool_calls;
  return Array.isArray(nested) && nested.length > 0;
}
