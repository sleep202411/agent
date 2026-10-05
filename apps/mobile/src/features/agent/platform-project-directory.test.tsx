import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PlatformProjectDirectory } from "./platform-project-directory";
import { PlatformProjectWriteError } from "./api/platform-projects-api";
const h = vi.hoisted(() => ({
  prevent: false,
  routeRemove: undefined as undefined | ((event: { data: { action: { type: string } } }) => void),
  hardwareBack: undefined as undefined | (() => boolean),
  dispatch: vi.fn(),
  cover: vi.fn(),
  upload: vi.fn(),
  read: vi.fn(),
  generation: 1,
  active: true,
  focused: true,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./platform-project-cover", () => ({
  PlatformProjectCover: () => <span>Cover preview</span>,
}));
vi.mock("./api/platform-project-cover-upload", () => ({ uploadPlatformProjectCover: h.upload }));
vi.mock("./platform-project-sections", () => ({
  PlatformProjectSections: ({
    projectId,
    workspaceId,
    onClose,
  }: {
    projectId: string;
    workspaceId: string;
    onClose: () => void;
  }) => (
    <button onClick={onClose}>
      Chapters:{projectId}:{workspaceId}
    </button>
  ),
}));
vi.mock("./studio-members", () => ({
  StudioMembers: ({
    scope,
    onClose,
  }: {
    scope: { kind: string; id: string; name: string };
    onClose: () => void;
  }) => (
    <button onClick={onClose}>
      Members:{scope.kind}:{scope.id}:{scope.name}
    </button>
  ),
}));
vi.mock("./studio-invites", () => ({
  StudioInvites: ({
    scope,
    onClose,
  }: {
    scope: { kind: string; id: string; name: string };
    onClose: () => void;
  }) => (
    <button onClick={onClose}>
      Invites:{scope.kind}:{scope.id}:{scope.name}
    </button>
  ),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useNavigation: () => ({ dispatch: h.dispatch }),
}));
vi.mock("expo-router/build/react-navigation/core/usePreventRemove", () => ({
  usePreventRemove: (prevent: boolean, callback: typeof h.routeRemove) => {
    h.prevent = prevent;
    h.routeRemove = callback;
  },
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, getLocale: () => "en-US" }));
vi.mock("./api/platform-projects-api", async (original) => ({
  ...(await original<typeof import("./api/platform-projects-api")>()),
  loadPlatformProjects: h.list,
  readPlatformProject: h.read,
  updatePlatformProjectCover: h.cover,
  createPlatformProject: h.create,
  updatePlatformProject: h.update,
  archivePlatformProject: h.archive,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Linking: { openURL: h.open },
  BackHandler: {
    addEventListener: (_: string, callback: () => boolean) => {
      h.hardwareBack = callback;
      return { remove: vi.fn() };
    },
  },
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
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
  }) => <input value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />,
}));
const id = "11111111-1111-4111-8111-111111111111",
  workspaceId = "22222222-2222-4222-8222-222222222222";
