import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";
const id = z.string().uuid();
export const viewFields = [
  "number",
  "status",
  "priority",
  "assignees",
  "cycle",
  "labels",
  "estimate",
  "points",
  "startAt",
  "dueAt",
  "updatedAt",
  "parent",
  "subtasks",
  "blockedBy",
] as const;
export const sortFields = [
  "rank",
  "number",
  "title",
  "status",
  "priority",
  "startAt",
  "dueAt",
  "updatedAt",
] as const;
const field = z.union([
  z.enum(viewFields),
  z
    .string()
    .regex(/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
]);
export const viewSettings = z
  .object({
    name: z.string().trim().min(1).max(80),
    layout: z.enum(["list", "board"]),
    groupBy: z.enum(["none", "status", "priority", "assignee", "cycle"]),
    filters: z
      .object({
        workflowStateIds: z.array(id).max(24).optional(),
        priorities: z
          .array(z.enum(["low", "normal", "high", "urgent"]))
          .max(4)
          .optional(),
        assigneeUserIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
        cycleIds: z.array(id).max(50).optional(),
        labelIds: z.array(id).max(50).optional(),
        unassigned: z.boolean().optional(),
        overdue: z.boolean().optional(),
      })
      .strict(),
    sorts: z
      .array(z.object({ field: z.enum(sortFields), direction: z.enum(["asc", "desc"]) }).strict())
      .max(3),
    visibleFields: z.array(field).max(30),
    completedMode: z.enum(["all", "recent", "hidden"]),
    showSubIssues: z.boolean(),
    showEmptyGroups: z.boolean(),
  })
  .strict();
export type ViewSettings = z.infer<typeof viewSettings>;
export const editableView = viewSettings
  .extend({
    id,
    crewId: z.string().min(1),
    groupBy: z
      .enum(["none", "status", "priority", "assignee", "cycle"])
      .nullable()
      .transform((v) => v ?? "none"),
    updatedAt: z.string().datetime({ offset: true }),
    isSystem: z.boolean(),
  })
  .strip();
export type EditableView = z.infer<typeof editableView>;
const named = z.object({ id, crewId: z.string(), name: z.string().min(1) });
const projectSchema = z.object({
  views: z.array(editableView),
  workflowStates: z.array(named),
  cycles: z.array(named),
  labels: z.array(named),
  fields: z.array(named),
});
export type ViewEditProject = z.infer<typeof projectSchema>;
export function settingsOf(view: EditableView): ViewSettings {
  const {
    id: _id,
    crewId: _crewId,
    updatedAt: _updatedAt,
    isSystem: _isSystem,
    ...settings
  } = view;
  return viewSettings.parse(settings);
}
export async function fetchViewEditProject(crewId: string, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const project = projectSchema.parse(
    await api.get(`/crews/${crewId}/task-project`, { service: "aurora", signal })
  );
  for (const rows of Object.values(project)) {
    if (
      rows.some((row) => row.crewId !== crewId) ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    )
      throw new Error("Task view scope mismatch");
  }
  return project;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function changedViewSettings(view: EditableView, value: ViewSettings) {
  const before = settingsOf(view),
    after = viewSettings.parse(value);
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, v]) => stable(v) !== stable(before[key as keyof ViewSettings])
    )
  ) as Partial<ViewSettings>;
}
export async function saveTaskView(
  view: EditableView,
  value: ViewSettings,
  userId: string,
  generation: number
) {
  const snapshot = editableView.parse(view);
  const changes = changedViewSettings(snapshot, value);
  const current = () => {
    if (generation !== getAuthGeneration()) throw new Error("Task view session expired");
  };
  current();
  if (!Object.keys(changes).length) return snapshot;
  const access = await fetchTaskCommentAccess(
    snapshot.crewId,
    userId,
    new AbortController().signal
  );
  current();
  if (!access.canManage) throw new Error("Task management permission is required.");
  const result = editableView.parse(
    await api.patch(`/crew-task-views/${snapshot.id}`, {
      service: "aurora",
      data: { ...changes, expectedUpdatedAt: snapshot.updatedAt },
    })
  );
  current();
  if (
    result.id !== snapshot.id ||
    result.crewId !== snapshot.crewId ||
    result.updatedAt === snapshot.updatedAt ||
    Object.entries(changes).some(
      ([key, v]) => stable(result[key as keyof EditableView]) !== stable(v)
    )
  )
    throw new Error("Task view save could not be verified. Reload before editing again.");
  return result;
}
