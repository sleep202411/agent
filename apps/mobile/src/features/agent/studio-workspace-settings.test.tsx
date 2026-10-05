import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StudioWorkspaceSettingsScreen } from "./studio-workspace-settings";
import { WorkspaceSettingsWriteError } from "./api/studio-workspace-settings-api";
vi.mock("./workspace-icon-upload", () => ({ pickWorkspaceIcon: h.upload }));
vi.mock("expo-image", () => ({ Image: () => <span /> }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
const h = vi.hoisted(() => ({
  prevent: false,
  routeRemove: undefined as undefined | ((event: { data: { action: { type: string } } }) => void),
  hardwareBack: undefined as undefined | (() => boolean),
  dispatch: vi.fn(),
  upload: vi.fn(),
  generation: 1,
  active: true,
  read: vi.fn(),
  plan: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  done: vi.fn(),
  close: vi.fn(),
}));
vi.mock("expo-router", () => ({ useNavigation: () => ({ dispatch: h.dispatch }) }));
vi.mock("expo-router/build/react-navigation/core/usePreventRemove", () => ({
  usePreventRemove: (prevent: boolean, callback: typeof h.routeRemove) => {
    h.prevent = prevent;
    h.routeRemove = callback;
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.plan } }));
vi.mock("./api/studio-workspace-settings-api", async (original) => ({
  ...(await original<typeof import("./api/studio-workspace-settings-api")>()),
  fetchWorkspaceSettings: h.read,
  createStudioWorkspace: h.create,
  updateStudioWorkspace: h.update,
  deleteStudioWorkspace: h.remove,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  BackHandler: {
    addEventListener: (_: string, callback: () => boolean) => {
      h.hardwareBack = callback;
      return { remove: vi.fn() };
    },
  },
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
const row = {
  id,
  name: "Team",
  description: "Details",
  avatarUrl: null,
  isDefault: false,
  status: "active",
  version: 3,
  role: "owner",
  accessScope: "workspace",
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = (create = false) =>
  act(async () =>
    root.render(
      <StudioWorkspaceSettingsScreen
        workspaceId={create ? undefined : id}
        generation={1}
        onClose={h.close}
        onDone={h.done}
      />
    )
  );
const button = (s: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === s);
const click = (s: string) => act(async () => button(s)!.click());
const input = (index: number, value: string) =>
  act(async () => {
    const el = host.querySelectorAll("input")[index];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.read.mockResolvedValue(row);
  h.create.mockResolvedValue(row);
  h.update.mockResolvedValue(row);
  h.remove.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires a name and submits creation once", async () => {
  await render(true);
  expect(button("studioWorkspace.create")!.disabled).toBe(true);
  await input(0, "Team");
  await act(async () => {
    button("studioWorkspace.create")!.click();
    button("studioWorkspace.create")!.click();
  });
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(h.done).toHaveBeenCalledWith(id);
});
it("keeps failed edits until explicitly discarded", async () => {
  h.update.mockRejectedValue(new WorkspaceSettingsWriteError("Conflict"));
  await render();
  await input(0, "Draft");
  await click("studioWorkspace.save");
  expect(host.querySelector("input")!.value).toBe("Draft");
  expect(button("studioWorkspace.save")!.disabled).toBe(true);
  await click("studioWorkspace.reload");
  if (button("documentEditor.discard")) await click("documentEditor.discard");
  expect(host.querySelector("input")!.value).toBe("Team");
});
it("allows read-only settings without edit or delete controls", async () => {
  h.read.mockResolvedValue({ ...row, role: "viewer" });
  await render();
  expect(button("studioWorkspace.save")).toBeUndefined();
  expect(button("studioWorkspace.delete")).toBeUndefined();
  expect(host.querySelector("input")!.disabled).toBe(true);
});
it("protects the default workspace", async () => {
  h.read.mockResolvedValue({ ...row, isDefault: true });
  await render();
  expect(button("studioWorkspace.delete")).toBeUndefined();
  expect(host.textContent).toContain("studioWorkspace.default");
});
it("requires the exact name before deleting", async () => {
  await render();
  await click("studioWorkspace.delete");
  expect(button("studioWorkspace.confirmDelete")!.disabled).toBe(true);
  await input(2, "Team");
  await click("studioWorkspace.confirmDelete");
  expect(h.remove).toHaveBeenCalledWith(row, "Team", 1, expect.any(AbortSignal));
  expect(h.done).toHaveBeenCalledWith(undefined);
});
it("keeps unsaved input when backgrounded and hides it on account change", async () => {
  await render();
  await input(0, "Draft");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  await render();
  expect(host.querySelector("input")!.value).toBe("Draft");
  h.generation++;
  await render();
  expect(host.textContent).toBe("");
});
it("stages icon selection until save and retains it after backgrounding", async () => {
  await render();
  await click("studioWorkspace.icon_ocean");
  expect(h.update).not.toHaveBeenCalled();
  h.active = false;
  await render();
  h.active = true;
  await render();
  await click("studioWorkspace.save");
  expect(h.update).toHaveBeenCalledWith(
    row,
    { name: "Team", description: "Details", icon: "ocean" },
    1,
    expect.any(AbortSignal)
  );
});
it("does not offer icon edits to viewers", async () => {
  h.read.mockResolvedValue({ ...row, role: "viewer" });
  await render();
  expect(button("studioWorkspace.icon_ocean")).toBeUndefined();
});

it.each(["owner", "billing", "member"])(
  "opens the workspace plan with %s permissions",
  async (role) => {
    h.read.mockResolvedValue({ ...row, role });
    h.plan.mockResolvedValue({
      entitlement: { planKey: "team", status: "active", expiresAt: null },
      subscription: {
        id,
        status: "active",
        planKey: "team",
        productType: "team_membership_plan",
        subjectType: "workspace",
        currency: "USD",
        amountMinor: "2999",
        interval: "month",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        endedAt: null,
      },
    });
    await render();
    expect(h.plan).not.toHaveBeenCalled();
    await click("subscription.title");
    expect(h.plan).toHaveBeenCalledWith(
      "/billing/entitlement/me",
      expect.objectContaining({ headers: { "x-fizz-workspace-id": id } })
    );
    expect(!!button("subscription.cancel")).toBe(role !== "member");
    await click("subscription.title");
    expect(button("subscription.cancel")).toBeUndefined();
  }
);
it("locks creation while uploading and saves the confirmed custom icon", async () => {
  let finish!: (url: string) => void;
  h.upload.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    })
  );
  await render(true);
  await input(0, "Custom team");
  await click("studioWorkspace.uploadIcon");
  expect(button("studioWorkspace.create")!.disabled).toBe(true);
  expect(button("crewTasks.back")!.disabled).toBe(true);
  await act(async () => finish("https://cdn.test/icon.png"));
  await click("studioWorkspace.create");
  expect(h.create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Custom team",
      customIcon: "https://cdn.test/icon.png",
      icon: undefined,
    }),
    1
  );
});
it("preserves entered details and the existing icon after upload failure", async () => {
  h.upload.mockRejectedValue(new Error("Storage unavailable"));
  await render();
  await input(0, "Draft name");
  await click("studioWorkspace.uploadIcon");
  expect(host.textContent).toContain("Storage unavailable");
  await click("studioWorkspace.save");
  expect(h.update).toHaveBeenCalledWith(
    row,
    expect.objectContaining({ name: "Draft name", icon: undefined, customIcon: undefined }),
    1,
    expect.any(AbortSignal)
  );
});
it("aborts background uploads and ignores a late result", async () => {
  let finish!: (url: string) => void;
  h.upload.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await click("studioWorkspace.uploadIcon");
  const signal = h.upload.mock.calls[0][1];
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish("https://cdn.test/late.png"));
  h.active = true;
  await render();
  await click("studioWorkspace.save");
  expect(h.update).toHaveBeenCalledWith(
    row,
    expect.objectContaining({ customIcon: undefined }),
    1,
    expect.any(AbortSignal)
  );
});

