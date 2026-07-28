// @vitest-environment jsdom

/**
 * The notification landing. A founder gets "member submitted EP03"
 * while EP05 is the current episode, clicks, and has to arrive at
 * something they can act on: the deliverable in front of them and the
 * approve / reject buttons under it. Both live in the accordion body,
 * so "the board expanded the right episode" is not a detail of the
 * implementation — it is the whole feature.
 *
 * Rendered for real from `EpisodesBoard` down (accordion item, episode
 * brief, assignment table, activity log); only the crew data hooks and
 * the crew API are stubbed.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Episode, EpisodeAssignment } from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { EpisodesBoard } from "./episodes-board";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom ships no layout, hence no `scrollIntoView`. */
Element.prototype.scrollIntoView = function scrollIntoView() {};

const state = vi.hoisted(() => ({
  assignmentsByEpisode: {} as Record<string, unknown[]>,
  myAssignments: [] as unknown[],
  myAssignmentsError: null as Error | null,
  myAssignmentsLoading: false,
  refetchMyAssignments: vi.fn(),
  assignmentQueryEnables: [] as Array<{ episodeId: string; enabled: boolean }>,
  noop: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null },
}));

vi.mock("@/app/(site)/crews/_hooks/use-episodes", () => ({
  useMyCrewAssignments: () => ({
    data: state.myAssignmentsError ? undefined : state.myAssignments,
    isLoading: state.myAssignmentsLoading,
    isError: !!state.myAssignmentsError,
    error: state.myAssignmentsError,
    refetch: state.refetchMyAssignments,
  }),
  useEpisodeAssignments: (_crewId: string, episodeId: string, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled ?? true;
    state.assignmentQueryEnables.push({ episodeId, enabled });
    return {
      data: enabled ? (state.assignmentsByEpisode[episodeId] ?? []) : undefined,
      isLoading: false,
      isError: false,
      isSuccess: enabled,
    };
  },
  useEpisodeActivity: () => ({ data: [], isLoading: false }),
  useApproveEpisode: () => state.noop,
  useSubmitAssignment: () => state.noop,
  useApproveAssignment: () => state.noop,
  useRejectAssignment: () => state.noop,
  useUnassignMember: () => state.noop,
  useSetAssignmentRevenue: () => state.noop,
  useAssignMember: () => state.noop,
}));

vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useCrewMembers: () => ({ data: [] }),
}));

vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (userId: string) => `User ${userId}`,
}));

// The admin dashboard above the accordion fans out its own React Query
// reads over this; nothing here needs a real response.
vi.mock("@/app/(site)/crews/_hooks/api", () => ({
  crewApi: { get: async () => [], post: async () => ({}), delete: async () => ({}) },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/src/env", () => ({ env: { OSS_BASE_URL: "https://oss.test", STUDIO_HOST: "" } }));

// Real en-US copy, so a key that never landed in the message files shows
// up here as a bare `approve` and fails the queries below.
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

const FOUNDER: UserCrewRole = {
  role: "admin",
  effectiveUserId: "1",
  effectiveName: "Owner",
  isAdmin: true,
  isFinance: false,
  isMember: false,
};

function episode(overrides: Partial<Episode> & Pick<Episode, "id" | "number">): Episode {
  return {
    crewId: "1",
    title: `Episode ${overrides.number}`,
    description: null,
    status: "in_production",
    deadline: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  } as Episode;
}

function assignment(
  overrides: Partial<EpisodeAssignment> & Pick<EpisodeAssignment, "id" | "episodeId">
): EpisodeAssignment {
  return {
    crewId: "1",
    userId: "7",
    positionId: null,
    roleName: "Storyboard",
    status: "submitted",
    submission: null,
    reviewNote: null,
    revenue: null,
    updatedAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  } as EpisodeAssignment;
}

/** EP03 — the episode the notification is about. */
const EP03 = episode({ id: "ep3", number: 3 });
/** EP05 — current (first non-approved), and not what the reader clicked. */
const EP05 = episode({ id: "ep5", number: 5 });

const DELIVERABLE = "https://drive.example.com/ep03-cut.mp4";
const SUBMISSION_NOTE = "Second pass, colour graded.";

let root: Root | null = null;
let container: HTMLElement | null = null;
let client: QueryClient | null = null;

async function renderBoard(deeplinkEpisodeId: string | null) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await rerenderBoard(deeplinkEpisodeId);
}

async function rerenderBoard(deeplinkEpisodeId: string | null) {
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client!}>
        <EpisodesBoard
          crewId="1"
          episodes={[EP03, EP05]}
          currentId={EP05.id}
          deeplinkEpisodeId={deeplinkEpisodeId}
          viewer={FOUNDER}
          onAddEpisode={() => {}}
        />
      </QueryClientProvider>
    )
  );
}

