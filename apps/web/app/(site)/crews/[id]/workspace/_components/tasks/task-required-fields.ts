import type { CreateCrewTaskInput } from "@/app/(site)/crews/_hooks/types";

/** Drafts may be incomplete; persisted tasks need a usable production brief. */
export function missingTaskFields(input: Partial<CreateCrewTaskInput>) {
  const missing: string[] = [];
  if (!input.title?.trim()) missing.push("taskTitle");
  if (!input.taskKind) missing.push("taskKindLabel");
  if (!input.description?.trim()) missing.push("taskBrief");
  if (!input.workflowStateId) missing.push("planningState");
  if (input.rewardUsdMinor == null) missing.push("requiredReward");
  if (!input.dueAt) missing.push("due");
  return missing;
}
