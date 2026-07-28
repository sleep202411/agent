// @vitest-environment jsdom

/**
 * An approved episode is frozen: R0's rule is 已批准剧集不再显示可编辑操作.
 * "Disabled" is not the same as "gone" — a greyed-out Approve Episode
 * button on an already-approved episode reads as "something is stopping
 * me", and the admin goes looking for the thing to unstick. The whole
 * action cluster has to disappear, the way Configure Members already
 * did.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EpisodeBrief } from "./episode-brief";
import type { Episode, EpisodeAssignment } from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Real en-US copy, so a label that never landed in the message files
// shows up here as a bare key and fails the queries below.
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

const mutate = vi.fn();
vi.mock("@/app/(site)/crews/_hooks/use-episodes", () => ({
  useApproveEpisode: () => ({ mutate, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ADMIN: UserCrewRole = {
  role: "admin",
  isAdmin: true,
  isFinance: true,
  isMember: true,
};

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: "9",
    crewId: "1",
    number: 3,
    title: "Cold open",
    description: null,
    status: "in_production",
    deadline: null,
    approvedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function assignment(overrides: Partial<EpisodeAssignment> = {}): EpisodeAssignment {
  return {
    id: "11",
    crewId: "1",
    episodeId: "9",
    userId: "42",
    positionId: null,
    roleName: "Storyboard",
    status: "in_progress",
    submission: null,
    reviewNote: null,
    revenue: null,
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(ep: Episode, assignments: EpisodeAssignment[], viewer: UserCrewRole = ADMIN) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <EpisodeBrief
        crewId="1"
        episode={ep}
        assignments={assignments}
        viewer={viewer}
        onConfigureMembers={() => {}}
      />
    )
  );
}

const buttonLabels = () =>
  [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");

beforeEach(() => {
  document.body.innerHTML = "";
  mutate.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("episode brief", () => {
  it("offers both admin actions while the episode is open", () => {
    render(episode(), [assignment()]);

    expect(buttonLabels()).toEqual(["Configure Members", "Approve Episode"]);
  });

  it("shows no editable action once the episode is approved", () => {
    render(episode({ status: "approved", approvedAt: "2026-07-02T00:00:00.000Z" }), [
      assignment({ status: "approved" }),
    ]);

    expect(buttonLabels()).toEqual([]);
    expect(document.body.textContent).not.toContain("Approve Episode");
    expect(document.body.textContent).not.toContain("Configure Members");
    // The panel itself still reports the state.
    expect(document.body.textContent).toContain("Approved");
  });

  it("keeps the actions out of a non-admin's panel", () => {
    render(episode(), [assignment()], {
      role: "member",
      isAdmin: false,
      isFinance: false,
      isMember: true,
    });

    expect(buttonLabels()).toEqual([]);
  });
});
