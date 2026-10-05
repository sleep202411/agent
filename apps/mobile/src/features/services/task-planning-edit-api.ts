import type { TaskPaymentTerms } from "@repo/shared/crew";
import { requiredSkillsSchema, sameSkills } from "./crew-skills-api";
import { taskCompensationShape } from "./task-compensation";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
import { taskKindSchema, type TaskKind } from "./task-kind-api";
import type { TaskPlanningDraft } from "./task-planning-fields";
const ref = z.object({ id: z.string().uuid(), name: z.string().min(1) });
const planningSnapshotSchema = taskDetailSchema
  .extend({
    taskKind: taskKindSchema.nullable(),
    estimatePoints: z.number().int().min(0).max(1_000_000).nullable(),
    cycleId: z.string().uuid().nullable(),
    cycle: ref.nullable(),
    episodeId: z.string().uuid().nullable(),
    episode: z
      .object({
        id: z.string().uuid(),
        number: z.number().int().positive(),
        title: z.string().min(1),
      })
      .nullable(),
  })
  .refine(
    (task) =>
      task.cycleId === (task.cycle?.id ?? null) && task.episodeId === (task.episode?.id ?? null),
    "Task planning reference mismatch"
  );
export type PlanningSnapshot = z.infer<typeof planningSnapshotSchema>;
export const planningEditInput = z
  .object({
    ...taskCompensationShape,
    contractAssetNodeId: z.string().uuid().nullable().optional(),
    requiredSkills: requiredSkillsSchema.optional(),
    positionRole: z.string().trim().min(1).max(80).nullable().optional(),
    taskKind: taskKindSchema.nullable().optional(),
    expectedVersion: z.number().int().positive(),
    estimatePoints: z.number().int().min(0).max(1_000_000).nullable().optional(),
    revisionLimit: z.number().int().min(0).max(100).nullable().optional(),
    cycleId: z.string().uuid().nullable().optional(),
    episodeId: z.string().uuid().nullable().optional(),
    labelIds: z
      .array(z.string().uuid())
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate labels")
      .optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.contractAssetNodeId !== undefined ||
      data.requiredSkills !== undefined ||
      data.positionRole !== undefined ||
      data.paymentTerms !== undefined ||
      data.rewardUsdMinor !== undefined ||
      data.profitShareBps !== undefined ||
      data.estimatePoints !== undefined ||
      data.revisionLimit !== undefined ||
      data.taskKind !== undefined ||
      data.cycleId !== undefined ||
      data.episodeId !== undefined ||
      data.labelIds !== undefined,
    "No planning changes"
  );
export function planningDraft(task: PlanningSnapshot): TaskPlanningDraft {
  return {
    labels: task.labels,
    cycle: task.cycle,
    episode: task.episode
      ? { id: task.episode.id, name: `${task.episode.number} · ${task.episode.title}` }
      : null,
  };
}
export function planningChanges(
  task: PlanningSnapshot,
  draft: TaskPlanningDraft,
  taskKind: TaskKind | null = task.taskKind,
  values: {
    contractAssetNodeId?: string | null;
    requiredSkills?: string[];
    positionRole?: string | null;
    estimatePoints: number | null;
    revisionLimit: number | null;
    paymentTerms?: TaskPaymentTerms | null;
    rewardUsdMinor?: number | null;
    profitShareBps?: number | null;
  } = {
    estimatePoints: task.estimatePoints,
    revisionLimit: task.revisionLimit,
  }
) {
  const cycleId = draft.cycle?.id ?? null,
    episodeId = draft.episode?.id ?? null;
  const ids = draft.labels.map((label) => label.id);
  return planningEditInput
    .refine(
      (value) =>
        !task.contractAssetNodeId ||
        value.contractAssetNodeId === undefined ||
        value.contractAssetNodeId === task.contractAssetNodeId,
      "Attached contracts cannot be replaced or removed"
    )
    .refine(
      (value) => value.revisionLimit == null || value.revisionLimit >= task.revisionRoundsUsed,
      "Revision limit is below used rounds"
    )
    .safeParse({
      expectedVersion: task.version,
      ...(values.paymentTerms !== undefined && values.paymentTerms !== (task.paymentTerms ?? null)
        ? { paymentTerms: values.paymentTerms }
        : {}),
      ...(values.contractAssetNodeId !== undefined &&
      values.contractAssetNodeId !== (task.contractAssetNodeId ?? null)
        ? { contractAssetNodeId: values.contractAssetNodeId }
        : {}),
      ...(values.requiredSkills !== undefined &&
      !sameSkills(values.requiredSkills, task.requiredSkills)
        ? { requiredSkills: values.requiredSkills }
        : {}),
      ...(values.positionRole !== undefined && values.positionRole !== (task.positionRole ?? null)
        ? { positionRole: values.positionRole }
        : {}),
      ...(values.rewardUsdMinor !== undefined &&
      values.rewardUsdMinor !== (task.rewardUsdMinor ?? null)
        ? { rewardUsdMinor: values.rewardUsdMinor }
        : {}),
      ...(values.profitShareBps !== undefined &&
      values.profitShareBps !== (task.profitShareBps ?? null)
        ? { profitShareBps: values.profitShareBps }
        : {}),
      ...(values.estimatePoints !== task.estimatePoints
        ? { estimatePoints: values.estimatePoints }
        : {}),
      ...(values.revisionLimit !== task.revisionLimit
        ? { revisionLimit: values.revisionLimit }
        : {}),
      ...(taskKind !== task.taskKind ? { taskKind } : {}),
      ...(cycleId !== task.cycleId ? { cycleId } : {}),
      ...(episodeId !== task.episodeId ? { episodeId } : {}),
      ...(ids.length !== task.labels.length ||
      ids.some((id) => !task.labels.some((label) => label.id === id))
        ? { labelIds: ids }
        : {}),
    });
}
export async function fetchTaskPlanning(task: TaskDetail, signal: AbortSignal) {
  z.string().uuid().parse(task.id);
  const result = planningSnapshotSchema.parse(
    await api.get(`/crew-tasks/${task.id}`, { service: "aurora", signal })
  );
  if (result.id !== task.id || result.crewId !== task.crewId || result.version !== task.version)
    throw new Error("Task changed. Refresh before editing planning.");
  return result;
}
export async function updateTaskPlanning(
  task: PlanningSnapshot,
  value: z.infer<typeof planningEditInput>
) {
  z.string().uuid().parse(task.id);
  const data = planningEditInput.parse(value);
  if (
    task.contractAssetNodeId &&
    data.contractAssetNodeId !== undefined &&
    data.contractAssetNodeId !== task.contractAssetNodeId
  )
    throw new Error("Attached contracts cannot be replaced or removed");
  if (data.expectedVersion !== task.version) throw new Error("Task planning version mismatch");
  if (data.revisionLimit != null && data.revisionLimit < task.revisionRoundsUsed)
    throw new Error("Revision limit is below used rounds");
  const result = planningSnapshotSchema.parse(
    await api.patch(`/crew-tasks/${task.id}`, { service: "aurora", data })
  );
  const cycleId = data.cycleId === undefined ? task.cycleId : data.cycleId;
  const episodeId = data.episodeId === undefined ? task.episodeId : data.episodeId;
  const labels = data.labelIds ?? task.labels.map((label) => label.id);
  if (
    (result.contractAssetNodeId ?? null) !==
      (data.contractAssetNodeId === undefined
        ? (task.contractAssetNodeId ?? null)
        : data.contractAssetNodeId) ||
    !sameSkills(result.requiredSkills, data.requiredSkills ?? task.requiredSkills) ||
    (result.positionRole ?? null) !==
      (data.positionRole === undefined ? (task.positionRole ?? null) : data.positionRole) ||
    (result.paymentTerms ?? null) !==
      (data.paymentTerms === undefined ? (task.paymentTerms ?? null) : data.paymentTerms) ||
    result.rewardUsdMinor !==
      (data.rewardUsdMinor === undefined ? task.rewardUsdMinor : data.rewardUsdMinor) ||
    result.profitShareBps !==
      (data.profitShareBps === undefined ? task.profitShareBps : data.profitShareBps) ||
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version !== data.expectedVersion + 1 ||
    result.taskKind !== (data.taskKind === undefined ? task.taskKind : data.taskKind) ||
    result.estimatePoints !==
      (data.estimatePoints === undefined ? task.estimatePoints : data.estimatePoints) ||
    result.revisionLimit !==
      (data.revisionLimit === undefined ? task.revisionLimit : data.revisionLimit) ||
    result.cycleId !== cycleId ||
    result.episodeId !== episodeId ||
    result.labels.length !== labels.length ||
    labels.some((id) => !result.labels.some((label) => label.id === id))
  )
    throw new Error("Planning acknowledgement mismatch. Refresh the task before trying again.");
  return result;
}
