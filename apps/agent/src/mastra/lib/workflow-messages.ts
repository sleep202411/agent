/**
 * High-level helpers that workflows call at lifecycle boundaries. Each one
 * assembles a synthetic `tool-<name>` assistant message and writes it to
 * the chat store via chat-publisher — the existing chat WS then pushes
 * `message_added` / `message_updated` to the client.
 *
 * See packages/shared/src/workflow-messages.ts for the payload schemas
 * and the design rationale.
 */
import {
  WorkflowCompletedOutputSchema,
  WorkflowFailedOutputSchema,
  WorkflowProgressOutputSchema,
  WorkflowSuspendedOutputSchema,
  type WorkflowCompletedOutput,
  type WorkflowFailedOutput,
  type WorkflowMacroPhase,
  type WorkflowMessageToolName,
  type WorkflowName,
  type WorkflowProgressOutput,
  type WorkflowSuspendedOutput,
} from "@repo/shared";
import {
  addChatMessage,
  getChatMessage,
  updateChatMessage,
  type StoredMessage,
} from "./chat-publisher";
import { getRedis } from "./redis-client";

/**
 * Per-run hint: the most recently active sub-workflow. Worker reads this
 * on error so the failure card can surface the phase that actually blew
 * up (e.g. "storyboard_phase"), not the outer composition (main_flow)
 * — lets the retry button re-invoke only that phase instead of re-running
 * the entire pipeline from scratch.
 *
 * 24h TTL covers any reasonable workflow lifetime; longer than that and
 * we'd rather fall back to main_flow than surface a stale hint.
 */
const LAST_ACTIVE_WORKFLOW_TTL = 24 * 3600;
function lastActiveWorkflowKey(runId: string): string {
  return `workflow:run:${runId}:last_active_workflow`;
}

async function recordActiveWorkflow(runId: string, workflowName: WorkflowName): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(lastActiveWorkflowKey(runId), workflowName, "EX", LAST_ACTIVE_WORKFLOW_TTL);
  } catch {
    // Non-fatal — retry button just shows main_flow if hint isn't set.
  }
}

export async function getLastActiveWorkflow(runId: string): Promise<WorkflowName | null> {
  try {
    const redis = getRedis();
    const v = await redis.get(lastActiveWorkflowKey(runId));
    return (v as WorkflowName | null) ?? null;
  } catch {
    return null;
  }
}

// ─── Message id shapes (deterministic so publishers can idempotently
//     add-or-update) ───────────────────────────────────────────────────
//
// Every id includes `workflowName`. Without it, sub-workflows composed
// inside `main_flow` all share the parent run's `runId` and their cards
// would overwrite each other — e.g. role_phase's progress wiping
// story_outline's progress on the same `wf_{runId}_progress_planning`
// slot. Including the workflow name gives each sub-workflow its own
// row in the timeline while still letting the agent emit repeated
// updates on the same slot (same runId + workflowName + phase → update).

function progressId(runId: string, workflowName: WorkflowName, phase: WorkflowMacroPhase): string {
  return `wf_${runId}_${workflowName}_progress_${phase}`;
}
function suspendedId(runId: string, workflowName: WorkflowName): string {
  return `wf_${runId}_${workflowName}_suspended`;
}
function completedId(runId: string, workflowName: WorkflowName): string {
  return `wf_${runId}_${workflowName}_completed`;
}
function failedId(
  runId: string,
  workflowName: WorkflowName,
  terminalStatus: "failed" | "cancelled"
): string {
  return `wf_${runId}_${workflowName}_${terminalStatus}`;
}

// ─── Message assembly ────────────────────────────────────────────────

function buildMessage(
  id: string,
  toolName: WorkflowMessageToolName,
  output: unknown,
  runId: string
): StoredMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: `tool-${toolName}`,
        toolCallId: `${toolName}-${runId}`,
        input: {},
        output,
        state: "output-available",
      },
    ],
    metadata: { workflowRunId: runId },
  };
}

// ─── Public emitters ─────────────────────────────────────────────────

/**
 * Emit or mutate the progress message for a given macro-phase.
 *
 * First call for (runId, phase) → addMessage
 * Subsequent calls for same (runId, phase) → updateMessage (streaming-like)
 *
 * Crossing phases (planning → committing) should use a DIFFERENT phase
 * value; that starts a fresh message and leaves the previous phase's
 * progress frozen at its final state.
 */
export async function publishWorkflowProgress(
  projectId: string,
  runId: string,
  workflowName: WorkflowName,
  phase: WorkflowMacroPhase,
  extra: Omit<WorkflowProgressOutput, "runId" | "workflowName" | "phase">
): Promise<void> {
  await recordActiveWorkflow(runId, workflowName);
  const id = progressId(runId, workflowName, phase);
  const output = WorkflowProgressOutputSchema.parse({
    runId,
    workflowName,
    phase,
    ...extra,
  });
  const message = buildMessage(id, "workflow_progress", output, runId);
  const existing = await getChatMessage(projectId, id);
  if (existing) {
    await updateChatMessage(projectId, message);
  } else {
    await addChatMessage(projectId, message);
  }
}

export async function publishWorkflowSuspended(
  projectId: string,
  runId: string,
  workflowName: WorkflowName,
  extra: Omit<WorkflowSuspendedOutput, "runId" | "workflowName">
): Promise<void> {
  await recordActiveWorkflow(runId, workflowName);
  const output = WorkflowSuspendedOutputSchema.parse({
    runId,
    workflowName,
    ...extra,
  });
  await addChatMessage(
    projectId,
    buildMessage(suspendedId(runId, workflowName), "workflow_suspended", output, runId)
  );
}

export async function publishWorkflowCompleted(
  projectId: string,
  runId: string,
  workflowName: WorkflowName,
  extra: Omit<WorkflowCompletedOutput, "runId" | "workflowName">
): Promise<void> {
  const output = WorkflowCompletedOutputSchema.parse({
    runId,
    workflowName,
    ...extra,
  });
  await addChatMessage(
    projectId,
    buildMessage(completedId(runId, workflowName), "workflow_completed", output, runId)
  );
}

export async function publishWorkflowFailed(
  projectId: string,
  runId: string,
  workflowName: WorkflowName,
  extra: Omit<WorkflowFailedOutput, "runId" | "workflowName">
): Promise<void> {
  const output = WorkflowFailedOutputSchema.parse({
    runId,
    workflowName,
    ...extra,
  });
  await addChatMessage(
    projectId,
    buildMessage(
      failedId(runId, workflowName, output.terminalStatus),
      "workflow_failed",
      output,
      runId
    )
  );
}
