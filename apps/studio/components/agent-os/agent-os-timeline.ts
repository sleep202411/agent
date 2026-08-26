import type {
  AgentOsEvent,
  AgentOsPendingExternal,
  AgentOsPendingApproval,
  AgentOsPendingUserInput,
  AgentOsWorkbenchContext,
} from "@/lib/agent-os/api-client";

export type AgentOsSessionStatus =
  | "idle"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "waiting_for_external"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentOsAssistantSegment {
  /** Protocol messageId. This identity never changes when the segment settles. */
  id: string;
  kind: string;
  content: string;
  createdAt: string;
  eventSequence: number;
  completed: boolean;
  finishReason?: string;
}

export type AgentOsArtifactStatus =
  | "proposed"
  | "active"
  | "applying"
  | "applied"
  | "rejected"
  | "failed"
  | "cancelled";

/** A durable domain reference, never a copy of the proposal payload. */
export interface AgentOsStoryProposalArtifactReference {
  kind: "story_stage_proposal";
  storyAgentRunId: string;
  storyProjectId?: string;
  storyChapterId?: string;
  workspaceId?: string;
  stage?: "script" | "plot" | "assets" | "storyboard" | "noop" | "patch";
  schemaVersion?: string;
  /** True only for journals written before ArtifactCreated existed. */
  legacy?: boolean;
}

export interface AgentOsStoryGenerationBatchArtifactReference {
  kind: "story_generation_batch";
  generationBatchId: string;
  storyProjectId: string;
  storyChapterId: string;
  schemaVersion: "story-generation-batch-artifact/v1";
  /** True only when recovered from a legacy ToolCompleted event. */
  legacy?: boolean;
}

export type AgentOsArtifactReference =
  | AgentOsStoryProposalArtifactReference
  | AgentOsStoryGenerationBatchArtifactReference;

export interface AgentOsTranscriptArtifact {
  id: string;
  reference: AgentOsArtifactReference;
  status: AgentOsArtifactStatus;
  createdAt: string;
  eventSequence: number;
}

export interface AgentOsChatMessage {
  id: string;
  role: "user" | "assistant";
  /** User copy, or the plain-text projection of all Assistant segments. */
  content: string;
  createdAt: string;
  /** One user submission and the Assistant work it caused. */
  turnId: string;
  /** Present only on an Assistant UI turn. */
  segments?: AgentOsAssistantSegment[];
  /** Durable rich content parts attached to this Assistant turn. */
  artifacts?: AgentOsTranscriptArtifact[];
  meta?: Record<string, unknown>;
  runId?: string;
  workbenchContext?: AgentOsWorkbenchContext;
}

export type AgentOsActivityPhase =
  | { kind: "thinking" }
  | { kind: "planning" }
  | { kind: "waiting_for_input" }
  | { kind: "waiting_for_approval" }
  | { kind: "tool"; toolId: string };

export type AgentOsActivity = AgentOsActivityPhase & { turnId: string | null };

type TurnEvent = { event: AgentOsEvent; turnId: string };

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve protocol turn ids without ever treating messageId as a turn id.
 * Journals written before turnId existed receive one deterministic synthetic
 * turn per UserMessage; subsequent events remain in that turn until the next
 * UserMessage. This is replay compatibility only — current writers are strict.
 */
function eventsWithTurnIds(events: readonly AgentOsEvent[], runId: string): TurnEvent[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const result: TurnEvent[] = [];
  let legacyUserIndex = -1;
  let currentTurnId: string | null = null;

  for (const event of sorted) {
    const explicitTurnId = nonEmptyString(event.data.turnId);
    if (explicitTurnId) {
      currentTurnId = explicitTurnId;
    } else if (event.type === "UserMessage") {
      legacyUserIndex += 1;
      currentTurnId = `legacy:${runId}:${legacyUserIndex}`;
    } else if (!currentTurnId) {
      // A few oldest journals omitted UserMessage entirely. They still get a
      // stable replay bucket, but current producers must never rely on it.
      currentTurnId = `legacy:${runId}:prelude`;
    }
    result.push({ event, turnId: currentTurnId });
  }
  return result;
}

