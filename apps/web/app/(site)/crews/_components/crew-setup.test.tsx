// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import en from "@/messages/en-US.json";
import { CrewSetup } from "./crew-setup";
const state = vi.hoisted(() => ({
  tasks: 0,
  moreInvitations: false,
  fetchingInvitations: false,
  invitationError: false,
  canInvite: true,
  fetchInvitations: vi.fn(),
  viewer: "owner",
  denied: false,
  failed: false,
  episodesEmpty: false,
  episodesFailed: false,
  episodesFetching: false,
  episodeStatus: "planned",
  update: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.viewer } }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations:
    (ns: string) =>
    (key: string, args: Record<string, unknown> = {}) => {
      let value: unknown = (en as Record<string, unknown>)[ns];
      for (const part of key.split(".")) value = (value as Record<string, unknown>)?.[part];
      return String(value ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
        String(args[name] ?? "")
      );
    },
}));
vi.mock("../_hooks/use-crew", () => ({
  useCrewDetail: () => ({
    data: { name: "My Crew", description: "Test", logo: "", version: 1 },
    refetch: state.refetch,
  }),
  useCrewMembers: () => ({
    data: [{ id: "member", userId: "person", status: "active", version: 4, positions: [] }],
    isError: state.failed,
    isFetching: false,
    hasNextPage: false,
    refetch: state.refetch,
  }),
  useCrewInvitations: () => ({
    hasNextPage: state.moreInvitations,
    isFetching: state.fetchingInvitations,
    isError: state.invitationError,
    fetchNextPage: state.fetchInvitations,
    data: [{ positionCategory: "director", status: "pending", expiresAt: "2099-01-01" }],
    refetch: state.refetch,
  }),
  useUpdateMember: () => ({ mutateAsync: state.update }),
}));
vi.mock("../_hooks/use-crew-permissions", () => ({
  useCrewPermissions: () => ({
    can: (permission: string) =>
      !state.denied && (permission !== "members.invite" || state.canInvite),
    effectiveUserId: state.viewer,
  }),
}));
vi.mock("../_hooks/use-production", () => ({
  useCrewEpisodes: () => ({
    data: state.episodesEmpty
      ? []
      : [
          {
            id: "episode",
            title: "Episode one",
            status: state.episodeStatus,
            taskProgress: { total: state.tasks },
          },
        ],
    isError: state.episodesFailed,
    isFetching: state.episodesFetching,
    error: state.episodesFailed ? new Error("Episodes unavailable") : null,
    refetch: state.refetch,
  }),
}));
vi.mock("../_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: () => "Person",
}));
vi.mock("./add-member-dialog", () => ({
  AddCrewMemberDialog: ({ positionCategory }: { positionCategory: string }) => (
    <p>Invite {positionCategory}</p>
  ),
}));
vi.mock("./create-crew-job-dialog", () => ({
  CreateCrewJobDialog: ({ initialPositionType }: { initialPositionType: string }) => (
    <p>Opening {initialPositionType}</p>
  ),
}));
vi.mock("../[id]/workspace/_components/tasks/crew-tasks-tab", () => ({
  CrewTasksTab: () => <p>Task assignments</p>,
}));
vi.mock("../[id]/workspace/_components/tasks/episode-template-preview", () => ({
  EpisodeTemplatePreview: ({ onClose }: { onClose: () => void }) => (
    <button
      onClick={() => {
        state.tasks = 7;
        onClose();
      }}
    >
      Confirm template
    </button>
  ),
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    children,
    onChange,
    ...props
  }: {
    children: ReactNode;
    onChange: (v: string) => void;
  }) => (
    // eslint-disable-next-line no-restricted-syntax -- Native test boundary for role selection.
    <select {...props} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  ),
  NativeSelectOption: (props: object) => <option {...props} />,
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  state.tasks = 0;
  state.moreInvitations = false;
  state.fetchingInvitations = false;
  state.invitationError = false;
  state.canInvite = true;
  state.viewer = "owner";
  state.denied = false;
  state.failed = false;
  state.episodesEmpty = false;
  state.episodesFailed = false;
  state.episodesFetching = false;
  state.episodeStatus = "planned";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<CrewSetup crewId="crew" />));
}
async function click(name: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it("guides role confirmation, explicit template initialization, then assignments and vacancies", async () => {
  await render();
  expect(host.textContent).toContain("Screenwriter");
  expect(host.textContent).toContain("1 pending invitations");
  await click(en.crewSetup.confirmMembers);
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === en.crewSetup.toAssignments)!
      .disabled
  ).toBe(false);
  await click(en.crewSetup.initialize);
  await click("Confirm template");
  await click(en.crewSetup.toAssignments);
  expect(host.textContent).toContain("Task assignments");
  const recruit = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === en.crewSetup.recruitRoleAction
  )!;
  expect(recruit.disabled).toBe(true);
  const role = host.querySelector("select") as HTMLSelectElement;
  await act(async () => {
    role.value = "director";
    role.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(en.crewSetup.recruitRoleAction);
  expect(host.textContent).toContain("Opening director");
});
it.each(["empty", "uninitialized", "cancelled"])(
  "lets an owner plan their own tasks with %s episodes and retains Production navigation",
  async (kind) => {
    state.episodesEmpty = kind === "empty";
    state.episodeStatus = kind === "cancelled" ? "cancelled" : "planned";
    await render();
    expect(host.querySelector('a[href="/en-US/messages?tab=recruitment"]')).not.toBeNull();
    expect(host.querySelector('a[href="/en-US/crews/tasks"]')).not.toBeNull();
    await click(en.crewSetup.confirmMembers);
    if (kind !== "uninitialized") expect(host.textContent).not.toContain("Episode one");
    await click(en.crewSetup.toAssignments);
    expect(host.textContent).toContain("Task assignments");
    expect(state.update).not.toHaveBeenCalled();
  }
);
it.each(["failed", "refreshing"])("does not advance with %s episode data", async (kind) => {
  state.episodesFailed = kind === "failed";
  state.episodesFetching = kind === "refreshing";
  await render();
  await click(en.crewSetup.confirmMembers);
  const next = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === en.crewSetup.toAssignments
  )!;
  expect(next.disabled).toBe(true);
  await act(async () => next.click());
  expect(host.textContent).not.toContain("Task assignments");
});
it("adds a production role with the current membership version and never changes access policies", async () => {
  await render();
  const select = host.querySelector(
    'select[aria-label="Add a member as Screenwriter"]'
  ) as HTMLSelectElement;
  await act(async () => {
    select.value = "member";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(state.update).toHaveBeenCalledWith({
    memberId: "member",
    input: { expectedVersion: 4, positions: [{ categoryKey: "screenwriter" }] },
  });
});
it("clears setup step after account replacement and hides failed or unauthorized roster data", async () => {
  await render();
  await click(en.crewSetup.confirmMembers);
  state.viewer = "other";
  await render();
  expect(host.textContent).toContain("Screenwriter");
  state.failed = true;
  await render();
  expect(host.querySelector("select")).toBeNull();
  state.failed = false;
  state.denied = true;
  await render();
  expect(host.textContent).not.toContain("Task assignments");
  expect(host.textContent).toContain(en.crewSetup.access);
});

it("loads remaining invitations before showing complete counts or confirming the team", async () => {
  state.moreInvitations = true;
  await render();
  expect(state.fetchInvitations).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain("1 pending invitations");
  const next = () =>
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === en.crewSetup.confirmMembers
    )!;
  expect(next().disabled).toBe(true);
  state.fetchingInvitations = true;
  await render();
  expect(state.fetchInvitations).toHaveBeenCalledTimes(1);
  state.fetchingInvitations = false;
  state.moreInvitations = false;
  await render();
  expect(host.textContent).toContain("1 pending invitations");
  expect(next().disabled).toBe(false);
});
it("does not paginate failed or unauthorized invitation data", async () => {
  state.moreInvitations = true;
  state.invitationError = true;
  await render();
  expect(state.fetchInvitations).not.toHaveBeenCalled();
  state.canInvite = false;
  state.invitationError = false;
  await render();
  expect(state.fetchInvitations).not.toHaveBeenCalled();
  await click(en.crewSetup.confirmMembers);
  expect(host.textContent).toContain(en.crewSetup.tasksHint);
});
