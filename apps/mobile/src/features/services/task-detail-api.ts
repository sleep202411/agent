import { requiredSkillsSchema } from "./crew-skills-api";
import { taskCompensationShape } from "./task-compensation";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskSubmission } from "./task-delivery-api";
import { taskKindSchema } from "./task-kind-api";
import { taskOption } from "./task-options";
const date = z.string().datetime({ offset: true }).nullable();
export const taskReference = taskOption.extend({
  status: z.string().min(1),
  workflowState: z.object({ name: z.string().min(1), systemKey: z.string().nullish() }),
  parentId: z.string().uuid().nullable(),
});
export const taskDetailSchema = taskOption.extend({
  ...taskCompensationShape,
  contractAssetNodeId: z.string().uuid().nullable().optional(),
  requiredSkills: requiredSkillsSchema.optional(),
  positionRole: z.string().trim().min(1).max(80).nullable().optional(),
  taskKind: taskKindSchema.nullable().optional(),
  estimatePoints: z.number().int().min(0).max(1_000_000).nullable().optional(),
  crewId: z.string().min(1),
  description: z.string(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  submissions: z.array(taskSubmission),
  parent: taskReference.nullable(),
  children: z.array(taskReference),
  blockedBy: z.array(taskReference.extend({ resolved: z.boolean() })),
  blocking: z.array(taskReference),
  version: z.number().int().positive(),
  status: z.string().min(1),
  revisionLimit: z.number().int().nonnegative().nullable(),
  revisionRoundsUsed: z.number().int().nonnegative(),
  storyboardClipId: z.string().nullable().optional(),
  workflowState: z.object({ name: z.string().min(1), systemKey: z.string().nullish() }),
  startAt: date,
  dueAt: date,
  labels: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  assignees: z.array(z.object({ id: z.string().uuid(), userId: z.string().min(1) })),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export async function fetchTaskDetail(crewId: string, taskId: string, signal: AbortSignal) {
  z.string().min(1).max(64).parse(crewId);
  z.string().uuid().parse(taskId);
  const result = taskDetailSchema.parse(
    await api.get(`/crew-tasks/${encodeURIComponent(taskId)}`, { service: "aurora", signal })
  );
  if (result.id !== taskId || result.crewId !== crewId) throw new Error("Task scope mismatch");
  return result;
}
