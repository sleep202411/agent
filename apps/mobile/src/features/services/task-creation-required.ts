/** Drafts remain readable while the current server requires a complete production brief. */
export class TaskCreationRequiredError extends Error {}
export function assertTaskCreationRequired(input: {
  description: string;
  taskKind?: string | null;
  dueAt: string | null;
  rewardUsdMinor?: number | null;
}) {
  const missing = [
    !input.description.trim() && "description",
    !input.taskKind && "task type",
    !input.dueAt && "deadline",
    input.rewardUsdMinor == null && "reward amount (zero is allowed)",
  ].filter(Boolean);
  if (missing.length)
    throw new TaskCreationRequiredError(
      `Complete the required task fields: ${missing.join(", ")}.`
    );
}