/** Buttons whose whole label is `label` — "Approve" must not match the
 *  episode-level "Approve Episode". */
function buttons(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label);
}

beforeEach(() => {
  document.body.innerHTML = "";
  state.assignmentsByEpisode = {
    ep3: [
      assignment({
        id: "as3",
        episodeId: "ep3",
        submission: {
          url: DELIVERABLE,
          note: SUBMISSION_NOTE,
          submittedAt: "2026-07-21T09:00:00.000Z",
        },
      }),
    ],
    ep5: [assignment({ id: "as5", episodeId: "ep5", status: "in_progress" })],
  };
  state.myAssignments = state.assignmentsByEpisode.ep3;
  state.myAssignmentsError = null;
  state.myAssignmentsLoading = false;
  state.refetchMyAssignments.mockReset();
  state.assignmentQueryEnables = [];
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  client = null;
});

describe("a founder landing from a notification about a non-current episode", () => {
  it("opens that episode's work surface, not just its anchor", async () => {
    await renderBoard("ep3");

    const row = document.getElementById("episode-row-ep3");
    expect(row).not.toBeNull();

    // The reviewer's probe got this far and then found an empty row.
    expect(row!.querySelector<HTMLAnchorElement>(`a[href="${DELIVERABLE}"]`)).not.toBeNull();
    expect(row!.textContent).toContain(SUBMISSION_NOTE);
    expect(buttons("Approve")).toHaveLength(1);
    expect(buttons("Reject")).toHaveLength(1);
  });

  it("renders the assignment anchor the ?assignment= param points at", async () => {
    await renderBoard("ep3");

    const anchor = document.getElementById("assignment-row-as3");
    expect(anchor).not.toBeNull();
    expect(document.getElementById("episode-row-ep3")!.contains(anchor!)).toBe(true);
  });

  it("leaves the current episode collapsed — the reader came for EP03", async () => {
    await renderBoard("ep3");

    expect(document.getElementById("assignment-row-as5")).toBeNull();
  });

  it("clears an excluding status filter when a live deeplink arrives", async () => {
    await renderBoard(null);

    const approvedFilter = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Approved")
    );
    expect(approvedFilter).toBeTruthy();
    act(() => approvedFilter!.click());
    expect(document.getElementById("episode-row-ep3")).toBeNull();

    // Opening a second notification updates search params without
    // remounting the workspace, so the board must reset its own filter.
    await rerenderBoard("ep3");

    expect(document.getElementById("episode-row-ep3")).not.toBeNull();
    expect(document.getElementById("assignment-row-as3")).not.toBeNull();
  });

  it("expands nothing new when the deeplinked episode is not on the board", async () => {
    // Deleted since the notification was sent, or a crew the viewer no
    // longer belongs to: fall back to the standing default.
    await renderBoard("ep_gone");

    expect(document.getElementById("assignment-row-as5")).not.toBeNull();
    expect(document.getElementById("assignment-row-as3")).toBeNull();
  });
});

describe("opening the tab without a deeplink", () => {
  it("still expands the current episode and only that one", async () => {
    await renderBoard(null);

    expect(document.getElementById("assignment-row-as5")).not.toBeNull();
    expect(document.getElementById("assignment-row-as3")).toBeNull();
  });

  it("filters the production board down to episodes assigned to me", async () => {
    await renderBoard(null);

    const mineFilter = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("My tasks")
    );
    expect(mineFilter).toBeTruthy();
    act(() => mineFilter!.click());

    expect(document.getElementById("episode-row-ep3")).not.toBeNull();
    expect(document.getElementById("episode-row-ep5")).toBeNull();
  });

  it("shows the server error and retry instead of a zero/no-tasks result", async () => {
    state.myAssignmentsError = new Error("Task service is unavailable");
    await renderBoard(null);

    const mineFilter = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("My tasks")
    );
    expect(mineFilter).toBeTruthy();
    expect(mineFilter!.textContent).toContain("—");
    expect(mineFilter!.textContent).not.toContain("0");
    expect(document.body.textContent).toContain("Task service is unavailable");

    act(() => mineFilter!.click());

    expect(document.body.textContent).toContain("Task service is unavailable");
    expect(document.body.textContent).not.toContain("You have no episode assignments yet.");
    const retry = buttons("Retry")[0];
    expect(retry).toBeTruthy();
    act(() => retry.click());
    expect(state.refetchMyAssignments).toHaveBeenCalledTimes(1);
  });

  it("keeps collapsed episodes' assignment queries disabled", async () => {
    await renderBoard(null);

    const ep3Calls = state.assignmentQueryEnables.filter(({ episodeId }) => episodeId === "ep3");
    expect(ep3Calls.length).toBeGreaterThan(0);
    expect(ep3Calls.every(({ enabled }) => !enabled)).toBe(true);
  });
});