it("preserves edits when Back or reload is cancelled", async () => {
  await render();
  await input(0, "Retained name");
  await click("crewTasks.back");
  expect(h.close).not.toHaveBeenCalled();
  await click("documentEditor.keepEditing");
  expect(host.querySelector("input")!.value).toBe("Retained name");
  await click("studioWorkspace.reload");
  await click("documentEditor.keepEditing");
  expect(h.read).toHaveBeenCalledTimes(1);
  expect(host.querySelector("input")!.value).toBe("Retained name");
  await act(async () => {
    h.hardwareBack!();
  });
  await click("documentEditor.discard");
  expect(h.close).toHaveBeenCalledOnce();
});
it("guards icon-only edits and new workspace drafts on route exit", async () => {
  await render();
  await click("studioWorkspace.icon_aurora");
  expect(h.prevent).toBe(true);
  const action = { type: "GO_BACK" };
  await act(async () => h.routeRemove!({ data: { action } }));
  await click("documentEditor.keepEditing");
  expect(h.dispatch).not.toHaveBeenCalled();
  await render(true);
  expect(h.prevent).toBe(false);
  await input(0, "New workspace");
  await act(async () => h.routeRemove!({ data: { action } }));
  await click("documentEditor.discard");
  expect(h.dispatch).toHaveBeenCalledWith(action);
});
it("blocks pending writes but permits successful save navigation immediately", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await input(0, "Saving workspace");
  await click("studioWorkspace.save");
  const action = { type: "GO_BACK" };
  await act(async () => h.routeRemove!({ data: { action } }));
  expect(h.dispatch).not.toHaveBeenCalled();
  expect(button("documentEditor.discard")).toBeUndefined();
  h.done.mockImplementation(() => h.routeRemove!({ data: { action } }));
  await act(async () => finish());
  expect(h.dispatch).toHaveBeenCalledWith(action);
  expect(h.prevent).toBe(false);
});
it("blocks navigation during icon upload without preventing account retirement", async () => {
  let finish!: () => void;
  h.upload.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("studioWorkspace.uploadIcon");
  const action = { type: "GO_BACK" };
  await act(async () => h.routeRemove!({ data: { action } }));
  expect(h.dispatch).not.toHaveBeenCalled();
  expect(button("documentEditor.discard")).toBeUndefined();
  h.generation++;
  await act(async () => h.routeRemove!({ data: { action } }));
  expect(h.dispatch).toHaveBeenCalledWith(action);
  await act(async () => finish());
});
