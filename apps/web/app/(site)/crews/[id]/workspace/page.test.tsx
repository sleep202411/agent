vi.mock("@/app/(site)/crews/_components/crew-unread-marker", () => ({
  CrewUnreadMarker: () => null,
}));
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CrewWorkspacePage from "@/app/(crew-workspace)/crews/[id]/workspace/page";
import type { UserCrewPermissions } from "@/app/(site)/crews/_hooks/use-crew-permissions";
import { CrewApiError } from "@/app/(site)/crews/_hooks/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({
  locale: "en-US",
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
    ownerUserId: "1",
    listingStatus: "unlisted",
    showcaseWorks: [],
  } as Record<string, unknown> | null,
  detailLoading: false,
  detailError: null as Error | null,
  detailFetching: false,
  detailRefetches: 0,
  membersRefetchError: false,
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

// The workbench header renders the Studio workspace link picker, whose
// viewer identity and options query are out of scope for these URL/tab
// routing tests.
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: "viewer" }, isLoading: false }),
}));
vi.mock(
  "@/app/(site)/crews/[id]/workspace/_components/workbench/crew-studio-workspace-picker",
  () => ({
    // Structural stand-in: the header keeps this affordance mounted across
    // surface switches — asserted below by its aria-label.
    CrewStudioWorkspacePicker: () => <button aria-label="Link workspace" />,
  })
);

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
    useLocale: () => nav.locale,
  };
});

