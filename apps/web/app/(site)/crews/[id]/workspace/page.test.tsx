// @vitest-environment jsdom

/**
 * The 群聊 tab has to be reachable the same way every other tab is:
 * through `?tab=`. R0 made the workspace URL-driven precisely so crew
 * notifications could deeplink into a tab and a pasted link would
 * reopen where the sender was — a chat tab held in component state
 * would be invisible to both and would reset on every notification
 * jump.
 *
 * These drive the real page: click the nav, read what it wrote to the
 * URL, feed that back in, and check which pane mounted.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CrewWorkspacePage from "./page";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { CrewApiError } from "@/app/(site)/crews/_hooks/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({
  search: new URLSearchParams(),
  replaced: [] as string[],
}));

const state = vi.hoisted(() => ({
  viewer: null as unknown,
  crewDetail: {
    id: "crew_1",
    name: "Night Shift",
    description: "",
    logo: null,
    founderId: "1",
    listingStatus: "unlisted",
    showcaseWorks: [],
  } as Record<string, unknown> | null,
  detailLoading: false,
  detailError: null as Error | null,
  detailFetching: false,
  detailRefetches: 0,
  membersLoading: false,
  membersError: null as Error | null,
  membersFetching: false,
  membersRefetches: 0,
  chatThread: { isError: false } as { isError: boolean },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "crew_1" }),
  usePathname: () => "/crews/crew_1/workspace",
  useSearchParams: () => nav.search,
  useRouter: () => ({
    replace: (url: string) => {
      nav.replaced.push(url);
      nav.search = new URLSearchParams(url.split("?")[1] ?? "");
    },
    push: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Real en-US copy, so a tab label that never landed in the message
// files shows up as a bare `tabChat` and fails the queries below.
vi.mock("@/src/i18n/i18n", async () => {
  const messages = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, string | number>) =>
      Object.entries(vars ?? {}).reduce<string>(
        (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
        messages[ns]?.[key] ?? key
      ),
    useLocale: () => "en-US",
  };
});

vi.mock("@/src/env", () => ({ env: { BANNER_BASE_URL: "https://banner.test", OSS_BASE_URL: "" } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useCrewDetail: () => ({
    data: state.crewDetail,
    isLoading: state.detailLoading,
    isError: state.detailError !== null,
    error: state.detailError,
    isFetching: state.detailFetching,
    refetch: () => {
      state.detailRefetches += 1;
      return Promise.resolve();
    },
  }),
  useCrewMembers: () => ({
    data: [],
    isLoading: state.membersLoading,
    isError: state.membersError !== null,
    error: state.membersError,
    isFetching: state.membersFetching,
    refetch: () => {
      state.membersRefetches += 1;
      return Promise.resolve();
    },
  }),
  useCrewPositions: () => ({ data: [] }),
  useCrewApplications: () => ({ data: [] }),
  useUpdateCrewListing: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/app/(site)/crews/_hooks/use-user-crew-role", () => ({
  useUserCrewRole: () => state.viewer,
}));

vi.mock("@/app/(site)/crews/_hooks/use-anchor-deeplink", () => ({
  useAnchorDeeplink: () => {},
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_hooks/use-anchor-deeplink", () => ({
  useAnchorDeeplink: () => {},
}));

// The page resolves the crew's conversation itself, because whether it
// resolves decides where a bare workspace URL lands.
vi.mock("@/app/(site)/crews/[id]/workspace/_hooks/use-crew-conversation", () => ({
  useCrewConversation: () => state.chatThread,
}));

// Panes and dialogs are stubbed: this suite is about which one mounts,
// not what each renders.
vi.mock("@/app/(site)/crews/[id]/workspace/_components/chat/crew-chat-tab", () => ({
  CrewChatTab: ({ crewId }: { crewId: string }) => <div data-pane="chat">chat:{crewId}</div>,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/episodes/episodes-tab", () => ({
  EpisodesTab: () => <div data-pane="episodes">episodes</div>,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/assets/crew-assets-tab", () => ({
  CrewAssetsTab: () => <div data-pane="assets">assets</div>,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/members/members-grid", () => ({
  MembersGrid: () => <div data-pane="members">members</div>,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/positions/positions-grid", () => ({
  PositionsGrid: () => <div data-pane="roles">roles</div>,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/positions/position-card", () => ({
  PositionCard: () => null,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/positions/position-detail-sheet", () => ({
  PositionDetailSheet: () => null,
}));
vi.mock("@/app/(site)/crews/_components/dev-identity-switcher", () => ({
  DevIdentitySwitcher: () => null,
}));
vi.mock("@/app/(site)/crews/_components/add-member-dialog", () => ({
  AddCrewMemberDialog: () => null,
}));
vi.mock("@/app/(site)/crews/_components/application-review-dialog", () => ({
  ApplicationReviewDialog: () => null,
}));
vi.mock("@/app/(site)/crews/_components/create-crew-dialog", () => ({
  CreateCrewDialog: () => null,
}));
vi.mock("@/app/(site)/crews/_components/create-crew-job-dialog", () => ({
  CreateCrewJobDialog: () => null,
}));

const MEMBER: UserCrewRole = {
  role: "member",
  effectiveUserId: "7",
  effectiveName: "Ada",
  isAdmin: false,
  isFinance: false,
  isMember: true,
};

const OUTSIDER: UserCrewRole = {
  role: "outsider",
  isAdmin: false,
  isFinance: false,
  isMember: false,
};

let root: Root | null = null;
let container: HTMLElement | null = null;

function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<CrewWorkspacePage />));
}

/** Re-mount against whatever the router wrote to the URL — a reload. */
function reload() {
  act(() => root!.render(<CrewWorkspacePage />));
}

