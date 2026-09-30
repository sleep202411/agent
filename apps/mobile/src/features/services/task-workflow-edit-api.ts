import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
import { taskWorkflowSchema, type TaskWorkflow } from "./task-workflow-api";
const snapshotSchema = taskDetailSchema
  .extend({ workflowStateId: z.string().uuid(), workflowState: taskWorkflowSchema })
  .refine(
    (task) =>
      task.workflowState.id === task.workflowStateId &&
      task.workflowState.crewId === task.crewId &&
      task.workflowState.semantic === task.status,
    "Task workflow reference mismatch"
  );
export type WorkflowSnapshot = z.infer<typeof snapshotSchema>;
export const workflowMoveInput = z
  .object({ expectedVersion: z.number().int().positive(), workflowStateId: z.string().uuid() })
  .strict();
const movable = (status: string) => ["open", "in_progress", "revision_requested"].includes(status);
export async function fetchTaskWorkflow(task: TaskDetail, signal: AbortSignal) {
  z.string().uuid().parse(task.id);
  const result = snapshotSchema.parse(
    await api.get(`/crew-tasks/${task.id}`, { service: "aurora", signal })
  );
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version !== task.version ||
    !movable(result.status)
  )
    throw new Error("Task changed. Refresh before moving its workflow column.");
  return result;
}
export async function moveTaskWorkflow(task: WorkflowSnapshot, selected: TaskWorkflow) {
  z.string().uuid().parse(task.id);
  const target = taskWorkflowSchema.parse(selected);
  if (
    !movable(task.status) ||
    !movable(target.semantic) ||
    target.archived ||
    target.crewId !== task.crewId ||
    target.id === task.workflowStateId
  )
    throw new Error("This workflow move is unavailable. Refresh the task.");
  const data = workflowMoveInput.parse({
    expectedVersion: task.version,
    workflowStateId: target.id,
  });
  const result = snapshotSchema.parse(
    await api.patch(`/crew-tasks/${task.id}`, { service: "aurora", data })
  );
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version !== task.version + 1 ||
    result.workflowStateId !== target.id ||
    result.status !== target.semantic
  )
    throw new Error("Workflow acknowledgement mismatch. Refresh the task before trying again.");
  return result;
}
