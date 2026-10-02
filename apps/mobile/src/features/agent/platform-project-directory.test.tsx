import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PlatformProjectDirectory } from "./platform-project-directory";
import { PlatformProjectWriteError } from "./api/platform-projects-api";
const h = vi.hoisted(() => ({
  cover: vi.fn(),
  upload: vi.fn(),
  read: vi.fn(),
  generation: 1,
  active: true,
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
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
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