function interactionMeta(event: AgentOsEvent): Record<string, unknown> {
  const interaction = event.data.interaction;
  if (!interaction || typeof interaction !== "object" || Array.isArray(interaction)) return {};
  const record = interaction as Record<string, unknown>;
  const kind =
    record.kind === "approval"
      ? "approval_response"
      : record.kind === "user_input"
        ? "user_input_response"
        : undefined;
  if (!kind) return {};
  return {
    kind,
    ...Object.fromEntries(Object.entries(record).filter(([key]) => key !== "kind")),
  };
}

function attachmentNames(event: AgentOsEvent): string[] {
  if (!Array.isArray(event.data.attachments)) return [];
  return event.data.attachments.flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return [];
    const filename = (attachment as Record<string, unknown>).filename;
    return typeof filename === "string" && filename.trim() ? [filename.trim()] : [];
  });
}

function storyGenerationBatchReference(
  value: unknown,
  legacy = false
): AgentOsStoryGenerationBatchArtifactReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const generationBatchId = nonEmptyString(record.generationBatchId ?? record.id);
  const storyProjectId = nonEmptyString(record.storyProjectId ?? record.projectId);
  const storyChapterId = nonEmptyString(record.storyChapterId ?? record.chapterId);
  const confirmedAt = nonEmptyString(record.confirmedAt);
  if (!generationBatchId || !storyProjectId || !storyChapterId || (legacy && !confirmedAt)) {
    return null;
  }
  return {
    kind: "story_generation_batch",
    generationBatchId,
    storyProjectId,
    storyChapterId,
    schemaVersion: "story-generation-batch-artifact/v1",
    ...(legacy ? { legacy: true } : {}),
  };
}

/**
 * Journal → product transcript projection.
 *
 * - turnId owns one Assistant visual group;
 * - messageId owns one immutable segment inside that group;
 * - domain artifacts are durable Assistant parts, not approval UI;
 * - tools/plans/questions/approvals never become transcript rows;
 * - structured answers remain normal durable user messages.
 */
