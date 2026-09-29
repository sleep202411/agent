import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
const assignee = z.object({
  userId: z.string().trim().min(1).max(64),
  currency: z.enum(["CNY", "USD"]),
  rewardAmountMinor: z.number().int().min(1).max(10_000_000_000).nullable(),
});
const snapshotSchema = taskDetailSchema.extend({
  assignees: z.array(assignee.extend({ id: z.string().uuid() })),
});
export type AssignmentSnapshot = z.infer<typeof snapshotSchema>;
export const assignmentInput = z
  .object({
    expectedVersion: z.number().int().positive(),
    assignees: z
      .array(assignee.strict())
      .max(30)
      .refine(
        (items) => new Set(items.map((a) => a.userId)).size === items.length,
        "Duplicate task assignees"
      ),
  })
  .strict();
export function parseTaskReward(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid reward amount");
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor < 1n || minor > 10_000_000_000n) throw new Error("Invalid reward amount");
  return Number(minor);
}
export function taskRewardText(value: number | null): string {
  return value === null ? "" : `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
export async function fetchTaskAssignments(task: TaskDetail, signal: AbortSignal) {
  z.string().uuid().parse(task.id);
  const result = snapshotSchema.parse(
    await api.get(`/crew-tasks/${task.id}`, { service: "aurora", signal })
  );
  if (result.id !== task.id || result.crewId !== task.crewId || result.version !== task.version)
    throw new Error("Task changed. Refresh before editing assignments.");
  return result;
}
export async function updateTaskAssignments(
  task: AssignmentSnapshot,
  input: z.infer<typeof assignmentInput>
) {
  z.string().uuid().parse(task.id);
  const data = assignmentInput.parse(input);
  const result = snapshotSchema.parse(
    await api.patch(`/crew-tasks/${task.id}`, { service: "aurora", data })
  );
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version !== data.expectedVersion + 1 ||
    result.assignees.length !== data.assignees.length ||
    data.assignees.some(
      (a) =>
        !result.assignees.some(
          (item) =>
            item.userId === a.userId &&
            item.currency === a.currency &&
            item.rewardAmountMinor === a.rewardAmountMinor
        )
    )
  )
    throw new Error("Assignment acknowledgement mismatch. Refresh the task before trying again.");
  return result;
}
