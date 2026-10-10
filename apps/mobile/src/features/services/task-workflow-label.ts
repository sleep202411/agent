import type { MessageKey } from "@/i18n";

// System keys control behavior. Only untouched server seed names are localized.
const defaultNames: Record<string, string> = {
  backlog: "Backlog",
  open: "To do",
  in_progress: "In progress",
  submitted: "In review",
  revision_requested: "Changes requested",
  approved: "Completed",
  cancelled: "Cancelled",
};
export function taskWorkflowLabel(
  state: { name: string; systemKey?: string | null },
  t: (key: MessageKey) => string
) {
  const key = state.systemKey;
  if (!key || !Object.hasOwn(defaultNames, key) || state.name !== defaultNames[key])
    return state.name;
  return t(`taskWorkflowLabel.${key}` as MessageKey);
}