export function rebuildRunTimelineFromEvents(
  events: readonly AgentOsEvent[],
  runId: string,
  runStatus: AgentOsSessionStatus
): AgentOsChatMessage[] {
  const timeline: AgentOsChatMessage[] = [];
  const assistantByTurn = new Map<string, AgentOsChatMessage>();
  const segmentsByTurn = new Map<string, Map<string, AgentOsAssistantSegment>>();
  const openMessageByTurn = new Map<string, string>();
  const artifactById = new Map<string, AgentOsTranscriptArtifact>();
  const artifactIdByToolCall = new Map<string, string>();
  const artifactIdByApproval = new Map<string, string>();

  const ensureAssistant = (
    turnId: string,
    timestamp: string,
    eventSequence: number
  ): AgentOsChatMessage => {
    const existing = assistantByTurn.get(turnId);
    if (existing) return existing;
    const created: AgentOsChatMessage = {
      id: `assistant-turn:${runId}:${turnId}`,
      role: "assistant",
      content: "",
      createdAt: timestamp,
      turnId,
      runId,
      segments: [],
      artifacts: [],
      meta: { eventSequence },
    };
    assistantByTurn.set(turnId, created);
    segmentsByTurn.set(turnId, new Map());
    timeline.push(created);
    return created;
  };

  const ensureSegment = (
    turnId: string,
    messageId: string,
    timestamp: string,
    eventSequence: number,
    kind = "response"
  ): AgentOsAssistantSegment => {
    const assistant = ensureAssistant(turnId, timestamp, eventSequence);
    const byMessage = segmentsByTurn.get(turnId)!;
    const existing = byMessage.get(messageId);
    if (existing) return existing;
    const segment: AgentOsAssistantSegment = {
      id: messageId,
      kind,
      content: "",
      createdAt: timestamp,
      eventSequence,
      completed: false,
    };
    byMessage.set(messageId, segment);
    assistant.segments!.push(segment);
    return segment;
  };

  const settleOpenSegment = (turnId: string) => {
    const messageId = openMessageByTurn.get(turnId);
    if (!messageId) return;
    const segment = segmentsByTurn.get(turnId)?.get(messageId);
    if (segment) segment.completed = true;
    openMessageByTurn.delete(turnId);
  };

  const addArtifact = (
    turnId: string,
    artifactId: string,
    reference: AgentOsArtifactReference,
    timestamp: string,
    eventSequence: number,
    status: AgentOsArtifactStatus = "proposed"
  ): AgentOsTranscriptArtifact => {
    const existing = artifactById.get(artifactId);
    if (existing) {
      if (!reference.legacy) existing.reference = reference;
      return existing;
    }
    const assistant = ensureAssistant(turnId, timestamp, eventSequence);
    const artifact: AgentOsTranscriptArtifact = {
      id: artifactId,
      reference,
      status,
      createdAt: timestamp,
      eventSequence,
    };
    artifactById.set(artifactId, artifact);
    assistant.artifacts!.push(artifact);
    return artifact;
  };

  for (const { event, turnId } of eventsWithTurnIds(events, runId)) {
    if (event.type === "UserMessage") {
      const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
      const names = attachmentNames(event);
      if (!text && names.length === 0) continue;
      const messageId =
        nonEmptyString(event.data.messageId) ?? `legacy-user:${runId}:${event.sequence}`;
      timeline.push({
        id: `user:${runId}:${messageId}`,
        role: "user",
        content: text,
        createdAt: event.timestamp,
        turnId,
        runId,
        meta: {
          eventSequence: event.sequence,
          ...(names.length > 0 ? { attachmentNames: names } : {}),
          ...interactionMeta(event),
        },
      });
      continue;
    }

    if (event.type === "MessageStarted") {
      const messageId =
        nonEmptyString(event.data.messageId) ??
        `legacy-message:${runId}:${turnId}:${event.sequence}`;
      const kind = nonEmptyString(event.data.segmentKind) ?? "response";
      ensureSegment(turnId, messageId, event.timestamp, event.sequence, kind);
      openMessageByTurn.set(turnId, messageId);
      continue;
    }

    if (event.type === "MessageDelta" && typeof event.data.delta === "string") {
      const messageId =
        nonEmptyString(event.data.messageId) ??
        openMessageByTurn.get(turnId) ??
        `legacy-message:${runId}:${turnId}`;
      const segment = ensureSegment(turnId, messageId, event.timestamp, event.sequence);
      segment.content += event.data.delta;
      segment.eventSequence = event.sequence;
      segment.completed = false;
      openMessageByTurn.set(turnId, messageId);
      continue;
    }

    if (event.type === "MessageCompleted") {
      const messageId =
        nonEmptyString(event.data.messageId) ??
        openMessageByTurn.get(turnId) ??
        `legacy-message:${runId}:${turnId}`;
      const segment = ensureSegment(turnId, messageId, event.timestamp, event.sequence);
      if (typeof event.data.text === "string" && event.data.text.trim()) {
        // Completed text is canonical for this messageId; never merge it into
        // another segment or create a second assistant bubble.
        segment.content = event.data.text;
      }
      segment.eventSequence = event.sequence;
      segment.completed = true;
      segment.finishReason = nonEmptyString(event.data.finishReason) ?? undefined;
      openMessageByTurn.delete(turnId);
      continue;
    }

    if (event.type === "ArtifactCreated") {
      const artifactId = nonEmptyString(event.data.artifactId);
      const rawReference = event.data.artifact;
      if (
        !artifactId ||
        !rawReference ||
        typeof rawReference !== "object" ||
        Array.isArray(rawReference)
      ) {
        continue;
      }
      const reference = rawReference as Record<string, unknown>;
      if (reference.kind === "story_generation_batch") {
        const batchReference = storyGenerationBatchReference(reference);
        if (!batchReference) continue;
        addArtifact(
          turnId,
          artifactId,
          batchReference,
          event.timestamp,
          event.sequence,
          event.data.status === "active" ? "active" : "proposed"
        );
        continue;
      }
      const storyAgentRunId = nonEmptyString(reference.storyAgentRunId);
      if (reference.kind !== "story_stage_proposal" || !storyAgentRunId) continue;
      addArtifact(
        turnId,
        artifactId,
        {
          kind: "story_stage_proposal",
          storyAgentRunId,
          storyProjectId: nonEmptyString(reference.storyProjectId) ?? undefined,
          storyChapterId: nonEmptyString(reference.storyChapterId) ?? undefined,
          workspaceId: nonEmptyString(reference.workspaceId) ?? undefined,
          stage:
            reference.stage === "script" ||
            reference.stage === "assets" ||
            reference.stage === "plot" ||
            reference.stage === "storyboard" ||
            reference.stage === "noop" ||
            reference.stage === "patch"
              ? reference.stage
              : undefined,
          schemaVersion: nonEmptyString(reference.schemaVersion) ?? undefined,
        },
        event.timestamp,
        event.sequence
      );
      continue;
    }

    if (event.type === "ToolCompleted" && event.data.toolId === "story.generation.confirmBatch") {
      // Journals written immediately before the explicit Artifact event was
      // introduced still contain the canonical confirmed batch result. Use it
      // as a deterministic replay bridge; all current writers emit
      // ArtifactCreated before ToolCompleted.
      const batchReference = storyGenerationBatchReference(event.data.result, true);
      if (batchReference) {
        addArtifact(
          turnId,
          batchReference.generationBatchId,
          batchReference,
          event.timestamp,
          event.sequence,
          "active"
        );
      }
    }

    if (event.type === "ArtifactUpdated") {
      const artifactId = nonEmptyString(event.data.artifactId);
      const status = event.data.status;
      const artifact = artifactId ? artifactById.get(artifactId) : null;
      if (
        artifact &&
        (status === "applying" ||
          status === "applied" ||
          status === "rejected" ||
          status === "failed" ||
          status === "cancelled")
      ) {
        artifact.status = status;
      }
      continue;
    }

    if (event.type === "ToolProposed") {
      const toolCallId = nonEmptyString(event.data.toolCallId);
      if (event.data.toolId !== "story.applyProposal" || !toolCallId) continue;
      const args = event.data.arguments;
      if (!args || typeof args !== "object" || Array.isArray(args)) continue;
      const storyAgentRunId = nonEmptyString((args as Record<string, unknown>).storyAgentRunId);
      if (!storyAgentRunId) continue;
      addArtifact(
        turnId,
        storyAgentRunId,
        {
          kind: "story_stage_proposal",
          storyAgentRunId,
          legacy: true,
        },
        event.timestamp,
        event.sequence
      );
      artifactIdByToolCall.set(toolCallId, storyAgentRunId);
      continue;
    }

    if (event.type === "ApprovalRequired") {
      const approvalId = nonEmptyString(event.data.approvalId);
      const toolCallId = nonEmptyString(event.data.toolCallId);
      const artifactId = toolCallId ? artifactIdByToolCall.get(toolCallId) : null;
      if (approvalId && artifactId) artifactIdByApproval.set(approvalId, artifactId);
    }

    if (event.type === "ApprovalResolved") {
      const approvalId = nonEmptyString(event.data.approvalId);
      const artifact = approvalId
        ? artifactById.get(artifactIdByApproval.get(approvalId) ?? "")
        : null;
      if (artifact) {
        artifact.status = event.data.decision === "reject" ? "rejected" : "applying";
      }
    }

    if (event.type === "ToolStarted" || event.type === "ToolFailed") {
      const toolCallId = nonEmptyString(event.data.toolCallId);
      const artifact = toolCallId
        ? artifactById.get(artifactIdByToolCall.get(toolCallId) ?? "")
        : null;
      if (artifact) {
        artifact.status =
          event.type === "ToolStarted"
            ? "applying"
            : event.data.code === "STORY_PROPOSAL_REJECTED"
              ? "rejected"
              : "failed";
      }
    }

    if (
      event.type === "RunCompleted" ||
      event.type === "RunFailed" ||
      event.type === "RunCancelled"
    ) {
      for (const artifact of artifactById.values()) {
        if (artifact.status !== "applying") continue;
        artifact.status =
          event.type === "RunCompleted"
            ? "applied"
            : event.type === "RunCancelled"
              ? "cancelled"
              : "failed";
      }
    }

    if (
      event.type === "UserInputRequired" ||
      event.type === "ApprovalRequired" ||
      event.type === "RunPaused"
    ) {
      // Old runtimes sometimes omitted MessageCompleted before pausing. The
      // visible lead-in is settled at this durable boundary (no fake caret).
      settleOpenSegment(turnId);
    }
  }

  if (
    runStatus === "waiting_for_input" ||
    runStatus === "waiting_for_approval" ||
    runStatus === "waiting_for_external"
  ) {
    for (const turnId of openMessageByTurn.keys()) settleOpenSegment(turnId);
  }

  const active = runStatus === "running" || runStatus === "waiting_for_external";
  for (const assistant of assistantByTurn.values()) {
    // Recovery closes an unverified partial segment with `superseded` before
    // starting a fresh messageId in the same turn. Keep that closure durable
    // for audit/replay, but never expose duplicated or stale partial copy.
    const segments = (assistant.segments ?? []).filter(
      (segment) => segment.finishReason !== "superseded"
    );
    assistant.segments = segments;
    assistant.content = segments
      .map((segment) => segment.content.trim())
      .filter(Boolean)
      .join("\n\n");
    const last = segments.at(-1);
    assistant.meta = {
      ...assistant.meta,
      kind: active && last && !last.completed ? "streaming" : "message_completed",
      segmentCount: segments.length,
      eventSequence: last?.eventSequence ?? assistant.meta?.eventSequence,
    };
  }

  return timeline.filter(
    (message) =>
      message.role === "user" ||
      (message.segments?.length ?? 0) > 0 ||
      (message.artifacts?.length ?? 0) > 0
  );
}

