import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_TAB,
  FALLBACK_WORKSPACE_TAB,
  WORKSPACE_TABS,
  applyWorkspaceTab,
  isWorkspaceTabId,
  resolveWorkspaceTab,
  workspaceTabsFor,
} from "./workspace-tabs";

/** A member whose group chat opens — the ordinary case. */
const OPEN = { entitled: true, reachable: true };

/**
 * `?tab=` is a wire contract: the server puts it in crew notification
 * deeplinks (`/crews/{id}/workspace?tab=episodes&episode={id}`), so the
 * spellings below are not free to change without changing the emitter.
 */
describe("resolveWorkspaceTab", () => {
  it.each(WORKSPACE_TABS.map((tab) => tab.id))("seeds the workspace on ?tab=%s", (id) => {
    expect(resolveWorkspaceTab(id, OPEN)).toBe(id);
  });

  it("seeds the episodes tab from the notification deeplink", () => {
    const params = new URLSearchParams("tab=episodes&episode=ep_42&assignment=as_7");
    expect(resolveWorkspaceTab(params.get("tab"), OPEN)).toBe("episodes");
  });

  it.each([null, undefined, "", "Episodes", "finance", "__proto__"])(
    "treats %o as a landing rather than a choice",
    (value) => {
      expect(resolveWorkspaceTab(value, OPEN)).toBe(DEFAULT_WORKSPACE_TAB);
    }
  );

  it("defaults to the group chat", () => {
    // Doc §4: 群聊 默认进入 — the crew's day-to-day is the conversation.
    expect(DEFAULT_WORKSPACE_TAB).toBe("chat");
  });
});

/**
 * Doc §7 gives 非成员 no read and no write on the group chat. The server
 * enforces that; these keep the UI from handing an outsider a tab whose
 * only possible outcome is a 403 — including via the default, which is
 * itself the members-only tab.
 */
describe("chat is members-only", () => {
  const OUTSIDER = { entitled: false, reachable: true };

  it("lands an outsider on the overview instead of the chat default", () => {
    expect(resolveWorkspaceTab(null, OUTSIDER)).toBe(FALLBACK_WORKSPACE_TAB);
  });

  it("refuses a hand-typed ?tab=chat from an outsider", () => {
    expect(resolveWorkspaceTab("chat", OUTSIDER)).toBe(FALLBACK_WORKSPACE_TAB);
  });

  it("leaves every other tab reachable by an outsider", () => {
    for (const tab of WORKSPACE_TABS.filter((t) => !t.membersOnly)) {
      expect(resolveWorkspaceTab(tab.id, OUTSIDER)).toBe(tab.id);
    }
  });

  it("hides the chat entry from the nav for an outsider", () => {
    expect(workspaceTabsFor(false).map((t) => t.id)).toEqual([
      "episodes",
      "members",
      "roles",
      "overview",
    ]);
    expect(workspaceTabsFor(true).map((t) => t.id)).toEqual([
      "chat",
      "episodes",
      "assets",
      "members",
      "roles",
      "overview",
    ]);
  });
});

/**
 * Being in the crew is not the same as the crew's chat being openable.
 * A conversation row that was never created, or a 5xx from the resolve,
 * leaves an entitled member with a pane that can only render an error —
 * fine when they asked for it, wrong as the first thing the workspace
 * shows them.
 */
describe("chat that will not open", () => {
  const BROKEN = { entitled: true, reachable: false };

  it("lands on the overview instead of an error card", () => {
    expect(resolveWorkspaceTab(null, BROKEN)).toBe(FALLBACK_WORKSPACE_TAB);
  });

  it("still opens the chat pane when the member asks for it by name", () => {
    // The pane owns the failure: it prints the server's own words and
    // offers a retry. Bouncing the click somewhere else would leave the
    // 群聊 button looking broken and the reason unread.
    expect(resolveWorkspaceTab("chat", BROKEN)).toBe("chat");
  });

  it("leaves every other tab alone", () => {
    for (const tab of WORKSPACE_TABS.filter((t) => t.id !== "chat")) {
      expect(resolveWorkspaceTab(tab.id, BROKEN)).toBe(tab.id);
    }
  });

  it("does not treat a resolve still in flight as a failure", () => {
    // `reachable` flips only once the query has actually errored;
    // pessimism here would bounce every cold load off the chat.
    expect(resolveWorkspaceTab(null, { entitled: true, reachable: true })).toBe("chat");
  });
});

/**
 * The nav writes the tab into the URL and a reload reads it back. If
 * the two halves ever disagree, clicking a tab would leave the reader
 * on a different one than the one they clicked.
 */
describe("?tab= round-trip", () => {
  it.each(WORKSPACE_TABS.map((tab) => tab.id))("survives a write/read cycle for %s", (id) => {
    const params = new URLSearchParams();
    applyWorkspaceTab(params, id);
    expect(resolveWorkspaceTab(params.get("tab"), OPEN)).toBe(id);
  });

  it("spells the chat tab out rather than leaving it implicit", () => {
    // The bare URL means "open this workspace", which is chat only
    // while chat opens. If the 群聊 button wrote the bare URL, clicking
    // it during an outage would resolve straight back to the overview —
    // a button that visibly does nothing.
    const params = new URLSearchParams("tab=episodes&episode=ep_42");
    applyWorkspaceTab(params, "chat");
    expect(params.get("tab")).toBe("chat");
    expect(resolveWorkspaceTab(params.get("tab"), { entitled: true, reachable: false })).toBe(
      "chat"
    );
    // Deeplink params riding alongside are not the tab's to discard.
    expect(params.get("episode")).toBe("ep_42");
  });

  it("replaces a previous tab rather than appending one", () => {
    const params = new URLSearchParams("tab=members");
    applyWorkspaceTab(params, "roles");
    expect(params.toString()).toBe("tab=roles");
  });
});

describe("isWorkspaceTabId", () => {
  it("accepts only the six rendered tabs, in doc §4 order", () => {
    // 群聊 / 剧集制作 / 资产中心 / 成员 / 招募 / 概览.
    expect(WORKSPACE_TABS.map((tab) => tab.id)).toEqual([
      "chat",
      "episodes",
      "assets",
      "members",
      "roles",
      "overview",
    ]);
    expect(isWorkspaceTabId("chat")).toBe(true);
    expect(isWorkspaceTabId("episodes")).toBe(true);
    expect(isWorkspaceTabId("assets")).toBe(true);
    expect(isWorkspaceTabId("files")).toBe(false);
    expect(isWorkspaceTabId("revenue")).toBe(false);
    expect(isWorkspaceTabId(undefined)).toBe(false);
  });
});
