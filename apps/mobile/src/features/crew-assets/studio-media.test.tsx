import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StudioMedia } from "./studio-media";
const h = vi.hoisted(() => ({
  generation: 1,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  node: vi.fn(),
  context: vi.fn(),
  refresh: vi.fn(),
  loadMore: vi.fn(),
  items: [] as unknown[],
}));
vi.mock("./studio-media-api", () => ({
  fetchStudioMediaOptions: h.list,
  importStudioMedia: h.create,
  setStudioMediaLink: h.update,
  fetchStudioAssetNode: h.node,
}));
vi.mock("./api", () => ({ fetchCrewAssetContext: h.context }));
vi.mock("./use-crew-assets", () => ({
  useCrewAssets: () => ({
    items: h.items,
    loading: false,
    error: undefined,
    hasMore: false,
    refresh: h.refresh,
    loadMore: h.loadMore,
  }),
}));
vi.mock("../services/conversation-file", () => ({
  ConversationFile: ({ name }: { name: string }) => <span>Preview {name}</span>,
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
const workspace = { id: "00000000-0000-4000-8000-000000000001", name: "Studio" };
const media = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Clip",
  kind: "video",
  contentType: "video/mp4",
};
const node = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Crew File",
  kind: "file",
  effectivePermission: "manage",
  linkedStudio: { mediaAssetId: media.id, projectId: null, storyProjectId: null },
};
const label = { workspaceId: workspace.id, projects: [], items: [media] };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(<StudioMedia crewId="crew" userId="1" generation={1} onClose={h.close} />)
  );
const type = (index: number, value: string) =>
  act(async () => {
    const input = host.querySelectorAll("input")[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.list.mockResolvedValue(label);
  h.create.mockResolvedValue(label);
  h.update.mockResolvedValue(label);
  h.items = [];
  h.context.mockResolvedValue({ capabilities: { upload: true } });
  h.node.mockResolvedValue(node);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("imports into the root after explicit confirmation", async () => {
  await render();
  await click("studioMedia.importHere");
  expect(button("studioMedia.save")?.disabled).toBe(true);
  await click("Clip");
  await click("studioMedia.save");
  expect(h.create).not.toHaveBeenCalled();
  await click("studioMedia.confirm");
  expect(h.create).toHaveBeenCalledWith(
    "crew",
    "1",
    1,
    workspace.id,
    { projectId: null, storyProjectId: null },
    null,
    [media.id]
  );
  expect(h.refresh).toHaveBeenCalled();
});
it("disables root imports when upload is forbidden", async () => {
  h.context.mockResolvedValue({ capabilities: { upload: false } });
  await render();
  expect(button("studioMedia.importHere")?.disabled).toBe(true);
});
it("shows context errors and refreshes permissions", async () => {
  h.context.mockRejectedValue(new Error("Context failed"));
  await render();
  expect(host.textContent).toContain("Context failed");
  h.context.mockResolvedValue({ capabilities: { upload: true } });
  await click("thread.refresh");
  expect(button("studioMedia.importHere")?.disabled).toBe(false);
});
it("imports into a selected folder", async () => {
  h.items = [{ ...node, name: "Folder", kind: "folder" }];
  await render();
  await click("Folder");
  await click("studioMedia.importHere");
  await click("Clip");
  await click("studioMedia.save");
  await click("studioMedia.confirm");
  expect(h.create.mock.calls[0]?.[5]).toBe(node.id);
});
it("binds a selected media item to an existing file", async () => {
  h.items = [node];
  await render();
  await click("Crew File");
  await click("Clip");
  await click("studioMedia.save");
  await click("studioMedia.confirm");
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    "1",
    1,
    node,
    workspace.id,
    { projectId: null, storyProjectId: null },
    media.id
  );
});
it("confirms unlinking and retains original file", async () => {
  h.items = [node];
  await render();
  await click("Crew File");
  await click("studioMedia.unlink");
  expect(h.update).not.toHaveBeenCalled();
  await click("studioMedia.confirmUnlink");
  expect(h.update.mock.calls[0]?.[6]).toBeNull();
});
it("requires refreshed selection when changing project", async () => {
  h.list.mockResolvedValue({
    ...label,
    projects: [{ id: workspace.id, name: "Canvas", kind: "canvas" }],
  });
  await render();
  await click("studioMedia.importHere");
  await click("Clip");
  await click("Canvas · canvas");
  expect(button("studioMedia.save")?.disabled).toBe(true);
  expect(h.list.mock.calls.at(-1)?.[3]).toEqual({ projectId: workspace.id, storyProjectId: null });
});
it("blocks submission without a workspace", async () => {
  h.list.mockResolvedValue({ workspaceId: null, projects: [], items: [] });
  await render();
  await click("studioMedia.importHere");
  expect(host.textContent).toContain("studioMedia.noWorkspace");
  expect(button("studioMedia.save")?.disabled).toBe(true);
});
it("locks failed writes until fresh read", async () => {
  h.create.mockRejectedValue(new Error("Lost response"));
  await render();
  await click("studioMedia.importHere");
  await click("Clip");
  await click("studioMedia.save");
  await click("studioMedia.confirm");
  expect(host.textContent).toContain("studioMedia.recheck");
  expect(button("studioMedia.confirm")?.disabled).toBe(true);
  await click("thread.refresh");
  expect(button("studioMedia.save")?.disabled).toBe(true);
});
it("prevents duplicate confirmation and navigation during write", async () => {
  h.create.mockImplementation(() => new Promise(() => {}));
  await render();
  await click("studioMedia.importHere");
  await click("Clip");
  await click("studioMedia.save");
  await act(async () => {
    button("studioMedia.confirm")!.click();
    button("studioMedia.confirm")!.click();
  });
  expect(h.create).toHaveBeenCalledOnce();
  expect(button("crewTasks.back")?.disabled).toBe(true);
});
it("searches media without changing the selection", async () => {
  await render();
  await click("studioMedia.importHere");
  await click("Clip");
  await type(0, "missing");
  expect(button("Clip")).toBeUndefined();
  expect(button("studioMedia.save")?.disabled).toBe(false);
  await type(0, "");
  expect(button("Clip")).toBeTruthy();
});
it("ignores late Studio results after account replacement", async () => {
  let finish!: (v: unknown) => void;
  h.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("studioMedia.importHere");
  h.generation = 2;
  await act(async () => finish(label));
  expect(button("studioMedia.save")).toBeUndefined();
});
it("rechecks file permission before offering link controls", async () => {
  h.items = [node];
  h.node.mockResolvedValue({ ...node, effectivePermission: "view" });
  await render();
  await click("Crew File");
  expect(host.textContent).toContain("Manage permission");
  expect(button("studioMedia.save")).toBeUndefined();
});
