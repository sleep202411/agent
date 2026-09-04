import type { AgentOsActivityPhase, AgentOsSessionStatus } from "./use-agent-os-run";

export type AgentOsActivityLabelKey =
  | "thinking"
  | "planning"
  | "waitingForInput"
  | "waitingForApproval"
  | "readingProject"
  | "updatingProject"
  | "readingStory"
  | "confirmingCreativeDirection"
  | "preparingStoryDraft"
  | "updatingStory"
  | "designingBranches"
  | "writingScenes"
  | "readingCanvas"
  | "updatingCanvas"
  | "readingSource"
  | "savingSource"
  | "readingCharacters"
  | "updatingCharacters"
  | "readingStoryboard"
  | "updatingStoryboard";

export interface AgentOsActivityStatus {
  label: string;
  /** Waiting is blocked on the creator and must not use a working spinner. */
  mode?: "working" | "waiting";
  /** Protocol turn receiving this one live status. */
  turnId?: string | null;
  /** Agent run correlation when the host knows it directly. */
  runId?: string | null;
  /** External job correlation for domain-owned activity such as Story authoring. */
  externalJobId?: string | null;
}

const TERMINAL_STATUSES: ReadonlySet<AgentOsSessionStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Reconcile the protocol-owned activity with an optional domain host label.
 * Host copy is accepted only when it proves that it belongs to this run (or
 * its current external job), then it is pinned to the protocol's active turn.
 * This prevents a late Story query response from animating a completed run or
 * appearing beneath a newer/older chat turn.
 */
export function resolveAgentOsActivityStatus(input: {
  status: AgentOsSessionStatus;
  runId: string | null;
  activeTurnId: string | null;
  pendingExternalJobId: string | null;
  host: AgentOsActivityStatus | null;
  derived: AgentOsActivityStatus | null;
}): AgentOsActivityStatus | null {
  if (TERMINAL_STATUSES.has(input.status)) return null;

  const host = input.host;
  if (host && input.runId && input.activeTurnId) {
    const hasCorrelation = Boolean(host.runId || host.externalJobId);
    const runMatches = !host.runId || host.runId === input.runId;
    const externalJobMatches =
      !host.externalJobId || host.externalJobId === input.pendingExternalJobId;
    const turnMatches = !host.turnId || host.turnId === input.activeTurnId;
    if (hasCorrelation && runMatches && externalJobMatches && turnMatches) {
      return {
        ...host,
        runId: input.runId,
        turnId: input.activeTurnId,
      };
    }
  }

  const derived = input.derived;
  if (!derived) return null;
  if (derived.runId && derived.runId !== input.runId) return null;
  if (derived.turnId && input.activeTurnId && derived.turnId !== input.activeTurnId) return null;
  return {
    ...derived,
    runId: input.runId,
    turnId: input.activeTurnId ?? derived.turnId ?? null,
  };
}

const TOOL_LABELS: Readonly<Record<string, AgentOsActivityLabelKey>> = {
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
  "story.storyboard.read": "readingStoryboard",
  "story.storyboard.putTimeline": "updatingStoryboard",
  "story.storyboard.patchClip": "updatingStoryboard",
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

export function agentActivityLabelKey(activity: AgentOsActivityPhase): AgentOsActivityLabelKey {
  if (activity.kind === "thinking") return "thinking";
  if (activity.kind === "planning") return "planning";
  if (activity.kind === "waiting_for_input") return "waitingForInput";
  if (activity.kind === "waiting_for_approval") return "waitingForApproval";
  const exact = TOOL_LABELS[activity.toolId];
  if (exact) return exact;
  return /(?:^|\.)(?:read|list|get|search|inspect)/i.test(activity.toolId)
    ? "readingProject"
    : "updatingProject";
}
