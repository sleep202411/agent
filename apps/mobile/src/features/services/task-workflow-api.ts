import { z } from "zod";
import { api } from "@/lib/api-client";
export const taskWorkflowSchema = z.object({
  id: z.string().uuid(),
  crewId: z.string().min(1),
  name: z.string().min(1),
  semantic: z.enum([
    "open",
    "in_progress",
    "submitted",
    "revision_requested",
    "approved",
    "cancelled",
  ]),
  archived: z.boolean(),
});
export type TaskWorkflow = z.infer<typeof taskWorkflowSchema>;
export async function fetchManualTaskWorkflows(crewId: string, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const result = z.object({ workflowStates: z.array(taskWorkflowSchema) }).parse(
    await api.get(`/crews/${encodeURIComponent(crewId)}/task-project`, {
      service: "aurora",
      signal,
    })
  );
  const states = result.workflowStates;
  if (
    states.some((state) => state.crewId !== crewId) ||
    new Set(states.map((state) => state.id)).size !== states.length
  )
    throw new Error("Task workflow scope mismatch");
  return states.filter(
    (state) =>
      !state.archived && ["open", "in_progress", "revision_requested"].includes(state.semantic)
  );
}
