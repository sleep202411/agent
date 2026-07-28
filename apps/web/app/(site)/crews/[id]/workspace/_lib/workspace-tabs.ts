/**
 * The workspace tab set, and the `?tab=` URL contract that selects one.
 *
 * The active tab is URL state rather than component state because crew
 * notifications deeplink into a specific tab
 * (`/crews/{id}/workspace?tab=episodes&episode={id}`). Keeping the id
 * list and its validator here — free of React and of the icon imports —
 * means the nav renderer and the deeplink reader agree on exactly one
 * spelling, and the validator is testable on its own.
 *
 * Order and default come from the product doc §4: 群聊 / 剧集制作 /
 * 资产中心 / 成员 / 招募 / 概览, chat first and entered by default, because
 * the crew's day-to-day is the conversation and everything else is a
 * surface you go looking for. The asset center is members-only because
 * its folder tree, previews, and access rules expose production files.
 *
 * Two things can make the chat default undeliverable, and they are not
 * the same thing:
 *
 *   - The viewer is not in the crew. Doc §7 gives 非成员 no read and no
 *     write on the group chat, so the tab is hidden and unreachable —
 *     the server enforces the same rule and this keeps the UI from
 *     lying about it.
 *   - The viewer is in the crew but the conversation will not resolve —
 *     a crew whose chat row has not been opened yet, or a 5xx. The tab
 *     stays, because the member is entitled to it, but it stops being
 *     what a bare workspace URL opens on. Landing every member of a
 *     crew on an error card is a worse first frame than landing them on
 *     the overview they can actually read.
 *
 * Both degrade to `FALLBACK_WORKSPACE_TAB`, and only for the landing —
 * asking for chat by name (`?tab=chat`, or the nav button, which now
 * spells it out) always renders the chat pane, error and retry
 * included. Someone who clicked 群聊 is owed the reason it will not
 * open, not a silent bounce to another tab.
 */

export interface WorkspaceTab {
  id: WorkspaceTabId;
  labelKey: string;
  /** Hidden from, and unreachable by, anyone who is not in the crew. */
  membersOnly: boolean;
}

export const WORKSPACE_TABS = [
  { id: "chat", labelKey: "tabChat", membersOnly: true },
  { id: "episodes", labelKey: "tabEpisodes", membersOnly: false },
  { id: "assets", labelKey: "tabAssets", membersOnly: true },
  { id: "members", labelKey: "tabMembers", membersOnly: false },
  { id: "roles", labelKey: "tabRecruitment", membersOnly: false },
  { id: "overview", labelKey: "tabOverview", membersOnly: false },
] as const satisfies readonly WorkspaceTab[];

export type WorkspaceTabId = "chat" | "episodes" | "assets" | "members" | "roles" | "overview";

/** Tab a bare `/crews/{id}/workspace` opens on. */
export const DEFAULT_WORKSPACE_TAB: WorkspaceTabId = "chat";

/** Where the landing goes instead when the default cannot be delivered. */
export const FALLBACK_WORKSPACE_TAB: WorkspaceTabId = "overview";

/** What the workspace knows about the viewer's group chat right now. */
export interface ChatAvailability {
  /** The viewer is in the crew, so the tab exists for them at all. */
  entitled: boolean;
  /**
   * The crew's conversation resolved. Pass `false` only once the
   * resolve has actually failed — a resolve still in flight is not a
   * failure, and treating it as one would bounce every cold load off
   * the chat before it had a chance to open.
   */
  reachable: boolean;
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
  return chat.entitled && chat.reachable ? DEFAULT_WORKSPACE_TAB : FALLBACK_WORKSPACE_TAB;
}

/**
 * Write the selected tab back into the query string, in place.
 *
 * Every tab spells itself out, chat included. The bare URL is not "the
 * chat tab", it is "open this workspace wherever it makes sense to open
 * it" — which is chat when chat works and the overview when it does
 * not. Collapsing the two would make the 群聊 nav button write a URL
 * that resolves to the overview whenever the conversation is down, i.e.
 * a button that does nothing.
 *
 * Deeplink params riding alongside (`episode`, `assignment`,
 * `application`) are not this function's to discard.
 */
export function applyWorkspaceTab(params: URLSearchParams, tab: WorkspaceTabId): void {
  params.set("tab", tab);
}
