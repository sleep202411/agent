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