const row = {
  id,
  workspaceId,
  name: "Film",
  description: "",
  status: "active",
  visibility: "private",
  role: "owner",
  version: 2,
  updatedAt: "2026-09-30T00:00:00Z",
};
const workspace = {
  id: workspaceId,
  name: "Team",
  isDefault: false,
  role: "owner" as const,
  accessScope: "workspace" as const,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () =>
  act(async () =>
    root.render(<PlatformProjectDirectory workspace={workspace} generation={1} onClose={h.close} />)
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label);
const click = (label: string) => act(async () => button(label)!.click());
const input = (index: number, value: string) =>
  act(async () => {
    const el = host.querySelectorAll("input")[index];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  h.list.mockResolvedValue([row]);
  h.create.mockResolvedValue(row);
  h.update.mockResolvedValue(row);
  h.archive.mockResolvedValue(undefined);
  h.open.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires a project name and submits create only once", async () => {
  await render();
  await click("studioProjects.create");
  expect(button("studioProjects.create")!.disabled).toBe(true);
  await input(0, "New Film");
  await act(async () => {
    button("studioProjects.create")!.click();
    button("studioProjects.create")!.click();
  });
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(h.create).toHaveBeenCalledWith(
    workspaceId,
    { name: "New Film", description: "" },
    "studioProjects.firstSection",
    1,
    expect.any(AbortSignal)
  );
});
it("requires exact confirmation before archiving", async () => {
  await render();
  await click("studioProjects.details");
  expect(button("studioProjects.archive")!.disabled).toBe(true);
  await input(2, "Film");
  await click("studioProjects.archive");
  expect(h.archive).toHaveBeenCalledWith(row, "Film", 1, expect.any(AbortSignal));
});
it("shows viewer details without edit/archive controls", async () => {
  h.list.mockResolvedValue([{ ...row, role: "viewer" }]);
  await render();
  await click("studioProjects.details");
  expect(button("studioProjects.save")).toBeUndefined();
  expect(button("studioProjects.archive")).toBeUndefined();
  expect(host.querySelector("input")!.disabled).toBe(true);
});
it("keeps failed edits and requires fresh list review after uncertain writes", async () => {
  h.update.mockRejectedValue(new PlatformProjectWriteError("Lost response"));
  await render();
  await click("studioProjects.details");
  await input(0, "Draft");
  await click("studioProjects.save");
  expect(host.querySelector("input")!.value).toBe("Draft");
  expect(button("studioProjects.save")!.disabled).toBe(true);
  await click("studioProjects.discard");
  if (button("documentEditor.discard")) await click("documentEditor.discard");
  await click("studioProjects.reload");
  expect(button("studioProjects.create")!.disabled).toBe(true);
  await click("studioProjects.reviewed");
  expect(button("studioProjects.create")!.disabled).toBe(false);
});
it("preserves edits in background and clears the surface on account change", async () => {
  await render();
  await click("studioProjects.details");
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
it("opens the specific canvas in regional Studio", async () => {
  await render();
  await click("studioProjects.open");
  expect(h.open).toHaveBeenCalledWith(
    `https://studio.fizzdragon.com/project/${id}?ws=${workspaceId}`
  );
});

it("opens sharing under the selected project and refreshes roles on return", async () => {
  await render();
  await click("studioMembers.title");
  expect(host.textContent).toBe(`Members:project:${id}:Film`);
  await act(async () => host.querySelector("button")!.click());
  await click("studioInvites.title");
  expect(host.textContent).toBe(`Invites:project:${id}:Film`);
  h.list.mockResolvedValue([{ ...row, role: "viewer" }]);
  await act(async () => host.querySelector("button")!.click());
  expect(button("studioInvites.title")).toBeUndefined();
  expect(button("studioMembers.title")).toBeDefined();
});

it("opens the selected project's chapters and refreshes its version on return", async () => {
  await render();
  await click("studioChapters.title");
  expect(host.textContent).toBe(`Chapters:${id}:${workspaceId}`);
  const calls = h.list.mock.calls.length;
  await act(async () => host.querySelector("button")!.click());
  expect(h.list.mock.calls.length).toBe(calls + 1);
  expect(button("studioChapters.title")).toBeDefined();
});

it("cover upload preserves unsaved metadata and advances only the reviewed version", async () => {
  const next = { ...row, version: row.version + 1, coverAssetId: id };
  h.upload.mockResolvedValue(id);
  h.cover.mockResolvedValue(next);
  await render();
  await click("studioProjects.details");
  await input(0, "My title");
  await input(1, "My description");
  await click("studioProjects.uploadCover");
  expect(h.cover).toHaveBeenCalledWith(row, id, 1, expect.any(AbortSignal));
  expect(host.querySelectorAll("input")[0].value).toBe("My title");
  expect(host.querySelectorAll("input")[1].value).toBe("My description");
  await click("studioProjects.save");
  expect(h.update).toHaveBeenCalledWith(
    next,
    { name: "My title", description: "My description" },
    1,
    expect.any(AbortSignal)
  );
});
it("cancelled selection never changes the cover", async () => {
  h.upload.mockResolvedValue(null);
  await render();
  await click("studioProjects.details");
  await click("studioProjects.uploadCover");
  expect(h.cover).not.toHaveBeenCalled();
});
it("refreshes uncertain cover writes without discarding drafts or automatically retrying", async () => {
  h.upload.mockResolvedValue(id);
  h.cover.mockRejectedValue(new PlatformProjectWriteError("Lost cover response"));
  h.read.mockResolvedValue({ ...row, version: row.version + 1, coverAssetId: id });
  await render();
  await click("studioProjects.details");
  await input(1, "Local description");
  await click("studioProjects.uploadCover");
  expect(button("studioProjects.uploadCover")!.disabled).toBe(true);
  await click("studioProjects.refreshDetails");
  expect(host.querySelectorAll("input")[1].value).toBe("Local description");
  expect(button("studioProjects.uploadCover")!.disabled).toBe(true);
  await click("studioProjects.reviewed");
  expect(button("studioProjects.uploadCover")!.disabled).toBe(false);
  expect(h.cover).toHaveBeenCalledTimes(1);
  expect(h.update).not.toHaveBeenCalled();
});

it("invalidates a prior detail review when another refresh fails without losing the draft", async () => {
  h.read
    .mockResolvedValueOnce({ ...row, version: row.version + 1 })
    .mockRejectedValueOnce(new Error("Access unavailable"));
  await render();
  await click("studioProjects.details");
  await input(1, "Retained description");
  await click("studioProjects.refreshDetails");
  expect(button("studioProjects.reviewed")).toBeDefined();
  await click("studioProjects.refreshDetails");
  expect(host.textContent).toContain("Access unavailable");
  expect(button("studioProjects.reviewed")).toBeUndefined();
  expect(button("studioProjects.save")!.disabled).toBe(true);
  expect(button("studioProjects.uploadCover")!.disabled).toBe(true);
  expect(host.querySelectorAll("input")[1].value).toBe("Retained description");
  h.read.mockResolvedValue({ ...row, version: row.version + 2 });
  await click("studioProjects.refreshDetails");
  await click("studioProjects.reviewed");
  expect(button("studioProjects.save")!.disabled).toBe(false);
  expect(h.update).not.toHaveBeenCalled();
});
it("requires another refresh after leaving an unaccepted review in the background", async () => {
  h.read.mockResolvedValue(row);
  await render();
  await click("studioProjects.details");
  await input(0, "Retained title");
  await click("studioProjects.refreshDetails");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(button("studioProjects.reviewed")).toBeUndefined();
  expect(button("studioProjects.save")!.disabled).toBe(true);
  expect(host.querySelector("input")!.value).toBe("Retained title");
  await click("studioProjects.discard");
  if (button("documentEditor.discard")) await click("documentEditor.discard");
  expect(button("studioProjects.create")!.disabled).toBe(false);
});

it("reopens the confirmed cover and version after closing details with unsaved text", async () => {
  const confirmed = { ...row, version: row.version + 1, coverAssetId: id };
  h.upload.mockResolvedValue(id);
  h.cover.mockResolvedValue(confirmed);
  await render();
  await click("studioProjects.details");
  await input(0, "Unsaved title");
  await click("studioProjects.uploadCover");
  await click("studioProjects.discard");
  if (button("documentEditor.discard")) await click("documentEditor.discard");
  await click("studioProjects.details");
  expect(host.querySelector("input")!.value).toBe(row.name);
  expect(button("studioProjects.removeCover")).toBeDefined();
  h.cover.mockResolvedValue({ ...confirmed, version: confirmed.version + 1, coverAssetId: null });
  await click("studioProjects.removeCover");
  expect(h.cover).toHaveBeenLastCalledWith(confirmed, null, 1, expect.any(AbortSignal));
  await click("studioProjects.discard");
  if (button("documentEditor.discard")) await click("documentEditor.discard");
  await click("studioProjects.details");
  expect(button("studioProjects.removeCover")).toBeUndefined();
});
it("keeps accepted refreshed metadata and permissions when reopening details", async () => {
  const fresh = { ...row, name: "Renamed on Web", role: "viewer", version: row.version + 1 };
  h.read.mockResolvedValue(fresh);
  await render();
  await click("studioProjects.details");
  await input(0, "Local title");
  await click("studioProjects.refreshDetails");
  await click("studioProjects.reviewed");
  expect(host.querySelector("input")!.value).toBe("Local title");
  await click("studioProjects.discard");
  if (button("documentEditor.discard")) await click("documentEditor.discard");
  await click("studioProjects.details");
  expect(host.querySelector("input")!.value).toBe("Renamed on Web");
  expect(button("studioProjects.save")).toBeUndefined();
  expect(button("studioProjects.uploadCover")).toBeUndefined();
  expect(h.update).not.toHaveBeenCalled();
});

it("keeps pending cover selection through background without losing metadata", async () => {
  let finish!: (id: string) => void;
  h.upload.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  h.cover.mockResolvedValue({ ...row, version: row.version + 1, coverAssetId: id });
  await render();
  await click("studioProjects.details");
  await input(0, "Unfinished title");
  await click("studioProjects.uploadCover");
  const signal = h.upload.mock.calls[0][2] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(false);
  h.active = true;
  await render();
  await act(async () => finish(id));
  expect(h.cover).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll("input")[0].value).toBe("Unfinished title");
  expect(h.update).not.toHaveBeenCalled();
});
it.each(["navigation", "account"])(
  "rejects a late cover selection after %s changes",
  async (reason) => {
    let finish!: (id: string) => void;
    h.upload.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        })
    );
    await render();
    await click("studioProjects.details");
    await click("studioProjects.uploadCover");
    const signal = h.upload.mock.calls[0][2] as AbortSignal;
    h.active = false;
    if (reason === "navigation") h.focused = false;
    else h.generation = 2;
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(id));
    expect(h.cover).not.toHaveBeenCalled();
  }
);

