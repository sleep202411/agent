/** Seeded names follow server tasks/task-defaults.ts; custom names are user content. */
const defaultNames: Record<string, string> = {
  backlog: "Backlog",
  open: "To do",
  in_progress: "In progress",
  submitted: "In review",
  revision_requested: "Changes requested",
  approved: "Completed",
  cancelled: "Cancelled",
};

export function workflowStateLabel(
  state: { systemKey?: string | null; name: string },
  t: (key: string) => string
): string {
  const key = state.systemKey;
  // A system key defines behavior, not an immutable display name. Translate
  // untouched seeded names only; never replace an owner's saved rename.
  if (!key || state.name !== defaultNames[key]) return state.name;
  return t(key === "backlog" ? "backlog" : `status.${key}`);
}
