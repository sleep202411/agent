/** Creation-only validation: persisted drafts and existing overdue tasks remain readable. */
export class TaskCreationDeadlineError extends Error {
  constructor() {
    super("Choose today or a future deadline.");
  }
}
export function assertTaskCreationDeadline(dueAt: string | null, now = Date.now()) {
  if (dueAt !== null && (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) < now))
    throw new TaskCreationDeadlineError();
}
