import { z } from "zod";
export const taskRequestReceipt = z.object({
  code: z.literal("TASK_APPROVAL_REQUIRED"),
  requestId: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected"]),
  message: z.string(),
});
export type TaskRequestReceipt = z.infer<typeof taskRequestReceipt>;
export function isTaskRequestReceipt(value: unknown): value is TaskRequestReceipt {
  return taskRequestReceipt.safeParse(value).success;
}
