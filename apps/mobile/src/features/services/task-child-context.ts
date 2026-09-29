import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
import { taskWorkflowSchema } from "./task-workflow-api";
export async function fetchTaskChildContext(task: TaskDetail, signal: AbortSignal) {
  z.string().uuid().parse(task.id);
  const parent = taskDetailSchema
    .extend({ workflowStateId: z.string().uuid(), workflowState: taskWorkflowSchema })
    .parse(await api.get(`/crew-tasks/${task.id}`, { service: "aurora", signal }));
  if (
    parent.id !== task.id ||
    parent.crewId !== task.crewId ||
    parent.version !== task.version ||
    parent.workflowStateId !== parent.workflowState.id ||
    parent.workflowState.crewId !== parent.crewId ||
    parent.workflowState.semantic !== parent.status ||
    ["approved", "cancelled"].includes(parent.status)
  )
    throw new Error("Parent task changed. Refresh before creating a subtask.");
  return {
    parent,
    workflow:
      !parent.workflowState.archived &&
      ["open", "in_progress", "revision_requested"].includes(parent.status)
        ? parent.workflowState
        : undefined,
  };
}