vi.mock("@/src/env", () => ({
  env: {
    BANNER_BASE_URL: "https://banner.test",
    OSS_BASE_URL: "",
    STUDIO_HOST: "studio.example.test",
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useMyCrews: () => ({
    data: {
      founded: state.crewDetail ? [state.crewDetail] : [],
      joined: [],
    },
    isPending: false,
    isError: false,
    error: null,
  }),
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
    isRefetchError: state.membersRefetchError,
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

vi.mock("@/app/(site)/crews/_hooks/use-production", () => ({
  useCrewProductionOverview: () => ({
    data: { studioProject: null, capabilities: { manage: true } },
  }),
}));

vi.mock("@/app/(site)/crews/_hooks/use-crew-permissions", () => ({
  useCrewPermissions: () => state.viewer,
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

vi.mock(
  "@/app/(site)/crews/[id]/workspace/_components/workbench/crew-studio-workspace-picker",
  () => ({
    CrewStudioWorkspacePicker: () => <button aria-label="Link workspace">Link workspace</button>,
  })
);

// Panes and dialogs are stubbed: this suite is about which one mounts,
// not what each renders.
vi.mock("@/app/(site)/crews/[id]/workspace/_components/chat/crew-chat-tab", () => ({
  CrewChatTab: ({ crewId }: { crewId: string }) => <div data-pane="chat">chat:{crewId}</div>,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/tasks/crew-tasks-tab", () => ({
  CrewTasksTab: ({
    deeplinkTaskId,
    onSelectedTaskChange,
  }: {
    deeplinkTaskId?: string | null;
    onSelectedTaskChange?: (taskId: string | null) => void;
  }) => (
    <div data-pane="tasks" data-deeplink-task-id={deeplinkTaskId ?? ""}>
      tasks
      {deeplinkTaskId ? (
        <button type="button" onClick={() => onSelectedTaskChange?.(null)}>
          Close mocked task
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/income/crew-income-tab", () => ({
  CrewIncomeTab: () => <div data-pane="income">income</div>,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/assets/crew-assets-tab", () => ({
  CrewAssetsTab: ({
    initialAssetId,
    onSelectedAssetChange,
  }: {
    initialAssetId?: string | null;
    onSelectedAssetChange?: (assetId: string | null) => void;
  }) => (
    <div data-pane="assets" data-initial-asset-id={initialAssetId ?? ""}>
      assets
      {initialAssetId ? (
        <button type="button" onClick={() => onSelectedAssetChange?.(null)}>
          Close mocked asset
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/transfers/crew-transfer-center", () => ({
  CrewTransfersProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_components/members/members-grid", () => ({
  MembersGrid: ({ initialAgreementId }: { initialAgreementId?: string | null }) => (
    <div data-pane="members" data-initial-agreement-id={initialAgreementId ?? ""}>
      members
    </div>
  ),
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
vi.mock("@/components/notifications/bell-button", () => ({
  BellButton: () => <button type="button" aria-label="Notifications" />,
}));

const MEMBER: UserCrewPermissions = {
  effectiveUserId: "7",
  effectiveName: "Ada",
  isMember: true,
  isOwner: false,
  policyKeys: [],
  permissions: ["members.view", "tasks.view"],
  can: (permission) => permission === "members.view" || permission === "tasks.view",
};

const OUTSIDER: UserCrewPermissions = {
  isMember: false,
  isOwner: false,
  policyKeys: [],
  permissions: [],
  can: () => false,
};

let root: Root | null = null;
let container: HTMLElement | null = null;

function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mount();
}

/** Re-mount against whatever the router wrote to the URL — a reload. */
function reload() {
  mount();
}

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <CrewWorkspacePage />
      </QueryClientProvider>
    )
  );
}

function pane(): string | null {
  const el = document.querySelector("[data-pane]");
  return el?.getAttribute("data-pane") ?? null;
}

function tabButton(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("nav button")].find(
    (b) => b.getAttribute("aria-label") === label
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
  return [...document.querySelectorAll("nav button")]
    .map((b) => b.getAttribute("aria-label"))
    .filter((label): label is string => Boolean(label));
}

/** The nav marks the selected tab with the brand accent. */
function activeTabLabel(): string | null {
  const match = document.querySelector('nav button[aria-current="page"]');
  return match?.getAttribute("aria-label") ?? null;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  nav.locale = "en-US";
  nav.search = new URLSearchParams();
  nav.replaced = [];
  state.viewer = MEMBER;
  state.crewDetail = {
    id: "crew_1",
    name: "Night Shift",
    description: "",
    logo: null,
    ownerUserId: "1",
    listingStatus: "unlisted",
    showcaseWorks: [],
  };
  state.detailLoading = false;
  state.detailError = null;
  state.detailFetching = false;
  state.detailRefetches = 0;
  state.membersRefetchError = false;
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
  it("keeps one crew header and workspace action mounted while switching surfaces", () => {
    render();
    const header = document.querySelector('header[aria-label="Crew header"]');
    expect(header).not.toBeNull();

    for (const label of [
      "Tasks",
      "Finance",
      "Asset Center",
      "Members",
      "Positions",
      "Basic Info",
      "Team chat",
    ]) {
      click(tabButton(label));
      reload();
      expect(document.querySelectorAll('header[aria-label="Crew header"]')).toHaveLength(1);
      expect(document.querySelector('header[aria-label="Crew header"]')).toBe(header);
      expect(header?.textContent).toContain(label);
      expect(document.querySelectorAll('button[aria-label="Link workspace"]')).toHaveLength(1);
    }
  });

  it("opens a bare workspace URL on Tasks, rewriting nothing", () => {
    render();
    expect(pane()).toBe("tasks");
    expect(nav.replaced).toEqual([]);
    // Pax: asset-based Tasks, Positions and Finance precede chat.
    expect(navLabels()).toEqual([
      "Basic Info",
      "Tasks",
      "Positions",
      "Finance",
      "Team chat",
      "Fans",
      "Asset Center",
      "Members",
    ]);
  });

  it("round-trips the chat tab through ?tab=", () => {
    nav.search = new URLSearchParams("tab=members");
    render();
    expect(pane()).toBe("members");

    // Every tab spells itself out, chat included — the bare URL means
    // "open this workspace", which is not the same instruction.
    click(tabButton("Team chat"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=chat");
    reload();
    expect(pane()).toBe("chat");

    click(tabButton("Tasks"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=tasks");
    reload();
    expect(pane()).toBe("tasks");
  });

  it("opens the asset center through its shareable URL", () => {
    nav.search = new URLSearchParams("tab=members");
    render();

    click(tabButton("Asset Center"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=assets");
    reload();
    expect(pane()).toBe("assets");
  });

  it("opens the member income ledger through its shareable URL", () => {
    nav.search = new URLSearchParams("tab=tasks");
    render();

    click(tabButton("Finance"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=income");
    reload();
    expect(pane()).toBe("income");
  });

  it("passes a chat attachment deeplink through to the asset center", () => {
    nav.search = new URLSearchParams("tab=assets&asset=asset-from-chat");

    render();

    expect(pane()).toBe("assets");
    expect(
      document.querySelector("[data-pane='assets']")?.getAttribute("data-initial-asset-id")
    ).toBe("asset-from-chat");
  });

  it("clears a consumed asset deeplink when the preview closes", () => {
    nav.search = new URLSearchParams("tab=assets&asset=asset-from-chat");
    render();

    click(button("Close mocked asset"));

    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=assets");
  });

  it("passes an agreement notification deeplink to the members surface", () => {
    nav.search = new URLSearchParams("tab=members&agreement=agreement_42");

    render();

    expect(pane()).toBe("members");
    expect(
      document.querySelector("[data-pane='members']")?.getAttribute("data-initial-agreement-id")
    ).toBe("agreement_42");
  });

  it("removes a task deeplink when leaving the task surface", () => {
    nav.search = new URLSearchParams("tab=tasks&task=task_42");
    render();
    expect(pane()).toBe("tasks");
    expect(
      document.querySelector("[data-pane='tasks']")?.getAttribute("data-deeplink-task-id")
    ).toBe("task_42");

    click(tabButton("Team chat"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=chat");
    reload();
    expect(pane()).toBe("chat");
  });

  it("clears a consumed task deeplink when task details close", () => {
    nav.search = new URLSearchParams("tab=tasks&task=task_42&comment=comment_9");
    render();

    click(button("Close mocked task"));

    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=tasks");
  });

  it("gives an outsider an explicit member-only state", () => {
    state.viewer = OUTSIDER;
    nav.search = new URLSearchParams("tab=chat");
    render();

    expect(document.body.textContent).toContain("This workspace is for crew members");
    expect(document.body.textContent).toContain("View public crew page");
    expect(navLabels()).not.toContain("Team chat");
    expect(pane()).toBeNull();
    expect(activeTabLabel()).toBeNull();
  });

  it("keeps every workbench surface inside the viewport shell", () => {
    // The dedicated workbench route owns the viewport for every tab.
    // Individual panels scroll internally, so chat composers, review
    // controls and upload status all remain reachable.
    render();
    const shell = () => container!.firstElementChild as HTMLElement;
    expect(shell().className).toContain("h-dvh");
    expect(shell().className).not.toContain("min-h-screen");

    click(tabButton("Tasks"));
    reload();
    expect(shell().className).toContain("h-dvh");
    expect(shell().className).not.toContain("min-h-screen");
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

/** Chat outages and recovery must not change the task workbench landing. */
describe("crew workspace with an unresolvable chat thread", () => {
  beforeEach(() => {
    state.chatThread = { isError: true };
  });

  it("lands a member on a usable workspace instead of an error card", () => {
    render();

    expect(pane()).not.toBe("chat");
    expect(activeTabLabel()).toBe("Tasks");
    // The whole workspace is still there: the tab is not removed, the
    // member is still entitled to it, and every other surface works.
    expect(navLabels()).toEqual([
      "Basic Info",
      "Tasks",
      "Positions",
      "Finance",
      "Team chat",
      "Fans",
      "Asset Center",
      "Members",
    ]);
    click(tabButton("Tasks"));
    reload();
    expect(pane()).toBe("tasks");
  });

  it("keeps Tasks stable when chat recovers without rewriting the URL", () => {
    render();

    // Recovery cannot change an implicit Tasks landing or rewrite its URL.
    expect(nav.replaced).toEqual([]);
    state.chatThread = { isError: false };
    reload();
    expect(pane()).not.toBe("chat");
    expect(activeTabLabel()).toBe("Tasks");
  });

  it("still opens the chat pane when the member asks for it by name", () => {
    // The pane prints the server's own words and offers a retry
    // (`crew-chat-tab.test.tsx`). Bouncing the click elsewhere would
    // leave the 群聊 button looking broken and the reason unread.
    render();
    click(tabButton("Team chat"));
    expect(nav.replaced.at(-1)).toBe("/crews/crew_1/workspace?tab=chat");
    reload();
    expect(pane()).toBe("chat");
  });

  it("does not demote while the resolve is still in flight", () => {
    // A pending query is not a failed one; treating it as one would
    // bounce every cold load off the chat before it could open.
    state.chatThread = { isError: false };
    render();
    expect(pane()).toBe("tasks");
    expect(nav.replaced).toEqual([]);
  });
});

it.each(["detail", "members"] as const)(
  "preserves the mounted workspace on transient %s refresh failure",
  (source) => {
    nav.search = new URLSearchParams("tab=tasks");
    render();
    const original = document.querySelector("[data-pane]");
    expect(original).not.toBeNull();
    if (source === "detail")
      state.detailError = new CrewApiError(503, { message: "Refresh offline" });
    else {
      state.membersError = new CrewApiError(503, { message: "Refresh offline" });
      state.membersRefetchError = true;
    }
    reload();
    expect(document.querySelector("[data-pane]")).toBe(original);
    expect(document.body.textContent).toContain("Refresh offline");
    click(button("Retry"));
    expect(source === "detail" ? state.detailRefetches : state.membersRefetches).toBe(1);
  }
);

it("still removes cached workspace content when access is denied during refresh", () => {
  nav.search = new URLSearchParams("tab=tasks");
  render();
  state.membersError = new CrewApiError(403, { message: "Access revoked" });
  state.membersRefetchError = true;
  reload();
  expect(pane()).toBeNull();
  expect(document.body.textContent).toContain("This workspace is for crew members");
});

it.each(["en-US", "zh-CN", "zh-HK"])(
  "preserves %s on denied-workspace recovery links",
  (locale) => {
    nav.locale = locale;
    state.viewer = OUTSIDER;
    state.membersError = new CrewApiError(403, { message: "Membership required" });
    render();
    const links = Array.from(document.querySelectorAll("a"));
    expect(
      links.find((link) => link.textContent === "Back to Crew Hall")?.getAttribute("href")
    ).toBe(`/${locale}/crews`);
    expect(
      links.find((link) => link.textContent === "View public crew page")?.getAttribute("href")
    ).toBe(`/${locale}/crews/crew_1`);
  }
);
