/** Crew management opens on asset-based tasks; explicit deep links remain authoritative. */

export type WorkspaceTabId =
  | "chat"
  | "tasks"
  | "income"
  | "assets"
  | "members"
  | "roles"
  | "overview";

export interface WorkspaceTab {
  id: WorkspaceTabId;
  labelKey: string;
  /** Hidden from, and unreachable by, anyone who is not in the crew. */
  membersOnly: boolean;
}

export const WORKSPACE_TABS = [
  { id: "tasks", labelKey: "tabTasks", membersOnly: true },
  { id: "roles", labelKey: "tabRecruitment", membersOnly: false },
  { id: "income", labelKey: "tabIncome", membersOnly: true },
  { id: "chat", labelKey: "tabChat", membersOnly: true },
  { id: "assets", labelKey: "tabAssets", membersOnly: true },
  { id: "members", labelKey: "tabMembers", membersOnly: false },
  { id: "overview", labelKey: "tabOverview", membersOnly: false },
] as const satisfies readonly WorkspaceTab[];

/** Tab a bare `/crews/{id}/workspace` opens on. */
export const DEFAULT_WORKSPACE_TAB: WorkspaceTabId = "tasks";

/** Where the landing goes instead when the default cannot be delivered. */
export const FALLBACK_WORKSPACE_TAB: WorkspaceTabId = "overview";

/** Membership controls access; chat availability never changes the landing. */
export interface ChatAvailability {
  entitled: boolean;
  reachable?: boolean;
}

export function isWorkspaceTabId(value: unknown): value is WorkspaceTabId {
  return WORKSPACE_TABS.some((tab) => tab.id === value);
}

/** The nav's rendered entries for this viewer. */
export function workspaceTabsFor(canAccessChat: boolean): readonly WorkspaceTab[] {
  return WORKSPACE_TABS.filter((tab) => canAccessChat || !tab.membersOnly);
}

/**
 * Resolve `?tab=` into a tab id.
 *
 * A named tab is honoured: it is a choice the reader made, and the only
 * override is entitlement (a members-only tab demotes for anyone
 * outside the crew, so the UI never renders a pane that can only 403).
 *
 * Anything else — no `?tab=`, an empty one, a spelling from an outdated
 * link — is a landing rather than a choice, and lands on the default
 * only while the default can be delivered.
 */
export function resolveWorkspaceTab(
  value: string | null | undefined,
  chat: ChatAvailability
): WorkspaceTabId {
  if (isWorkspaceTabId(value)) {
    const tab = WORKSPACE_TABS.find((t) => t.id === value);
    if (tab?.membersOnly && !chat.entitled) return FALLBACK_WORKSPACE_TAB;
    return value;
  }
  return chat.entitled ? DEFAULT_WORKSPACE_TAB : FALLBACK_WORKSPACE_TAB;
}

/** Preserve explicit tab selection and remove unrelated entity deep links. */
export function applyWorkspaceTab(params: URLSearchParams, tab: WorkspaceTabId): void {
  params.set("tab", tab);
  if (tab !== "tasks") {
    params.delete("task");
    params.delete("comment");
  }
  if (tab !== "assets") params.delete("asset");
}
