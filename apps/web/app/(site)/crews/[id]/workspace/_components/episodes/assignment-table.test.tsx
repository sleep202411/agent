// @vitest-environment jsdom

/**
 * The assignment row is where R0's loop actually closes: the deliverable
 * has to be visible to the reviewer, the write surface has to disappear
 * once the episode is frozen, and destructive actions have to go through
 * a dialog.
 *
 * Everything below the component (react-query, the crew API) is mocked —
 * these tests are about what the row renders and what it calls, not about
 * the wire.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EpisodeAssignment } from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { AssignmentTable } from "./assignment-table";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  assignments: [] as unknown[],
  assignmentsError: null as Error | null,
  assignmentsLoading: false,
  refetchAssignments: vi.fn(),
  submit: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null },
  approve: { mutate: vi.fn(), isPending: false },
  reject: { mutate: vi.fn(), isPending: false },
  unassign: { mutate: vi.fn(), isPending: false },
  setRevenue: { mutate: vi.fn(), isPending: false },
  assign: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@/app/(site)/crews/_hooks/use-episodes", () => ({
  useEpisodeAssignments: () => ({
    data: state.assignmentsError ? undefined : state.assignments,
    isLoading: state.assignmentsLoading,
    isError: !!state.assignmentsError,
    error: state.assignmentsError,
    refetch: state.refetchAssignments,
  }),
  useSubmitAssignment: () => state.submit,
  useApproveAssignment: () => state.approve,
  useRejectAssignment: () => state.reject,
  useUnassignMember: () => state.unassign,
  useSetAssignmentRevenue: () => state.setRevenue,
  useAssignMember: () => state.assign,
}));

vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useCrewMembers: () => ({ data: [] }),
}));

vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (userId: string) => `User ${userId}`,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The revenue cell reaches `src/env` through the cell/currency policy,
// which fails loud on missing build-time vars — same stub the auth
// dialog's suite uses.
vi.mock("@/src/env", () => ({ env: { OSS_BASE_URL: "https://oss.test", STUDIO_HOST: "" } }));

// Real en-US copy, so a key that never landed in the message files shows
// up here as a bare `submitConfirm` and fails the queries below.
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

const ASSIGNEE: UserCrewRole = {
  role: "member",
  effectiveUserId: "7",
  effectiveName: "Ada",
  isAdmin: false,
  isFinance: false,
  isMember: true,
};

const FINANCE_ASSIGNEE: UserCrewRole = {
  role: "finance",
  effectiveUserId: "7",
  effectiveName: "Ada",
  isAdmin: false,
  isFinance: true,
  isMember: false,
};

const ADMIN_ASSIGNEE: UserCrewRole = {
  ...ADMIN,
  effectiveUserId: "7",
};

function assignment(overrides: Partial<EpisodeAssignment> = {}): EpisodeAssignment {
  return {
    id: "100",
    crewId: "1",
    episodeId: "10",
    userId: "7",
    positionId: null,
    roleName: "Storyboard",
    status: "submitted",
    submission: null,
    reviewNote: null,
    revenue: null,
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function renderTable(viewer: UserCrewRole, frozen: boolean) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <AssignmentTable
        crewId="1"
        episodeId="10"
        episodeNumber={3}
        viewer={viewer}
        frozen={frozen}
      />
    )
  );
}

function buttons(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter(
    (b) => b.textContent?.includes(label) || b.getAttribute("aria-label") === label
  );
}

function button(label: string): HTMLButtonElement {
  const [first] = buttons(label);
  if (!first) throw new Error(`no button labelled "${label}"`);
  return first;
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function field(id: string): HTMLInputElement | HTMLTextAreaElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no field #${id} — the submit dialog never opened`);
  return el as HTMLInputElement | HTMLTextAreaElement;
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  state.assignments = [];
  state.assignmentsError = null;
  state.assignmentsLoading = false;
  state.refetchAssignments.mockReset();
  state.submit.error = null;
  for (const m of [state.submit, state.approve, state.reject, state.unassign, state.setRevenue]) {
    m.mutate.mockReset();
  }
  state.submit.reset.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the deliverable", () => {
  it("puts the submitted link and note in front of the reviewer", () => {
    state.assignments = [
      assignment({
        submission: {
          url: "https://drive.example.com/ep03-cut.mp4",
          note: "Second pass, colour graded.",
          submittedAt: "2026-07-21T09:00:00.000Z",
        },
      }),
    ];

    renderTable(ADMIN, false);

    const link = document.querySelector<HTMLAnchorElement>(
      'a[href="https://drive.example.com/ep03-cut.mp4"]'
    );
    expect(link).not.toBeNull();
    expect(link!.rel).toBe("noopener noreferrer");
    expect(link!.target).toBe("_blank");
    expect(document.body.textContent).toContain("Second pass, colour graded.");
  });

  it("never turns a non-web scheme into an href", () => {
    state.assignments = [
      assignment({
        submission: {
          url: "javascript:alert(1)",
          note: null,
          submittedAt: "2026-07-21T09:00:00.000Z",
        },
      }),
    ];

    renderTable(ADMIN, false);

    expect(document.querySelector("a")).toBeNull();
    // Still shown, so the reviewer can see what was actually submitted.
    expect(document.body.textContent).toContain("javascript:alert(1)");
  });
});

describe("an assignment read failure", () => {
  it("shows the server error and retry instead of claiming the roster is empty", () => {
    state.assignmentsError = new Error("Episode assignment database is unavailable");

    renderTable(ADMIN, false);

    expect(document.body.textContent).toContain("Episode assignment database is unavailable");
    expect(document.body.textContent).not.toContain("No members assigned yet");
    expect(buttons("Assign Member")).toHaveLength(0);

    click(button("Retry"));
    expect(state.refetchAssignments).toHaveBeenCalledTimes(1);
  });
});

describe("an approved episode is frozen", () => {
  it("leaves an admin no write surface at all", () => {
    state.assignments = [
      assignment({ revenue: { amount: 50000, currency: "USD", setAt: "x", setByUserId: "1" } }),
    ];

    renderTable(ADMIN, true);

    expect(buttons("Approve")).toHaveLength(0);
    expect(buttons("Reject")).toHaveLength(0);
    expect(buttons("Unassign")).toHaveLength(0);
    expect(buttons("Assign Member")).toHaveLength(0);
    expect(buttons("Edit revenue")).toHaveLength(0);
    // The recorded amount is still readable — frozen, not hidden.
    expect(document.body.textContent).toContain("500");
  });

  it("takes the submit button away from the assignee", () => {
    state.assignments = [assignment({ status: "rejected" })];

    renderTable(ASSIGNEE, true);

    expect(buttons("Resubmit")).toHaveLength(0);
    expect(buttons("Submit for Review")).toHaveLength(0);
  });

  it("keeps every one of those while the episode is still open", () => {
    state.assignments = [
      assignment({ revenue: { amount: 50000, currency: "USD", setAt: "x", setByUserId: "1" } }),
    ];

    renderTable(ADMIN, false);

    expect(buttons("Approve")).toHaveLength(1);
    expect(buttons("Reject")).toHaveLength(1);
    // A submitted row is already immutable audit history; the server
    // only permits unassign from in_progress / rejected.
    expect(buttons("Unassign")).toHaveLength(0);
    expect(buttons("Assign Member")).toHaveLength(1);
    expect(buttons("Edit revenue")).toHaveLength(1);
  });
});

describe("unassigning", () => {
  it("waits for the confirmation dialog instead of firing on the icon click", () => {
    state.assignments = [assignment({ status: "in_progress" })];
    renderTable(ADMIN, false);

    click(button("Unassign"));

    expect(state.unassign.mutate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Unassign this member?");

    const confirm = document.querySelector('[data-slot="alert-dialog-action"]');
    expect(confirm).not.toBeNull();
    click(confirm!);

    expect(state.unassign.mutate).toHaveBeenCalledTimes(1);
    expect(state.unassign.mutate.mock.calls[0]![0]).toBe("100");
  });

  it("fires nothing when the confirmation is cancelled", () => {
    state.assignments = [assignment({ status: "rejected" })];
    renderTable(ADMIN, false);

    click(button("Unassign"));
    click(document.querySelector('[data-slot="alert-dialog-cancel"]')!);

    expect(state.unassign.mutate).not.toHaveBeenCalled();
  });
});

describe("submitting through the dialog", () => {
  it("sends the link and note the member typed", () => {
    state.assignments = [assignment({ status: "in_progress" })];
    renderTable(ASSIGNEE, false);

    click(button("Submit for Review"));

    type(field("submit-url"), "https://ex.test/cut.mp4");
    type(field("submit-note"), "First pass");
    click(button("Send for Review"));

    expect(state.submit.mutate).toHaveBeenCalledTimes(1);
    expect(state.submit.mutate.mock.calls[0]![0]).toEqual({
      assignmentId: "100",
      url: "https://ex.test/cut.mp4",
      note: "First pass",
    });
  });

  it("keeps the dialog open showing the server's own error text", () => {
    state.assignments = [assignment({ status: "in_progress" })];
    state.submit.error = new Error("You are no longer a member of this crew");

    renderTable(ASSIGNEE, false);
    click(button("Submit for Review"));

    expect(document.body.textContent).toContain("You are no longer a member of this crew");
    expect(document.body.textContent).not.toContain("Action failed");
  });

  it.each([
    ["finance", FINANCE_ASSIGNEE],
    ["admin", ADMIN_ASSIGNEE],
  ])("lets an assigned %s submit their own row", (_label, viewer) => {
    state.assignments = [assignment({ status: "in_progress" })];

    renderTable(viewer, false);

    expect(buttons("Submit for Review")).toHaveLength(1);
  });

  it("does not let an admin submit somebody else's row", () => {
    state.assignments = [assignment({ status: "in_progress" })];

    renderTable(ADMIN, false);

    expect(buttons("Submit for Review")).toHaveLength(0);
  });
});