export function deriveActiveTurnId(events: readonly AgentOsEvent[], runId: string): string | null {
  return eventsWithTurnIds(events, runId).at(-1)?.turnId ?? null;
}

/** One live status for the current turn; completed acknowledgement copy does not end work. */
export function deriveAgentActivity(
  events: readonly AgentOsEvent[],
  status: AgentOsSessionStatus,
  pendingExternal?: AgentOsPendingExternal | null
): AgentOsActivity | null {
  if (
    status !== "running" &&
    status !== "waiting_for_external" &&
    status !== "waiting_for_input" &&
    status !== "waiting_for_approval"
  ) {
    return null;
  }
  const runId = events.at(-1)?.runId ?? "unknown";
  const annotated = eventsWithTurnIds(events, runId);
  const turnId = annotated.at(-1)?.turnId ?? null;
  if (status === "waiting_for_input") return { kind: "waiting_for_input", turnId };
  if (status === "waiting_for_approval") return { kind: "waiting_for_approval", turnId };
  let activity: AgentOsActivity | null = { kind: "thinking", turnId };

  for (const item of annotated) {
    if (item.turnId !== turnId) continue;
    const event = item.event;
    switch (event.type) {
      case "PlanCreated":
      case "PlanUpdated":
        activity = { kind: "planning", turnId };
        break;
      case "StepStarted":
        if (nonEmptyString(event.data.step) === "permission") {
          activity = { kind: "thinking", turnId };
        }
        break;
      case "ToolProposed":
      case "ToolStarted":
      case "ToolProgress": {
        const toolId = nonEmptyString(event.data.toolId);
        activity = toolId ? { kind: "tool", toolId, turnId } : { kind: "thinking", turnId };
        break;
      }
      case "MessageDelta":
        // Visible streamed answer copy is its own progress indication.
        activity = null;
        break;
      case "MessageCompleted":
      case "ToolCompleted":
      case "ToolFailed":
      case "MessageStarted":
      case "RunStarted":
      case "RunResumed":
      case "UserInputResolved":
      case "ApprovalResolved":
        activity = { kind: "thinking", turnId };
        break;
      default:
        break;
    }
  }
  const external =
    status === "waiting_for_external"
      ? (pendingExternal ?? derivePendingExternalFromEvents(events))
      : null;
  if (external) {
    return { kind: "tool", toolId: external.toolId, turnId: external.turnId || turnId };
  }
  return activity;
}

