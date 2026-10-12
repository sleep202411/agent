/** Drafts remain readable while the current server requires a complete production brief. */
export class TaskCreationRequiredError extends Error {}
export function assertTaskCreationRequired(input: {
  description: string;
  taskKind?: string | null;
  dueAt: string | null;
  rewardUsdMinor?: number | null;
  profitShareBps?: number | null;
}) {
  const share = input.profitShareBps;
  const hasRevenueShare =
    typeof share === "number" && Number.isInteger(share) && share > 0 && share <= 10000;
  const missing = [
    !input.description.trim() && "description",
    !input.taskKind && "task type",
    !input.dueAt && "deadline",
    input.rewardUsdMinor == null && !hasRevenueShare && "cash reward or profit share",
  ].filter(Boolean);
  if (missing.length)
    throw new TaskCreationRequiredError(
      `Complete the required task fields: ${missing.join(", ")}.`
    );
}