function pane(): string | null {
  const el = document.querySelector("[data-pane]");
  return el?.getAttribute("data-pane") ?? null;
}

function tabButton(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("nav button")].find(
    (b) => b.textContent?.trim() === label
  );
  if (!match) throw new Error(`no tab labelled "${label}" (saw: ${navLabels().join(", ")})`);
  return match as HTMLButtonElement;
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match as HTMLButtonElement;
}

function navLabels(): string[] {
  return [...document.querySelectorAll("nav button")].map((b) => b.textContent?.trim() ?? "");
}

/** The nav marks the selected tab with the brand accent. */
function activeTabLabel(): string | null {
  const match = [...document.querySelectorAll("nav button")].find((b) =>
    b.className.includes("text-primary")
  );
  return match?.textContent?.trim() ?? null;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  nav.search = new URLSearchParams();
  nav.replaced = [];
  state.viewer = MEMBER;
  state.crewDetail = {
    id: "crew_1",
    name: "Night Shift",
    description: "",
    logo: null,
    founderId: "1",
    listingStatus: "unlisted",
    showcaseWorks: [],
  };
  state.detailLoading = false;
  state.detailError = null;
  state.detailFetching = false;
  state.detailRefetches = 0;
  state.membersLoading = false;
  state.membersError = null;
  state.membersFetching = false;
  state.membersRefetches = 0;
  state.chatThread = { isError: false };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("crew workspace tabs", () => {
  it("opens a bare workspace URL on the group chat, rewriting nothing", () => {
    render();
    expect(pane()).toBe("chat");
    expect(nav.replaced).toEqual([]);
    // Doc §4 order, with the member-only asset center in the primary rail.
    expect(navLabels()).toEqual([
      "Group Chat",
      "Production",
      "Asset Center",
      "Members",
      "Positions",
      "Basic Info",
    ]);
  });

  it("round-trips the chat tab through ?tab=", () => {
    nav.search = new URLSearchParams("tab=members");
    render();
    expect(pane()).toBe("members");

    // Every tab spells itself out, chat included — the bare URL means
    // "open this workspace", which is not the same instruction.
    click(tabButton("Group Chat"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=chat");
    reload();
    expect(pane()).toBe("chat");

    click(tabButton("Production"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=episodes");
    reload();
    expect(pane()).toBe("episodes");
  });

  it("opens the asset center through its shareable URL", () => {
    nav.search = new URLSearchParams("tab=members");
    render();

    click(tabButton("Asset Center"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=assets");
    reload();
    expect(pane()).toBe("assets");
  });

  it("keeps a deeplink's episode params while switching to chat and back", () => {
    nav.search = new URLSearchParams("tab=episodes&episode=ep_42&assignment=as_7");
    render();
    expect(pane()).toBe("episodes");

    click(tabButton("Group Chat"));
    expect(nav.replaced.at(-1)).toBe(
      "/crews/crew_1/workspace?tab=chat&episode=ep_42&assignment=as_7"
    );
    reload();
    expect(pane()).toBe("chat");
  });

  it("gives an outsider an explicit member-only state", () => {
    state.viewer = OUTSIDER;
    nav.search = new URLSearchParams("tab=chat");
    render();

    expect(document.body.textContent).toContain("This workspace is for crew members");
    expect(document.body.textContent).toContain("View public crew page");
    expect(navLabels()).not.toContain("Group Chat");
    expect(pane()).toBeNull();
    expect(activeTabLabel()).toBeNull();
  });

  it("bounds the page to the viewport on chat, and only on chat", () => {
    // Doc §9: 群聊输入框在桌面和移动端都固定可达. The chat pane is
    // `h-full`, which resolves to nothing unless an ancestor chain
    // gives it a height — on a `min-h-screen` page the composer lands
    // below the fold and the reader has to scroll to type.
    render();
    const shell = () => container!.firstElementChild as HTMLElement;
    expect(shell().className).toContain("h-[calc(100dvh-4rem)]");
    expect(shell().className).not.toContain("min-h-screen");

    click(tabButton("Production"));
    reload();
    expect(shell().className).toContain("min-h-screen");
    expect(shell().className).not.toContain("h-[calc(100dvh-4rem)]");
  });

  it("waits for the roster before deciding the tab set", () => {
    // Membership decides whether chat exists. Rendering the page before
    // `useCrewMembers` resolves would classify every member an outsider
    // for a frame and bounce them off their own group chat.
    state.viewer = OUTSIDER;
    state.membersLoading = true;
    render();
    expect(pane()).toBeNull();
    expect(navLabels()).toEqual([]);
  });
});

describe("crew workspace entry states", () => {
  it("shows a terminal member-only state instead of spinning on 403", () => {
    state.membersError = new CrewApiError(403, {
      message: "You must be a member to view this",
    });

    render();

    expect(document.body.textContent).toContain("This workspace is for crew members");
    expect(document.body.textContent).toContain("View public crew page");
    expect(document.body.textContent).toContain("Back to Crew Hall");
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(navLabels()).toEqual([]);
    expect(pane()).toBeNull();
  });

  it("shows a not-found state when the crew detail resolves to null", () => {
    state.crewDetail = null;

    render();

    expect(document.body.textContent).toContain("Crew not found");
    expect(document.body.textContent).toContain("Back to Crew Hall");
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("surfaces the server error and retries a failed roster read", () => {
    state.membersError = new CrewApiError(503, {
      message: "Roster database unavailable",
    });

    render();

    expect(document.body.textContent).toContain("Roster database unavailable");
    click(button("Retry"));
    expect(state.membersRefetches).toBe(1);
  });
});

/**
 * Chat is the default landing tab, and the endpoint behind it can fail:
 * a crew whose conversation row was never opened, a 5xx, a member the
 * server no longer recognises. "Default" must therefore mean "chat when
 * chat works", not "chat and an error card otherwise" — a member who
 * merely opened the workspace has asked for nothing and is owed a
 * usable page.
 */
describe("crew workspace with an unresolvable chat thread", () => {
  beforeEach(() => {
    state.chatThread = { isError: true };
  });

  it("lands a member on a usable workspace instead of an error card", () => {
    render();

    expect(pane()).not.toBe("chat");
    expect(activeTabLabel()).toBe("Basic Info");
    // The whole workspace is still there: the tab is not removed, the
    // member is still entitled to it, and every other surface works.
    expect(navLabels()).toEqual([
      "Group Chat",
      "Production",
      "Asset Center",
      "Members",
      "Positions",
      "Basic Info",
    ]);
    click(tabButton("Production"));
    reload();
    expect(pane()).toBe("episodes");
  });

  it("stamps the demotion into the URL so a late success cannot yank the reader away", () => {
    render();

    // The bare URL still means "chat if you can", so leaving it there
    // would flip the page to chat the moment a background refetch
    // succeeded — mid-read, without being asked.
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=overview");
    state.chatThread = { isError: false };
    reload();
    expect(pane()).not.toBe("chat");
    expect(activeTabLabel()).toBe("Basic Info");
  });

  it("still opens the chat pane when the member asks for it by name", () => {
    // The pane prints the server's own words and offers a retry
    // (`crew-chat-tab.test.tsx`). Bouncing the click elsewhere would
    // leave the 群聊 button looking broken and the reason unread.
    render();
    click(tabButton("Group Chat"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=chat");
    reload();
    expect(pane()).toBe("chat");
  });

  it("does not demote while the resolve is still in flight", () => {
    // A pending query is not a failed one; treating it as one would
    // bounce every cold load off the chat before it could open.
    state.chatThread = { isError: false };
    render();
    expect(pane()).toBe("chat");
    expect(nav.replaced).toEqual([]);
  });
});
