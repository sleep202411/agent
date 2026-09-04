import type {
  AgentOsConversationRun,
  AgentOsEvent,
  AgentOsPendingExternal,
} from "../api/agent-os-api";
import type { MessageKey } from "@/i18n";
import type { AgentMessage, StoryProposalArtifactStatus, StoryTranscriptArtifact } from "../types";
import { isStoryStageProposalArtifact } from "../types";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const WAITING_FOR_USER = new Set(["waiting_for_approval", "waiting_for_input"]);

export type AgentOsActivityPhase =
  | { kind: "planning" }
  | { kind: "thinking" }
  | { kind: "tool"; toolId: string }
  | { kind: "waiting_for_input" }
  | { kind: "waiting_for_approval" };

const TOOL_ACTIVITY_KEYS: Record<string, string> = {
  "story.read": "readingStory",
  "story.confirmCreativeProfile": "confirmingCreativeDirection",
  "story.author": "preparingStoryDraft",
  "story.updateBible": "updatingStory",
  "story.addScene": "writingScenes",
  "story.addBranch": "designingBranches",
  "story.editNode": "updatingStory",
  "story.putInteraction": "updatingStory",
  "story.removeInteraction": "updatingStory",
  "story.removeSubtree": "updatingStory",
  "story.setEntry": "updatingStory",
  "story.reorder": "updatingStory",
  "story.applyPatch": "updatingStory",
  "canvas.read": "readingCanvas",
  "canvas.applyPatch": "updatingCanvas",
  "script.store": "savingSource",
  "script.readSection": "readingSource",
  "characters.list": "readingCharacters",
  "characters.upsert": "updatingCharacters",
  "storyboard.listShots": "readingStoryboard",
  "storyboard.upsertShots": "updatingStoryboard",
  "storyboard.deleteShots": "updatingStoryboard",
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function agentActivityLabelKey(activity: AgentOsActivityPhase): string {
  if (activity.kind === "planning") return "planning";
  if (activity.kind === "thinking") return "thinking";
  if (activity.kind === "waiting_for_input") return "waitingForInput";
  if (activity.kind === "waiting_for_approval") return "waitingForApproval";
  const exact = TOOL_ACTIVITY_KEYS[activity.toolId];
  if (exact) return exact;
  return /(?:^|\.)(?:read|list|get|search|inspect)/i.test(activity.toolId)
    ? "readingProject"
    : "updatingProject";
}

export function agentActivityMessageKey(activity: AgentOsActivityPhase): MessageKey {
  return `agent.activity.${agentActivityLabelKey(activity)}` as MessageKey;
}

/**
 * One live status line for the current turn (mirrors PC `deriveAgentActivity`).
 * Streamed assistant copy clears the generic spinner; a pending external job
 * (story.author) keeps a tool phase so the host can overlay stage copy.
 */
export function deriveAgentActivity(
  events: AgentOsEvent[],
  status: string,
  pendingExternal?: AgentOsPendingExternal | null
): AgentOsActivityPhase | null {
  if (
    status !== "running" &&
    status !== "waiting_for_external" &&
    status !== "queued" &&
    status !== "waiting_for_input" &&
    status !== "waiting_for_approval"
  ) {
    return null;
  }
  if (status === "waiting_for_input") return { kind: "waiting_for_input" };
  if (status === "waiting_for_approval") return { kind: "waiting_for_approval" };
  if (status === "queued") return { kind: "thinking" };

  let activity: AgentOsActivityPhase | null = { kind: "thinking" };
  for (const event of events) {
    switch (event.type) {
      case "PlanCreated":
      case "PlanUpdated":
        activity = { kind: "planning" };
        break;
      case "ToolProposed":
      case "ToolStarted":
      case "ToolProgress": {
        const toolId = typeof event.data.toolId === "string" ? event.data.toolId : "";
        activity = toolId ? { kind: "tool", toolId } : { kind: "thinking" };
        break;
      }
      case "MessageDelta":
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
        activity = { kind: "thinking" };
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
    if (external.toolId === "story.generation.confirmBatch") return null;
    return { kind: "tool", toolId: external.toolId };
  }
  return activity;
}

/** True while the open assistant message is still receiving deltas. */
export function currentTurnIsStreaming(events: AgentOsEvent[]): boolean {
  let streaming = false;
  for (const event of events) {
    switch (event.type) {
      case "MessageDelta":
        streaming = true;
        break;
      case "MessageCompleted":
      case "UserInputRequired":
      case "ApprovalRequired":
      case "RunPaused":
        streaming = false;
        break;
      default:
        break;
    }
  }
  return streaming;
}

/** Rebuild the durable host-job handoff so reload keeps meaningful activity. */
export function derivePendingExternalFromEvents(
  events: AgentOsEvent[]
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

/** True when the latest user turn already has visible assistant copy. */
export function currentTurnHasAssistantReply(messages: AgentMessage[]): boolean {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) return false;
  for (let i = lastUserIndex + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role === "assistant" && message.text?.trim()) return true;
  }
  return false;
}

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/** HITL pause — stop polling until the user answers. */
export function isWaitingForUserStatus(status: string): boolean {
  return WAITING_FOR_USER.has(status);
}

const ARTIFACT_STATUSES = new Set<StoryProposalArtifactStatus>([
  "proposed",
  "active",
  "applying",
  "applied",
  "rejected",
  "failed",
  "cancelled",
]);

function isArtifactStatus(value: unknown): value is StoryProposalArtifactStatus {
  return typeof value === "string" && ARTIFACT_STATUSES.has(value as StoryProposalArtifactStatus);
}

/**
 * Fold Agent OS journal events into the Dreem-style message list used by
 * mobile thread UI. One user submission owns one Assistant bubble (H5 turn):
 * later MessageCompleted segments append in place, and domain artifacts stay
 * on that same bubble so markdown (tables included) paints before the card.
 */
function attachmentNamesFromEvent(event: AgentOsEvent): string[] {
  if (!Array.isArray(event.data.attachments)) return [];
  return event.data.attachments.flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return [];
    const filename = (attachment as Record<string, unknown>).filename;
    return typeof filename === "string" && filename.trim() ? [filename.trim()] : [];
  });
}