export function deriveStatusFromEvents(
  events: readonly AgentOsEvent[],
  bufferStatus: string
): AgentOsSessionStatus {
  let derived: AgentOsSessionStatus | null = null;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    switch (event.type) {
      case "RunCompleted":
        derived = "completed";
        break;
      case "RunFailed":
        derived = "failed";
        break;
      case "RunCancelled":
        derived = "cancelled";
        break;
      case "ApprovalRequired":
        derived = "waiting_for_approval";
        break;
      case "UserInputRequired":
        derived = "waiting_for_input";
        break;
      case "RunPaused":
        derived =
          event.data.status === "waiting_for_input"
            ? "waiting_for_input"
            : event.data.status === "waiting_for_external"
              ? "waiting_for_external"
              : "waiting_for_approval";
        break;
      case "ApprovalResolved":
        // Reject answers one proposed action and resumes the same Agent run;
        // only RunCancelled is allowed to project a cancelled conversation.
        derived = "running";
        break;
      case "UserInputResolved":
      case "RunStarted":
      case "RunResumed":
        derived = "running";
        break;
      default:
        break;
    }
  }
  if (derived) return derived;
  switch (bufferStatus) {
    case "waiting_for_approval":
    case "waiting_for_input":
    case "waiting_for_external":
    case "completed":
    case "failed":
    case "cancelled":
      return bufferStatus;
    case "running":
    case "queued":
    case "paused":
      return "running";
    default:
      return "idle";
  }
}