it("retains edits when cancelling Back and discards only after confirmation", async () => {
  await render();
  await click("studioProjects.details");
  await input(0, "Unsaved name");
  await click("common.back");
  expect(h.close).not.toHaveBeenCalled();
  await click("documentEditor.keepEditing");
  expect(host.querySelector("input")!.value).toBe("Unsaved name");
  await act(async () => {
    h.hardwareBack!();
  });
  await click("documentEditor.discard");
  expect(host.querySelector("input")).toBeNull();
  expect(h.close).not.toHaveBeenCalled();
  await click("common.back");
  expect(h.close).toHaveBeenCalledOnce();
});
it("guards route removal and resumes only the confirmed navigation", async () => {
  await render();
  await click("studioProjects.create");
  await input(0, "New draft");
  expect(h.prevent).toBe(true);
  const action = { type: "GO_BACK" };
  await act(async () => h.routeRemove!({ data: { action } }));
  await click("documentEditor.keepEditing");
  expect(h.dispatch).not.toHaveBeenCalled();
  expect(host.querySelector("input")!.value).toBe("New draft");
  await act(async () => h.routeRemove!({ data: { action } }));
  await click("documentEditor.discard");
  expect(h.dispatch).toHaveBeenCalledWith(action);
});
it("does not interrupt pending saves or block account retirement", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("studioProjects.details");
  await input(0, "Saving name");
  await click("studioProjects.save");
  const action = { type: "GO_BACK" };
  await act(async () => h.routeRemove!({ data: { action } }));
  expect(button("documentEditor.discard")).toBeUndefined();
  expect(h.dispatch).not.toHaveBeenCalled();
  h.generation++;
  await act(async () => h.routeRemove!({ data: { action } }));
  expect(h.dispatch).toHaveBeenCalledWith(action);
  await act(async () => finish());
});
