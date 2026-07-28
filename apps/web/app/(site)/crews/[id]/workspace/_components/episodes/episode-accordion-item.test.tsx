// @vitest-environment jsdom

/**
 * The accordion item owns one permission decision the child components
 * cannot make for themselves: an approved episode is closed for edits,
 * whoever is looking at it. It expresses that by passing
 * `frozen={isApproved}` down to the assignment table.
 *
 * `assignment-table.test.tsx` injects `frozen` directly, so it proves
 * what the table does with the flag but nothing about where the flag
 * comes from — flip this component to `frozen={false}` and that suite
 * stays green. These tests pin the wiring: the only input is the
 * episode's own status.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Episode, EpisodeAssignment } from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { EpisodeAccordionItem } from "./episode-accordion-item";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  assignments: [] as unknown[],
  assignmentQueryEnables: [] as boolean[],
  noop: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null },
}));

vi.mock("@/app/(site)/crews/_hooks/use-episodes", () => ({
  useEpisodeAssignments: (_crewId: string, _episodeId: string, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled ?? true;
    state.assignmentQueryEnables.push(enabled);
    return {
      data: enabled ? state.assignments : undefined,
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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/src/env", () => ({ env: { OSS_BASE_URL: "https://oss.test", STUDIO_HOST: "" } }));

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

const ADMIN: UserCrewRole = {
  role: "admin",
  effectiveUserId: "1",
  effectiveName: "Owner",
  isAdmin: true,
  isFinance: false,
  isMember: false,
};

/** Still awaiting review, and with money on it — so every admin write
 *  surface in the table is live unless the episode itself freezes it. */
const SUBMITTED: EpisodeAssignment = {
  id: "as1",
  crewId: "1",
  episodeId: "ep1",
  userId: "7",
  positionId: null,
  roleName: "Storyboard",
  status: "submitted",
  submission: { url: null, note: "Handed in", submittedAt: "2026-07-21T09:00:00.000Z" },
  reviewNote: null,
  revenue: { amount: 50000, currency: "USD", setAt: "2026-07-21T09:00:00.000Z", setByUserId: "1" },
  updatedAt: "2026-07-21T09:00:00.000Z",
} as EpisodeAssignment;

function episode(status: Episode["status"]): Episode {
  return {
    id: "ep1",
    crewId: "1",
    number: 3,
    title: "Episode 3",
    description: null,
    status,
    deadline: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  } as Episode;
}

/** Every write surface the table hides once its episode is frozen. */
const WRITE_SURFACE = ["Approve", "Reject", "Unassign", "Assign Member", "Edit revenue"];

let root: Root | null = null;
let container: HTMLElement | null = null;

function renderItem(status: Episode["status"], expanded = true) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <EpisodeAccordionItem
        crewId="1"
        episode={episode(status)}
        isCurrent={false}
        expanded={expanded}
        onToggle={() => {}}
        viewer={ADMIN}
      />
    )
  );
}

/** Buttons whose whole label is `label` — "Approve" must not match the
 *  episode-level "Approve Episode". */
function buttons(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  state.assignments = [SUBMITTED];
  state.assignmentQueryEnables = [];
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("an approved episode", () => {
  it("gives an admin no write surface on any assignment", () => {
    renderItem("approved");

    for (const label of WRITE_SURFACE) {
      expect(buttons(label), `"${label}" should be gone on an approved episode`).toHaveLength(0);
    }
    // Frozen, not hidden — the record stays readable.
    expect(document.body.textContent).toContain("Handed in");
    expect(document.body.textContent).toContain("500");
  });
});

describe("an episode still in production", () => {
  it("keeps every one of those write surfaces", () => {
    renderItem("in_production");

    for (const label of WRITE_SURFACE.filter((label) => label !== "Unassign")) {
      expect(buttons(label), `"${label}" should be live on an open episode`).toHaveLength(1);
    }
    // Submitted work is immutable audit history; unassign is available
    // only before a deliverable enters review.
    expect(buttons("Unassign")).toHaveLength(0);
  });
});

describe("a collapsed episode", () => {
  it("keeps the assignment query disabled until the row is opened", () => {
    renderItem("in_production", false);

    expect(state.assignmentQueryEnables).toEqual([false]);
    expect(document.body.textContent).not.toContain("No members assigned");
  });
});