export function eventsToMessages(
  events: AgentOsEvent[],
  opts?: {
    runId?: string;
    userText?: string;
    userAt?: string;
    userAttachmentNames?: string[];
    hitlText?: string;
    hitlAt?: string;
    hitlDecision?: "approve" | "reject";
  }
): AgentMessage[] {
  const out: AgentMessage[] = [];
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const artifactById = new Map<string, StoryTranscriptArtifact>();
  const artifactIdByToolCall = new Map<string, string>();
  const artifactIdByApproval = new Map<string, string>();
  let lastAssistant: AgentMessage | null = null;

  let streamText = "";
  let streamStartedAt: string | null = null;
  let streamSeq = 0;

  const ensureAssistantHost = (timestamp: string, sequence: number) => {
    if (lastAssistant) return lastAssistant;
    lastAssistant = {
      id: `asst:${opts?.runId ?? "run"}:artifact:${sequence}`,
      role: "assistant",
      createdAt: timestamp,
      artifacts: [],
    };
    out.push(lastAssistant);
    return lastAssistant;
  };

  const attachArtifact = (
    artifact: StoryTranscriptArtifact,
    timestamp: string,
    sequence: number
  ) => {
    artifactById.set(artifact.id, artifact);
    const host = ensureAssistantHost(timestamp, sequence);
    host.artifacts = [
      ...(host.artifacts ?? []).filter((item) => item.id !== artifact.id),
      artifact,
    ];
  };

  const flushAssistant = (kind: string, sequence: number, timestamp: string) => {
    const text = streamText.trim();
    if (!text) return;
    if (lastAssistant) {
      lastAssistant.text = lastAssistant.text ? `${lastAssistant.text.trim()}\n\n${text}` : text;
      lastAssistant.id = `asst:${opts?.runId ?? "run"}:${sequence}`;
    } else {
      lastAssistant = {
        id: `asst:${opts?.runId ?? "run"}:${sequence}`,
        role: "assistant",
        text,
        createdAt: streamStartedAt ?? timestamp,
      };
      out.push(lastAssistant);
    }
    streamText = "";
    streamStartedAt = null;
    void kind;
  };

  for (const event of sorted) {
    if (event.type === "UserMessage") {
      flushAssistant("before_user", event.sequence, event.timestamp);
      lastAssistant = null;
      const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
      const names = attachmentNamesFromEvent(event);
      if (text || names.length > 0) {
        const messageId =
          typeof event.data.messageId === "string" && event.data.messageId.trim()
            ? event.data.messageId.trim()
            : `seq-${event.sequence}`;
        out.push({
          id: `user:${opts?.runId ?? "run"}:${messageId}`,
          role: "user",
          text,
          attachmentNames: names.length > 0 ? names : undefined,
          createdAt: event.timestamp,
        });
      }
      continue;
    }

    if (event.type === "MessageDelta" && typeof event.data.delta === "string") {
      if (!streamStartedAt) streamStartedAt = event.timestamp;
      streamText += event.data.delta;
      streamSeq = event.sequence;
      continue;
    }

    if (event.type === "MessageCompleted") {
      const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
      if (!streamText.trim() && text) streamText = text;
      flushAssistant("message_completed", event.sequence, event.timestamp);
      continue;
    }

    if (event.type === "ArtifactCreated") {
      const artifactId = nonEmptyString(event.data.artifactId);
      const raw = event.data.artifact;
      if (!artifactId || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const reference = raw as Record<string, unknown>;
      if (reference.kind === "story_generation_batch") {
        const generationBatchId = nonEmptyString(reference.generationBatchId ?? reference.id);
        const storyProjectId = nonEmptyString(reference.storyProjectId ?? reference.projectId);
        const storyChapterId = nonEmptyString(reference.storyChapterId ?? reference.chapterId);
        if (!generationBatchId || !storyProjectId || !storyChapterId) continue;
        attachArtifact(
          {
            kind: "story_generation_batch",
            id: artifactId,
            generationBatchId,
            storyProjectId,
            storyChapterId,
          },
          event.timestamp,
          event.sequence
        );
        continue;
      }
      const storyAgentRunId = nonEmptyString(reference.storyAgentRunId);
      if (reference.kind !== "story_stage_proposal" || !storyAgentRunId) continue;
      const existing = [...artifactById.values()].find(
        (item) => isStoryStageProposalArtifact(item) && item.storyAgentRunId === storyAgentRunId
      );
      if (existing) {
        artifactById.set(artifactId, existing);
      } else {
        attachArtifact(
          {
            kind: "story_stage_proposal",
            id: artifactId,
            storyAgentRunId,
            status: event.data.status === "active" ? "active" : "proposed",
          },
          event.timestamp,
          event.sequence
        );
      }
      const toolCallId = nonEmptyString(event.data.toolCallId);
      if (toolCallId) {
        artifactIdByToolCall.set(toolCallId, existing?.id ?? artifactId);
      }
      continue;
    }

    if (event.type === "ToolProposed" && event.data.toolId === "story.applyProposal") {
      const toolCallId = nonEmptyString(event.data.toolCallId);
      const args = event.data.arguments;
      if (!toolCallId || !args || typeof args !== "object" || Array.isArray(args)) continue;
      const storyAgentRunId = nonEmptyString((args as Record<string, unknown>).storyAgentRunId);
      if (!storyAgentRunId) continue;
      const existing = [...artifactById.values()].find(
        (item) => isStoryStageProposalArtifact(item) && item.storyAgentRunId === storyAgentRunId
      );
      if (!existing) {
        attachArtifact(
          {
            kind: "story_stage_proposal",
            id: storyAgentRunId,
            storyAgentRunId,
            status: "proposed",
          },
          event.timestamp,
          event.sequence
        );
      }
      artifactIdByToolCall.set(toolCallId, existing?.id ?? storyAgentRunId);
      continue;
    }

    if (event.type === "ApprovalRequired") {
      const approvalId = nonEmptyString(event.data.approvalId);
      const toolCallId = nonEmptyString(event.data.toolCallId);
      const artifactId = toolCallId ? artifactIdByToolCall.get(toolCallId) : null;
      if (approvalId && artifactId) artifactIdByApproval.set(approvalId, artifactId);
      continue;
    }

    if (event.type === "ApprovalResolved") {
      const approvalId = nonEmptyString(event.data.approvalId);
      const mapped = approvalId
        ? artifactById.get(artifactIdByApproval.get(approvalId) ?? "")
        : undefined;
      const artifact =
        (mapped && isStoryStageProposalArtifact(mapped) ? mapped : undefined) ??
        [...artifactById.values()].find(
          (item) =>
            isStoryStageProposalArtifact(item) &&
            (item.status === "proposed" || item.status === "active" || item.status === "applying")
        );
      if (artifact && isStoryStageProposalArtifact(artifact)) {
        artifact.status = event.data.decision === "reject" ? "rejected" : "applying";
      }
      continue;
    }

    if (event.type === "ArtifactUpdated") {
      const artifactId = nonEmptyString(event.data.artifactId);
      const artifact = artifactId ? artifactById.get(artifactId) : undefined;
      if (
        artifact &&
        isStoryStageProposalArtifact(artifact) &&
        isArtifactStatus(event.data.status)
      ) {
        artifact.status = event.data.status;
      }
      continue;
    }

    if (event.type === "ToolStarted" || event.type === "ToolFailed") {
      const toolCallId = nonEmptyString(event.data.toolCallId);
      const artifact = toolCallId
        ? artifactById.get(artifactIdByToolCall.get(toolCallId) ?? "")
        : undefined;
      if (artifact && isStoryStageProposalArtifact(artifact)) {
        artifact.status =
          event.type === "ToolStarted"
            ? "applying"
            : event.data.code === "STORY_PROPOSAL_REJECTED"
              ? "rejected"
              : "failed";
      }
      continue;
    }

    if (event.type === "RunFailed") {
      // H5 keeps RunFailed off the transcript. Progress copy and generation
      // cards stay; the host surfaces a short failed banner instead of the
      // English diagnostic dump.
      flushAssistant("failed", event.sequence, event.timestamp);
      continue;
    }
  }

  if (streamText.trim()) {
    flushAssistant(
      "streaming",
      streamSeq || sorted.at(-1)?.sequence || 0,
      new Date().toISOString()
    );
  }

  const hasUserMessage = sorted.some((event) => event.type === "UserMessage");
  if (!hasUserMessage && (opts?.userText?.trim() || (opts?.userAttachmentNames?.length ?? 0) > 0)) {
    out.unshift({
      id: `user:${opts?.runId ?? "local"}`,
      role: "user",
      text: opts?.userText?.trim() || "",
      attachmentNames: opts?.userAttachmentNames,
      createdAt: opts?.userAt ?? new Date().toISOString(),
    });
  }

  const hitlText = opts?.hitlText?.trim();
  if (hitlText && !out.some((message) => message.role === "user" && message.text === hitlText)) {
    out.push({
      id: `user:${opts?.runId ?? "run"}:hitl`,
      role: "user",
      text: hitlText,
      createdAt: opts?.hitlAt ?? new Date().toISOString(),
    });
  }

  if (opts?.hitlDecision === "reject" || opts?.hitlDecision === "approve") {
    const nextStatus = opts.hitlDecision === "reject" ? "rejected" : "applying";
    for (const artifact of artifactById.values()) {
      if (
        isStoryStageProposalArtifact(artifact) &&
        (artifact.status === "proposed" || artifact.status === "active")
      ) {
        artifact.status = nextStatus;
      }
    }
  }

  return out;
}

/** Rebuild a thread from durable conversation history (cold start). */
export function conversationRunsToMessages(runs: AgentOsConversationRun[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const run of runs) {
    const fromEvents = eventsToMessages(run.events ?? [], { runId: run.runId });
    if (fromEvents.length) {
      messages.push(...fromEvents);
      continue;
    }
    if (run.assistantText?.trim()) {
      messages.push({
        id: `asst:${run.runId}:text`,
        role: "assistant",
        text: run.assistantText.trim(),
        createdAt: run.updatedAt,
      });
    }
  }
  return messages;
}

export function newClientUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // RFC4122-ish fallback for older JS engines.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
