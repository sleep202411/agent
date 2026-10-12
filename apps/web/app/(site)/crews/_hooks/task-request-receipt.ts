export type TaskRequestReceipt = {
  code: "TASK_APPROVAL_REQUIRED";
  requestId: string;
  status: "pending" | "approved" | "rejected";
  message: string;
};
export function isTaskRequestReceipt(value: unknown): value is TaskRequestReceipt {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    value.code === "TASK_APPROVAL_REQUIRED" &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    "status" in value &&
    ["pending", "approved", "rejected"].includes(String(value.status)) &&
    "message" in value &&
    typeof value.message === "string"
  );
}
