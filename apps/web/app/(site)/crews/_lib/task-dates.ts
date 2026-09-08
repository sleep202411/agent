/** Match the existing list/board deadline rule in every task view. */
export function isCrewTaskOverdue(
  task: { dueAt: string | null; status: string },
  now = Date.now()
): boolean {
  return Boolean(
    task.dueAt &&
    new Date(task.dueAt).getTime() < now &&
    task.status !== "approved" &&
    task.status !== "cancelled"
  );
}
