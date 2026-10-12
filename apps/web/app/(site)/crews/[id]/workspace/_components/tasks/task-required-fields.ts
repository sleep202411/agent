import type { CreateCrewTaskInput } from "@/app/(site)/crews/_hooks/types";

/** Drafts may be incomplete; persisted tasks need a usable production brief. */
export function missingTaskFields(input: Partial<CreateCrewTaskInput>) {
  const missing: string[] = [];
  if (!input.title?.trim()) missing.push("taskTitle");
  if (!input.taskKind) missing.push("taskKindLabel");
  if (!input.description?.trim()) missing.push("taskBrief");
  if (!input.workflowStateId) missing.push("planningState");
  const share = input.profitShareBps;
  const hasRevenueShare =
    typeof share === "number" && Number.isInteger(share) && share > 0 && share <= 10000;
  if (input.rewardUsdMinor == null && !hasRevenueShare) missing.push("requiredReward");
  if (!input.dueAt) missing.push("due");
  return missing;
}
