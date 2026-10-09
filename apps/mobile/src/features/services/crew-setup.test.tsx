import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewSetup } from "./crew-setup";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  load: vi.fn(),
  editor: vi.fn(),
  tasks: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./crew-setup-api", () => ({ fetchCrewSetup: h.load }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) =>
    key === "crewSetup.addToRole" || key === "crewSetup.publish" ? key + " {role}" : key,
}));
vi.mock("./user-displays", () => ({
  useUserDisplays: () => new Map([["member", { nickname: "Artist" }]]),
}));
vi.mock("./crew-member-positions", () => ({
  CrewMemberPositions: (props: unknown) => {
    h.editor(props);
    return <span>positions editor</span>;
  },
}));
vi.mock("./crew-team-invitations", () => ({
  CrewTeamInvitations: (props: unknown) => {
    h.editor(props);
    return <span>invitation editor</span>;
  },
}));
vi.mock("./episode-task-template", () => ({
  EpisodeTaskTemplate: (props: unknown) => {
    h.editor(props);
    return <span>template editor</span>;
  },
}));
vi.mock("./episode-management", () => ({
  EpisodeManagement: () => <span>episode management</span>,
}));
vi.mock("./position-create", () => ({
  PositionCreate: (props: unknown) => {
    h.editor(props);
    return <span>opening editor</span>;
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const data = {
  members: [{ id: "m", userId: "member", positions: [] }],
  invitations: [],
  episodes: [{ id: "ep", title: "Pilot", taskProgress: { total: 0 } }],
  canInvite: true,
  canPublish: true,
};
const render = () =>
  act(async () =>
    root.render(
      <CrewSetup crewId="crew" userId="actor" generation={1} onClose={h.close} onTasks={h.tasks} />
    )
  );
const find = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => find(label).click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.load.mockResolvedValue(data);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("prefills an invited role without sending an invitation", async () => {
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "crewSetup.invite")!.click()
  );
  expect(h.editor).toHaveBeenCalledWith(
    expect.objectContaining({ crewId: "crew", initialPosition: expect.any(String) })
  );
});
it("opens a versioned member editor with the selected role", async () => {
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.startsWith("crewSetup.addToRole"))!
      .click()
  );
  await click("Artist");
  expect(h.editor).toHaveBeenCalledWith(
    expect.objectContaining({ member: data.members[0], initialPosition: expect.any(String) })
  );
});
it("initializes the exact episode and waits for real tasks before assignments", async () => {
  await render();
  await click("crewSetup.confirmMembers");
  expect(find("crewSetup.toAssignments").disabled).toBe(true);
  await click("crewSetup.initialize");
  expect(h.editor).toHaveBeenCalledWith(expect.objectContaining({ initialEpisodeId: "ep" }));
  h.load.mockResolvedValue({
    ...data,
    episodes: [{ ...data.episodes[0], taskProgress: { total: 2 } }],
  });
  await act(async () => h.editor.mock.calls.at(-1)![0].onClose());
  expect(find("crewSetup.toAssignments").disabled).toBe(false);
  await click("crewSetup.toAssignments");
  await click("crewTasks.title");
  expect(h.tasks).toHaveBeenCalledTimes(1);
});
it("prefills vacant-role recruitment only with publishing permission", async () => {
  h.load.mockResolvedValue({
    ...data,
    episodes: [{ ...data.episodes[0], taskProgress: { total: 1 } }],
  });
  await render();
  await click("crewSetup.confirmMembers");
  await click("crewSetup.toAssignments");
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.startsWith("crewSetup.publish"))!
      .click()
  );
  expect(h.editor).toHaveBeenCalledWith(
    expect.objectContaining({ initialPosition: expect.any(String) })
  );
});
it("hides old team data on failed refresh and never enables continuation", async () => {
  await render();
  h.load.mockRejectedValue(new Error("Access revoked"));
  await click("crewSetup.refresh");
  expect(host.textContent).toContain("Access revoked");
  expect(find("crewSetup.confirmMembers")).toBeUndefined();
  expect(host.textContent).not.toContain("Artist");
});
it("unmounts setup and editors after account change or backgrounding", async () => {
  await render();
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  h.generation = 2;
  await render();
  expect(host.textContent).toBe("");
});
