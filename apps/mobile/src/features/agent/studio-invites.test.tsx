import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { StudioInviteScope } from "./api/studio-invites-api";
import { StudioInvites } from "./studio-invites";
import { StudioInviteWriteError } from "./api/studio-invites-api";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  share: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./api/studio-invites-api", async (original) => ({
  ...(await original<typeof import("./api/studio-invites-api")>()),
  listStudioInvites: h.list,
  createStudioInvite: h.create,
  revokeStudioInvite: h.revoke,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
  Share: { share: h.share },
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => <input value={value} onChange={(e) => onChangeText(e.target.value)} disabled={!editable} />,
}));
const id = "11111111-1111-4111-8111-111111111111";
const scope = { kind: "workspace" as const, id, name: "Team" };
const row = {
  inviteId: id,
  role: "editor",
  status: "pending",
  createdAt: "2026-09-30T00:00:00Z",
  expiresAt: null,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = (selectedScope: StudioInviteScope = scope) =>
  act(async () =>
    root.render(<StudioInvites scope={selectedScope} generation={1} onClose={h.close} />)
  );
const button = (s: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === s);
const click = (s: string) => act(async () => button(s)!.click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.list.mockResolvedValue([row]);
  h.create.mockResolvedValue({ ...row, token: "a".repeat(32) });
  h.share.mockResolvedValue({});
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("shows permanent links and only shares in response to a user action", async () => {
  await render();
  expect(host.textContent).toContain("studioInvites.never");
  await click("studioInvites.create");
  expect(h.create).toHaveBeenCalledWith(scope, 1, "editor", null, expect.any(AbortSignal));
  expect(h.share).not.toHaveBeenCalled();
  await click("studioInvites.share");
  expect(h.share).toHaveBeenCalledWith({
    message: `https://studio.fizzdragon.com/invite/${"a".repeat(32)}`,
  });
});
it("requires a second press to revoke", async () => {
  await render();
  await click("studioInvites.revoke");
  expect(h.revoke).not.toHaveBeenCalled();
  await click("studioInvites.confirmRevoke");
  expect(h.revoke).toHaveBeenCalledWith(scope, 1, id, expect.any(AbortSignal));
});
it("blocks duplicate create taps and uncertain retries until fresh review", async () => {
  h.create.mockRejectedValue(new StudioInviteWriteError("Lost response"));
  await render();
  await act(async () => {
    button("studioInvites.create")!.click();
    button("studioInvites.create")!.click();
  });
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(button("studioInvites.create")!.disabled).toBe(true);
  expect(button("studioInvites.reviewed")!.disabled).toBe(true);
  await click("thread.refresh");
  expect(button("studioInvites.create")!.disabled).toBe(true);
  await click("studioInvites.reviewed");
  expect(button("studioInvites.create")!.disabled).toBe(false);
});
it("clears the raw link on background and refresh", async () => {
  await render();
  await click("studioInvites.create");
  expect(button("studioInvites.share")).toBeDefined();
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  await render();
  expect(button("studioInvites.share")).toBeUndefined();
});
it("withholds write controls if the permission read fails", async () => {
  h.list.mockRejectedValue(new Error("Administrator required"));
  await render();
  expect(host.textContent).toContain("Administrator required");
  expect(button("studioInvites.create")).toBeUndefined();
});
it("hides the session after an account change", async () => {
  await render();
  h.generation++;
  await render();
  expect(host.textContent).toBe("");
});

it("offers project roles and submits the selected project's invite", async () => {
  const projectScope = { ...scope, kind: "project" as const };
  await render(projectScope);
  expect(button("studioInvites.producer")).toBeUndefined();
  expect(button("studioInvites.reviewer")).toBeUndefined();
  await click("studioInvites.admin");
  await click("studioInvites.create");
  expect(h.create).toHaveBeenCalledWith(projectScope, 1, "admin", null, expect.any(AbortSignal));
});

it("explains Story roles without offering ownership or workspace admin invites", async () => {
  const storyScope = { ...scope, kind: "story-project" as const };
  await render(storyScope);
  expect(host.textContent).toContain("storyRoleGuide.descriptions.viewer");
  await click("storyRoleGuide.title");
  expect(host.textContent).toContain("studioMembers.owner");
  expect(host.textContent).toContain("storyRoleGuide.scopeNote");
  for (const [role, allowed] of Object.entries({
    owner: 6,
    producer: 5,
    editor: 3,
    reviewer: 2,
    viewer: 1,
  })) {
    const label = role === "owner" ? "studioMembers.owner" : `studioInvites.${role}`;
    const section = [...host.querySelectorAll("span")].find(
      (node) => node.textContent === label && node.parentElement?.tagName === "DIV"
    )!.parentElement!;
    expect(
      [...section.querySelectorAll("span")].filter(
        (node) => node.textContent === "storyRoleGuide.allowed"
      )
    ).toHaveLength(allowed);
    expect(
      [...section.querySelectorAll("span")].filter(
        (node) => node.textContent === "storyRoleGuide.notAllowed"
      )
    ).toHaveLength(6 - allowed);
  }
  expect(button("studioInvites.admin")).toBeUndefined();
  expect(button("studioMembers.owner")).toBeUndefined();
  await click("studioInvites.reviewer");
  await click("studioInvites.create");
  expect(h.create).toHaveBeenCalledWith(storyScope, 1, "reviewer", null, expect.any(AbortSignal));
});

it("does not show Story-specific role explanations for a workspace", async () => {
  await render();
  expect(button("storyRoleGuide.title")).toBeUndefined();
});