export function derivePendingApprovalFromEvents(
  events: readonly AgentOsEvent[]
): AgentOsPendingApproval | null {
  let proposed: { toolId: string; toolCallId: string; arguments: unknown; turnId?: string } | null =
    null;
  let pending: AgentOsPendingApproval | null = null;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.type === "ToolProposed") {
      const toolCallId = nonEmptyString(event.data.toolCallId);
      if (!toolCallId) continue;
      proposed = {
        toolId: nonEmptyString(event.data.toolId) ?? "tool",
        toolCallId,
        arguments: event.data.arguments,
        turnId: nonEmptyString(event.data.turnId) ?? undefined,
      };
      continue;
    }
    if (event.type === "ApprovalRequired") {
      const approvalId = nonEmptyString(event.data.approvalId);
      const toolCallId = nonEmptyString(event.data.toolCallId) ?? proposed?.toolCallId;
      if (!approvalId || !toolCallId) continue;
      const sameProposal = proposed?.toolCallId === toolCallId ? proposed : null;
      const toolId = nonEmptyString(event.data.toolId) ?? sameProposal?.toolId ?? "tool";
      pending = {
        kind: "tool_approval",
        toolId,
        toolCallId,
        arguments: event.data.arguments ?? sameProposal?.arguments,
        title: nonEmptyString(event.data.title) ?? `Approve ${toolId}`,
        description: nonEmptyString(event.data.description) ?? "Sensitive write requires approval.",
        approvalId,
        turnId: nonEmptyString(event.data.turnId) ?? sameProposal?.turnId ?? undefined,
      };
      continue;
    }
    if (
      event.type === "RunCompleted" ||
      event.type === "RunCancelled" ||
      event.type === "RunFailed"
    ) {
      pending = null;
      continue;
    }
    if (event.type === "ApprovalResolved") {
      const approvalId = nonEmptyString(event.data.approvalId);
      if (!approvalId || approvalId === pending?.approvalId) pending = null;
      continue;
    }
    if (
      event.type === "ToolStarted" ||
      event.type === "ToolCompleted" ||
      event.type === "ToolFailed"
    ) {
      const toolCallId = nonEmptyString(event.data.toolCallId);
      if (!toolCallId || toolCallId === pending?.toolCallId) pending = null;
    }
  }
  return pending;
}

