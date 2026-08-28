import type { AgentOsConversationRun, AgentOsEvent } from "../api/agent-os-api";
import type { MessageKey } from "@/i18n";
import type { AgentMessage, AgentPipelineCard } from "../types";

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
};

export function agentActivityLabelKey(activity: AgentOsActivityPhase): string {
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
 * Returns null once streamed assistant copy is visible (`MessageDelta`).
 */
export function deriveAgentActivity(
  events: AgentOsEvent[],
  status: string
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

  let activity: AgentOsActivityPhase = { kind: "thinking" };
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
        return null;
      case "MessageCompleted":
      case "ToolCompleted":
      case "ToolFailed":
      case "MessageStarted":
      case "RunStarted":
      case "RunResumed":
        activity = { kind: "thinking" };
        break;
      default:
        break;
    }
  }
  return activity;
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

/**
 * Fold Agent OS journal events into the Dreem-style message list used by
 * mobile thread UI. Streaming deltas coalesce into one assistant bubble per
 * open stream; tool / plan events become pipeline cards.
 */
export function eventsToMessages(
  events: AgentOsEvent[],
  opts?: { runId?: string; userText?: string; userAt?: string }
): AgentMessage[] {
  const out: AgentMessage[] = [];

  let streamText = "";
  let streamStartedAt: string | null = null;
  let streamSeq = 0;
  const cards: AgentPipelineCard[] = [];

  const flushAssistant = (kind: string, sequence: number, timestamp: string) => {
    const text = streamText.trim();
    if (!text && cards.length === 0) return;
    out.push({
      id: `asst:${opts?.runId ?? "run"}:${sequence}`,
      role: "assistant",
      text: text || undefined,
      cards: cards.length ? [...cards] : undefined,
      createdAt: streamStartedAt ?? timestamp,
    });
    streamText = "";
    streamStartedAt = null;
    cards.length = 0;
    void kind;
  };

  for (const event of events) {
    if (event.type === "UserMessage") {
      flushAssistant("before_user", event.sequence, event.timestamp);
      const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
      if (text) {
        const messageId =
          typeof event.data.messageId === "string" && event.data.messageId.trim()
            ? event.data.messageId.trim()
            : `seq-${event.sequence}`;
        out.push({
          id: `user:${opts?.runId ?? "run"}:${messageId}`,
          role: "user",
          text,
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

    if (event.type === "PlanProposed" && Array.isArray(event.data.steps)) {
      cards.push({
        id: `plan:${event.sequence}`,
        kind: "stage",
        title: (event.data.steps as string[]).join(" → "),
        detail: "plan",
      });
      continue;
    }

    if (event.type === "ToolCompleted" || event.type === "ToolStarted") {
      const toolId = typeof event.data.toolId === "string" ? event.data.toolId : "tool";
      const title =
        typeof event.data.title === "string"
          ? event.data.title
          : event.type === "ToolCompleted"
            ? `Done · ${toolId}`
            : `Running · ${toolId}`;
      cards.push({
        id: `tool:${event.sequence}`,
        kind: toolId.includes("character")
          ? "character"
          : toolId.includes("script")
            ? "script"
            : "stage",
        title,
        detail: toolId,
        actionLabel: event.type === "ToolCompleted" ? "View" : undefined,
      });
      continue;
    }

    if (event.type === "RunFailed") {
      const message = typeof event.data.message === "string" ? event.data.message : "Run failed";
      flushAssistant("failed", event.sequence, event.timestamp);
      out.push({
        id: `err:${event.sequence}`,
        role: "assistant",
        text: message,
        createdAt: event.timestamp,
      });
    }
  }

  if (streamText.trim() || cards.length) {
    flushAssistant(
      "streaming",
      streamSeq || events.at(-1)?.sequence || 0,
      new Date().toISOString()
    );
  }

  const hasUserMessage = events.some((event) => event.type === "UserMessage");
  if (!hasUserMessage && opts?.userText?.trim()) {
    out.unshift({
      id: `user:${opts?.runId ?? "local"}`,
      role: "user",
      text: opts.userText.trim(),
      createdAt: opts.userAt ?? new Date().toISOString(),
    });
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
