import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
export function scheduleDateText(value: string | null) {
  if (!value) return "";
  const date = new Date(value),
    pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function parseScheduleDate(value: string, original: string | null) {
  // Editing priority must not round an unchanged deadline's seconds or milliseconds.
  if (value === scheduleDateText(original)) return original;
  if (!value.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid task date");
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    throw new Error("Invalid task date");
  return date.toISOString();
}
export const taskScheduleInput = z
  .object({
    expectedVersion: z.number().int().positive(),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    startAt: z.string().datetime({ offset: true }).nullable(),
    dueAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (v) => !v.startAt || !v.dueAt || new Date(v.dueAt).getTime() >= new Date(v.startAt).getTime(),
    "Task due date must be on or after its start date."
  );
export async function updateTaskSchedule(
  task: TaskDetail,
  value: z.infer<typeof taskScheduleInput>
) {
  z.string().uuid().parse(task.id);
  const data = taskScheduleInput.parse(value);
  const result = taskDetailSchema.parse(
    await api.patch(`/crew-tasks/${task.id}`, { service: "aurora", data })
  );
  const sameDate = (a: string | null, b: string | null) =>
    a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime();
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version !== data.expectedVersion + 1 ||
    result.priority !== data.priority ||
    !sameDate(result.startAt, data.startAt) ||
    !sameDate(result.dueAt, data.dueAt)
  )
    throw new Error(
      "Task schedule acknowledgement mismatch. Refresh the task before trying again."
    );
  return result;
}
