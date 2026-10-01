// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import en from "@/messages/en-US.json";
import { CrewSetup } from "./crew-setup";
const state = vi.hoisted(() => ({
  tasks: 0,
  viewer: "owner",
  denied: false,
  failed: false,
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
    data: [{ positionCategory: "director", status: "pending", expiresAt: "2099-01-01" }],
    refetch: state.refetch,
  }),
  useUpdateMember: () => ({ mutateAsync: state.update }),
}));
vi.mock("../_hooks/use-crew-permissions", () => ({
  useCrewPermissions: () => ({ can: () => !state.denied, effectiveUserId: state.viewer }),
}));
vi.mock("../_hooks/use-production", () => ({
  useCrewEpisodes: () => ({
    data: [{ id: "episode", title: "Episode one", taskProgress: { total: state.tasks } }],
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
  state.viewer = "owner";
  state.denied = false;
  state.failed = false;
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
  ).toBe(true);
  await click(en.crewSetup.initialize);
  await click("Confirm template");
  await click(en.crewSetup.toAssignments);
  expect(host.textContent).toContain("Task assignments");
  await click("Recruit: Director");
  expect(host.textContent).toContain("Opening director");
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
