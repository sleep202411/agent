import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskWorkflowSchema, type TaskWorkflow } from "./task-workflow-api";
import type { PlanningOption } from "./task-planning-api";
const id = z.string().uuid();
const projectSchema = z.object({
  views: z.array(
    z.object({
      id,
      crewId: z.string(),
      filters: z.object({
        cycleIds: z.array(id).optional(),
        workflowStateIds: z.array(id).optional(),
      }),
    })
  ),
  cycles: z.array(
    z.object({
      id,
      crewId: z.string(),
      name: z.string().min(1),
      status: z.enum(["planned", "active", "completed", "cancelled"]),
    })
  ),
  workflowStates: z.array(taskWorkflowSchema.extend({ systemKey: z.string().nullable() })),
});
export type TaskCreationDefaults = { cycle: PlanningOption | null; workflow: TaskWorkflow | null };
export async function fetchTaskCreationDefaults(
  crewId: string,
  viewId: string | undefined,
  presetWorkflowId: string | undefined,
  signal: AbortSignal
): Promise<TaskCreationDefaults> {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  if (viewId) id.parse(viewId);
  if (presetWorkflowId) id.parse(presetWorkflowId);
  const project = projectSchema.parse(
    await api.get(`/crews/${crewId}/task-project`, {
      service: "aurora",
      signal,
    })
  );
  for (const rows of [project.views, project.cycles, project.workflowStates]) {
    if (
      rows.some((row) => row.crewId !== crewId) ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    )
      throw new Error("Task creation context scope mismatch");
  }
  const view = project.views.find((row) => row.id === viewId) ?? project.views[0];
  const cycleIds = view?.filters.cycleIds ?? [];
  const cycle =
    (cycleIds.length === 1
      ? project.cycles.find((row) => row.id === cycleIds[0] && row.status !== "cancelled")
      : undefined) ??
    project.cycles.find((row) => row.status === "active") ??
    null;
  // Approval and submission require their dedicated server workflows.
  const states = project.workflowStates.filter(
    (row) => !row.archived && ["open", "in_progress", "revision_requested"].includes(row.semantic)
  );
  const workflowIds = view?.filters.workflowStateIds ?? [];
  const workflow =
    states.find((row) => row.id === presetWorkflowId) ??
    (workflowIds.length === 1 ? states.find((row) => row.id === workflowIds[0]) : undefined) ??
    states.find((row) => row.systemKey === "open") ??
    states[0] ??
    null;
  return { cycle: cycle ? { id: cycle.id, name: cycle.name } : null, workflow };
}
