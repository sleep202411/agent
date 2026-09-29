import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
const value = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export const customField = z.object({
  id: z.string().uuid(),
  crewId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["text", "number", "date", "checkbox", "single_select", "multi_select", "user"]),
  options: z.array(z.object({ id: z.string().min(1), label: z.string() })),
});
export type CustomField = z.infer<typeof customField>;
export type CustomValue = z.infer<typeof value>;
export async function fetchTaskCustomFields(task: TaskDetail, signal: AbortSignal) {
  z.string().uuid().parse(task.id);
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(task.crewId);
  const [project, snapshot] = await Promise.all([
    api.get(`/crews/${encodeURIComponent(task.crewId)}/task-project`, {
      service: "aurora",
      signal,
    }),
    api.get(`/crew-tasks/${task.id}`, { service: "aurora", signal }),
  ]);
  const { fields } = z.object({ fields: z.array(customField) }).parse(project);
  const detail = taskDetailSchema
    .extend({ customFieldValues: z.array(z.object({ fieldId: z.string().uuid(), value })) })
    .parse(snapshot);
  if (
    detail.id !== task.id ||
    detail.crewId !== task.crewId ||
    detail.version !== task.version ||
    fields.some(
      (f) =>
        f.crewId !== task.crewId || new Set(f.options.map((o) => o.id)).size !== f.options.length
    ) ||
    new Set(fields.map((f) => f.id)).size !== fields.length ||
    new Set(detail.customFieldValues.map((v) => v.fieldId)).size !== detail.customFieldValues.length
  )
    throw new Error("Task custom fields changed. Refresh the task.");
  return fields.map((field) => ({
    field,
    value: detail.customFieldValues.find((v) => v.fieldId === field.id)?.value,
  }));
}
export function customFieldText(
  field: CustomField,
  value: CustomValue | undefined,
  labels: { unset: string; yes: string; no: string },
  users?: Map<string, { nickname: string }>
) {
  if (value == null) return labels.unset;
  if (field.type === "checkbox" && typeof value === "boolean")
    return value ? labels.yes : labels.no;
  if (field.type === "user" && typeof value === "string")
    return users?.get(value)?.nickname || value;
  const option = (id: string) => field.options.find((o) => o.id === id)?.label ?? id;
  if (field.type === "single_select" && typeof value === "string") return option(value);
  if (Array.isArray(value)) return value.map(option).join(", ") || labels.unset;
  // Date-only values stay date-only: no timezone conversion can move their day.
  return String(value);
}