export function derivePendingUserInputFromEvents(
  events: readonly AgentOsEvent[]
): AgentOsPendingUserInput | null {
  let pending: AgentOsPendingUserInput | null = null;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.type === "UserInputRequired") {
      const requestId = nonEmptyString(event.data.requestId);
      const toolCallId = nonEmptyString(event.data.toolCallId);
      const questions = Array.isArray(event.data.questions)
        ? (event.data.questions as AgentOsPendingUserInput["questions"])
        : [];
      if (!requestId || !toolCallId || questions.length === 0) continue;
      pending = {
        kind: "user_input",
        requestId,
        toolCallId,
        questions,
        formId: nonEmptyString(event.data.formId) ?? undefined,
        knownValues:
          event.data.knownValues &&
          typeof event.data.knownValues === "object" &&
          !Array.isArray(event.data.knownValues)
            ? (event.data.knownValues as Record<string, string>)
            : undefined,
        turnId: nonEmptyString(event.data.turnId) ?? undefined,
        resumeAcknowledgement: nonEmptyString(event.data.resumeAcknowledgement) ?? undefined,
      };
      continue;
    }
    if (
      event.type === "RunCompleted" ||
      event.type === "RunCancelled" ||
      event.type === "RunFailed"
    ) {
      pending = null;
      continue;
    }
    if (event.type === "UserInputResolved") {
      const requestId = nonEmptyString(event.data.requestId);
      if (!requestId || requestId === pending?.requestId) pending = null;
    }
  }
  return pending;
}

/** Rebuild the durable host-job handoff so reload keeps meaningful activity. */
export function derivePendingExternalFromEvents(
  events: readonly AgentOsEvent[]
): AgentOsPendingExternal | null {
  let pending: AgentOsPendingExternal | null = null;
  let latestMessage = "";

  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.type === "MessageCompleted") {
      latestMessage = nonEmptyString(event.data.text) ?? latestMessage;
      continue;
    }
    if (event.type === "ToolCompleted") {
      const handoff = event.data.agentHandoff;
      if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) continue;
      const record = handoff as Record<string, unknown>;
      const jobId = nonEmptyString(record.jobId);
      const turnId = nonEmptyString(event.data.turnId);
      const toolCallId = nonEmptyString(event.data.toolCallId);
      const toolId = nonEmptyString(event.data.toolId);
      if (record.kind !== "external_job" || !jobId || !turnId || !toolCallId || !toolId) continue;
      pending = {
        kind: "external_job",
        jobId,
        startedMessage: nonEmptyString(record.startedMessage) ?? latestMessage,
        turnId,
        toolCallId,
        toolId,
      };
      continue;
    }
    if (event.type === "RunPaused" && event.data.status === "waiting_for_external") {
      const jobId: string | null =
        nonEmptyString(event.data.externalJobId) ?? pending?.jobId ?? null;
      const turnId: string | null = nonEmptyString(event.data.turnId) ?? pending?.turnId ?? null;
      const toolCallId: string | null =
        nonEmptyString(event.data.toolCallId) ?? pending?.toolCallId ?? null;
      const toolId: string | null = nonEmptyString(event.data.toolId) ?? pending?.toolId ?? null;
      if (!jobId || !turnId || !toolCallId || !toolId) continue;
      pending = {
        kind: "external_job",
        jobId,
        startedMessage: pending?.startedMessage || latestMessage,
        turnId,
        toolCallId,
        toolId,
      };
      continue;
    }
    if (
      event.type === "RunResumed" ||
      event.type === "RunCompleted" ||
      event.type === "RunCancelled" ||
      event.type === "RunFailed"
    ) {
      pending = null;
    }
  }

  return pending;
}

export function workbenchContextFromEvents(
  events: readonly AgentOsEvent[]
): AgentOsWorkbenchContext | null {
  const value = events.find((event) => event.type === "RunStarted")?.data.workbenchContext;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([, item]) => typeof item !== "string")) return null;
  return Object.fromEntries(entries) as AgentOsWorkbenchContext;
}
