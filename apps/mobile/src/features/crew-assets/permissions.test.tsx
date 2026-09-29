import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AssetPermissions } from "./permissions";
const h = vi.hoisted(() => ({
  generation: 1,
  read: vi.fn(),
  members: vi.fn(),
  events: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./permissions-api", () => ({
  fetchAssetPermissions: h.read,
  fetchAssetPermissionMembers: h.members,
  fetchAssetPermissionEvents: h.events,
  saveAssetPermissions: h.save,
}));
vi.mock("../services/user-displays", () => ({
  useUserDisplays: () =>
    new Map([
      ["1", { nickname: "Artist" }],
      ["2", { nickname: "Producer" }],
    ]),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    editable: boolean;
  }) => <input disabled={!editable} value={value} onChange={(e) => onChangeText(e.target.value)} />,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

const snapshot = () => ({
  accessMode: "inherit",
  permissionVersion: 3,
  effectivePermission: "manage",
  canManage: true,
  grants: [],
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(
      <AssetPermissions crewId="crew" userId="1" generation={1} nodeId="node" onClose={h.close} />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.read.mockResolvedValue({ permissions: snapshot(), globalManage: true });
  h.members.mockResolvedValue(["1", "2"]);
  h.events.mockResolvedValue([]);
  h.save.mockResolvedValue(snapshot());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires confirmation then writes exactly once", async () => {
  await render();
  await click("assetPermissions.restricted");
  await click("assetOrganization.save");
  expect(h.save).not.toHaveBeenCalled();
  await click("assetOrganization.confirm");
  expect(h.save).toHaveBeenCalledTimes(1);
  expect(h.save).toHaveBeenCalledWith("crew", "1", 1, "node", snapshot(), {
    accessMode: "restricted",
    grants: [],
  });
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("blocks repeat requests and navigation while saving", async () => {
  let finish!: () => void;
  h.save.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await click("assetPermissions.restricted");
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(button("crewTasks.back")!.disabled).toBe(true);
  expect(button("thread.refresh")!.disabled).toBe(true);
  await click("assetOrganization.confirm");
  expect(h.save).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});
it("locks an uncertain failure until refresh", async () => {
  h.save.mockRejectedValue(new Error("Conflict: refresh"));
  await render();
  await click("assetPermissions.restricted");
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(host.textContent).toContain("Conflict: refresh");
  expect(button("assetOrganization.confirm")!.disabled).toBe(true);
  expect(h.close).not.toHaveBeenCalled();
  await click("thread.refresh");
  expect(button("assetPermissions.restricted")!.disabled).toBe(false);
  expect(host.textContent).not.toContain("Conflict: refresh");
});
it("does not show manager controls or request members for viewers", async () => {
  h.read.mockResolvedValue({
    permissions: { ...snapshot(), canManage: false, effectivePermission: "view" },
    globalManage: false,
  });
  await render();
  expect(h.members).not.toHaveBeenCalled();
  expect(button("assetOrganization.save")).toBeUndefined();
  expect(button("assetPermissions.history")).toBeUndefined();
  expect(button("assetPermissions.restricted")!.disabled).toBe(true);
});
it("does not expose editing before complete membership loads", async () => {
  h.members.mockRejectedValue(new Error("Member page failed"));
  await render();
  expect(host.textContent).toContain("Member page failed");
  expect(button("assetOrganization.save")).toBeUndefined();
});
it("opens permission history separately", async () => {
  await render();
  await click("assetPermissions.history");
  expect(h.events).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("assetPermissions.emptyHistory");
  await click("crewTasks.back");
  expect(button("assetOrganization.save")).toBeDefined();
});
it("suppresses a late load after account switch", async () => {
  let finish!: (v: unknown) => void;
  h.read.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => finish({ permissions: snapshot(), globalManage: true }));
  expect(button("assetOrganization.save")).toBeUndefined();
});
it("does not act for a stale generation", async () => {
  await render();
  await click("assetPermissions.restricted");
  await click("assetOrganization.save");
  h.generation = 2;
  await click("assetOrganization.confirm");
  expect(h.save).not.toHaveBeenCalled();
});
it.each(["view", "upload", "edit", "manage"])(
  "assigns %s and submits the chosen recipient",
  async (permission) => {
    await render();
    await click("assetPermissions.restricted");
    const buttons = [...host.querySelectorAll("button")].filter(
      (b) => b.textContent === `assetPermissions.${permission}`
    );
    await act(async () => buttons[1]!.click());
    await click("assetOrganization.save");
    await click("assetOrganization.confirm");
    expect(h.save).toHaveBeenCalledWith("crew", "1", 1, "node", snapshot(), {
      accessMode: "restricted",
      grants: [{ userId: "2", permission }],
    });
  }
);
it("allows removal of an inactive grantee", async () => {
  h.read.mockResolvedValue({
    permissions: {
      ...snapshot(),
      accessMode: "restricted",
      grants: [{ userId: "3", permission: "view" }],
    },
    globalManage: true,
  });
  await render();
  expect(host.textContent).toContain("assetPermissions.inactive");
  const none = [...host.querySelectorAll("button")].filter(
    (b) => b.textContent === "assetPermissions.none"
  );
  await act(async () => none[2]!.click());
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(h.save.mock.calls[0]![5]).toEqual({ accessMode: "restricted", grants: [] });
});
it("prevents downgrading the delegated manager's own grant", async () => {
  h.read.mockResolvedValue({
    permissions: {
      ...snapshot(),
      accessMode: "restricted",
      grants: [{ userId: "1", permission: "manage" }],
    },
    globalManage: false,
  });
  await render();
  expect(button("assetPermissions.none")!.disabled).toBe(true);
  expect(button("assetPermissions.view")!.disabled).toBe(true);
  expect(host.textContent).toContain("assetPermissions.retained");
});
it("reports history errors and permits reopening to retry", async () => {
  h.events.mockRejectedValueOnce(new Error("History unavailable"));
  await render();
  await click("assetPermissions.history");
  expect(host.textContent).toContain("History unavailable");
  await click("crewTasks.back");
  await click("assetPermissions.history");
  expect(host.textContent).toContain("assetPermissions.emptyHistory");
});
