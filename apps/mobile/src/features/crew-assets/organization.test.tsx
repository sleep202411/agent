import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AssetOrganization } from "./organization";
const h = vi.hoisted(() => ({
  generation: 1,
  listing: vi.fn(),
  preview: vi.fn(),
  folders: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  favorite: vi.fn(),
  close: vi.fn(),
  node: vi.fn(),
  location: vi.fn(),
  context: vi.fn(),
  refresh: vi.fn(),
  items: [] as unknown[],
}));
vi.mock("../services/conversation-file", () => ({
  ConversationFile: (props: unknown) => {
    h.preview(props);
    return <span>file preview</span>;
  },
}));
vi.mock("./file-upload", () => ({
  AssetFileUpload: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close upload</button>
  ),
}));
vi.mock("./permissions", () => ({
  AssetPermissions: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close permissions</button>
  ),
}));
vi.mock("./lifecycle", () => ({
  AssetTrash: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close trash</button>
  ),
  AssetLifecycleAction: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close lifecycle</button>
  ),
}));
vi.mock("./organization-api", async (original) => ({
  ...(await original<typeof import("./organization-api")>()),
  fetchOrganizationFolders: h.folders,
  fetchOrganizationNode: h.node,
  fetchOrganizationLocation: h.location,
  createOrganizationFolder: h.create,
  updateOrganizationNode: h.update,
  setOrganizationFavorite: h.favorite,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./api", () => ({ fetchCrewAssetContext: h.context }));
vi.mock("./use-crew-assets", () => ({
  useCrewAssets: (...args: unknown[]) => {
    h.listing(...args);
    return {
      items: h.items,
      loading: false,
      error: undefined,
      hasMore: false,
      refresh: h.refresh,
    };
  },
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
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const node = {
  id: id(1),
  name: "Art",
  kind: "folder",
  parentId: null,
  effectivePermission: "manage",
  favorite: false,
  updatedAt: "2026-09-30T00:00:00Z",
};
const folder = { id: id(2), name: "Destination", parentId: null, effectivePermission: "upload" };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(<AssetOrganization crewId="crew" userId="1" generation={1} onClose={h.close} />)
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
  h.items = [node];
  h.node.mockResolvedValue(node);
  h.location.mockResolvedValue({ node, path: [] });
  h.folders.mockResolvedValue([folder]);
  h.context.mockResolvedValue({ capabilities: { view: true, upload: true } });
  h.create.mockResolvedValue(node);
  h.update.mockResolvedValue(node);
  h.favorite.mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("creates a folder with an explicit destination and confirmation", async () => {
  await render();
  await click("assetOrganization.create");
  expect(button("assetOrganization.save")?.disabled).toBe(true);
  await type(0, " New ");
  await click("Destination");
  await click("assetOrganization.save");
  expect(h.create).not.toHaveBeenCalled();
  await click("assetOrganization.confirm");
  expect(h.create).toHaveBeenCalledWith("crew", "1", 1, "New", folder.id);
  expect(h.refresh).toHaveBeenCalled();
});
it("renames from captured details and blocks no-op writes", async () => {
  await render();
  await click("assetOrganization.manage: Art");
  expect(button("assetOrganization.save")?.disabled).toBe(true);
  await type(0, "New");
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(h.update).toHaveBeenCalledWith("crew", "1", 1, node, { name: "New", parentId: null });
});
it("moves after confirmation and removes self and descendants", async () => {
  h.folders.mockResolvedValue([
    folder,
    { ...folder, id: node.id, name: "Self" },
    { ...folder, id: id(3), parentId: node.id, name: "Child" },
  ]);
  await render();
  await click("assetOrganization.manage: Art");
  expect(button("Self")).toBeUndefined();
  expect(button("Child")).toBeUndefined();
  await click("Destination");
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(h.update.mock.calls[0]?.[4]).toEqual({ name: "Art", parentId: folder.id });
});
it("allows favorites for view-only members while disabling edits", async () => {
  h.node.mockResolvedValue({ ...node, effectivePermission: "view" });
  await render();
  await click("assetOrganization.manage: Art");
  expect(host.querySelector("input")?.disabled).toBe(true);
  await click("assetOrganization.favorite");
  expect(h.favorite).toHaveBeenCalledWith("crew", "1", 1, node.id, true);
  expect(h.update).not.toHaveBeenCalled();
});
it("removes a favorite explicitly", async () => {
  h.node.mockResolvedValue({ ...node, favorite: true });
  await render();
  await click("assetOrganization.manage: Art");
  await click("assetOrganization.unfavorite");
  expect(h.favorite.mock.calls[0]?.[4]).toBe(false);
});
it("blocks root creation without upload permission", async () => {
  h.context.mockResolvedValue({ capabilities: { view: true, upload: false } });
  await render();
  await click("assetOrganization.create");
  await type(0, "New");
  expect(button("assetOrganization.save")?.disabled).toBe(true);
  await click("Destination");
  expect(button("assetOrganization.save")?.disabled).toBe(false);
});
it("keeps an unchanged inaccessible parent during rename", async () => {
  h.node.mockResolvedValue({ ...node, parentId: id(8) });
  await render();
  await click("assetOrganization.manage: Art");
  await type(0, "New");
  expect(button("assetOrganization.save")?.disabled).toBe(false);
  expect(host.textContent).toContain("assetOrganization.keepParent");
});
it("locks uncertain writes until a fresh read", async () => {
  h.update.mockRejectedValue(new Error("Conflict"));
  await render();
  await click("assetOrganization.manage: Art");
  await type(0, "New");
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(host.textContent).toContain("assetOrganization.recheck");
  expect(button("assetOrganization.confirm")?.disabled).toBe(true);
  await click("thread.refresh");
  expect(button("assetOrganization.save")?.disabled).toBe(true);
});
it("blocks duplicate writes and navigation during saving", async () => {
  h.create.mockImplementation(() => new Promise(() => {}));
  await render();
  await click("assetOrganization.create");
  await type(0, "New");
  await click("assetOrganization.save");
  await act(async () => {
    button("assetOrganization.confirm")!.click();
    button("assetOrganization.confirm")!.click();
  });
  expect(h.create).toHaveBeenCalledOnce();
  expect(button("crewTasks.back")?.disabled).toBe(true);
});
it("does not accept old-account reads", async () => {
  let finish!: (v: unknown) => void;
  h.node.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("assetOrganization.manage: Art");
  h.generation = 2;
  await act(async () => finish(node));
  expect(button("assetOrganization.save")).toBeUndefined();
});

it("opens trash and returns to refreshed assets", async () => {
  await render();
  await click("assetLifecycle.trash");
  expect(button("close trash")).toBeTruthy();
  await click("close trash");
  expect(h.refresh).toHaveBeenCalled();
});
it("opens trash confirmation from asset details", async () => {
  await render();
  await click("assetOrganization.manage: Art");
  await click("assetLifecycle.moveTrash");
  expect(button("close lifecycle")).toBeTruthy();
  await click("close lifecycle");
  expect(h.refresh).toHaveBeenCalled();
});

it("opens asset permissions from its editor", async () => {
  await render();
  await click("assetOrganization.manage: Art");
  await click("assetPermissions.title");
  await click("close permissions");
  expect(h.refresh).toHaveBeenCalled();
});

it("applies trimmed search only when submitted and sends sorting to the server", async () => {
  await render();
  await type(0, "  Art  ");
  expect(h.listing.mock.lastCall?.[2].query).toBeUndefined();
  await click("crewAssets.searchAction");
  expect(h.listing.mock.lastCall?.[2]).toMatchObject({ query: "Art", sort: "modified" });
  await click("assetOrganization.sort.size");
  expect(h.listing.mock.lastCall?.[2]).toMatchObject({ query: "Art", sort: "size" });
  await click("assetOrganization.clearSearch");
  expect(h.listing.mock.lastCall?.[2].query).toBeUndefined();
  expect(host.querySelector("input")!.value).toBe("");
});
it("clears search when entering and leaving a folder", async () => {
  await render();
  await type(0, "Art");
  await click("crewAssets.searchAction");
  await click("Art");
  expect(h.listing.mock.lastCall?.[2]).toMatchObject({ parentId: id(1), query: undefined });
  await type(0, "Nested");
  await click("crewAssets.searchAction");
  await click("crewAssets.back");
  expect(h.listing.mock.lastCall?.[2]).toMatchObject({ parentId: undefined, query: undefined });
});
it("clears folder and search when switching to favorites", async () => {
  await render();
  await click("Art");
  await type(0, "Nested");
  await click("crewAssets.searchAction");
  await click("crewAssets.source.favorites");
  expect(h.listing.mock.lastCall?.[2]).toEqual({
    source: "favorites",
    parentId: undefined,
    query: undefined,
    sort: "modified",
  });
});
it("opens media using its media ID rather than the asset node ID", async () => {
  h.items = [
    { ...node, kind: "file", media: { id: id(8), kind: "video", contentType: "video/mp4" } },
  ];
  await render();
  expect(h.preview).toHaveBeenCalledWith({
    mediaAssetId: id(8),
    name: "Art",
    mediaKind: "video",
    contentType: "video/mp4",
  });
});
it("does not offer media preview for folders or files without media", async () => {
  h.items = [node, { ...node, id: id(2), kind: "file", media: null }];
  await render();
  expect(h.preview).not.toHaveBeenCalled();
});
it("shows the empty state for an empty completed listing", async () => {
  h.items = [];
  await render();
  expect(host.textContent).toContain("crewAssets.empty");
});

it("opens file upload and refreshes the list on return", async () => {
  await render();
  await click("thread.uploadFile");
  await click("close upload");
  expect(h.refresh).toHaveBeenCalled();
});

it("uses the real parent path when entering a favorite folder", async () => {
  h.location
    .mockResolvedValueOnce({
      node: { ...node, parentId: id(2) },
      path: [{ id: id(2), name: "Parent" }],
    })
    .mockResolvedValueOnce({
      node: { ...node, id: id(2), name: "Parent", parentId: null },
      path: [],
    });
  await render();
  await click("crewAssets.source.favorites");
  await click("Art");
  expect(host.textContent).toContain("Parent / Art");
  await click("crewAssets.back");
  expect(h.location.mock.calls[1]?.[3]).toBe(id(2));
  expect(h.listing.mock.lastCall?.[2].parentId).toBe(id(2));
});
it("preserves the current view when a folder lookup fails", async () => {
  h.location.mockRejectedValue(new Error("Access revoked"));
  await render();
  await click("crewAssets.source.favorites");
  await click("Art");
  expect(host.textContent).toContain("Access revoked");
  expect(h.listing.mock.lastCall?.[2].source).toBe("favorites");
});
it("cancels folder navigation and ignores its late response", async () => {
  let finish!: (v: unknown) => void;
  h.location.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  await click("Art");
  const signal = h.location.mock.calls[0]![4];
  await click("crewTasks.back");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ node, path: [{ id: id(2), name: "Late" }] }));
  expect(host.textContent).not.toContain("Late");
  expect(h.listing.mock.lastCall?.[2].parentId).toBeUndefined();
});
it("does not navigate with a previous account response", async () => {
  let finish!: (v: unknown) => void;
  h.location.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  await click("Art");
  h.generation = 2;
  await act(async () => finish({ node, path: [] }));
  expect(h.listing.mock.lastCall?.[2].parentId).toBeUndefined();
});

it("opens the requested asset through the existing authorized node lookup", async () => {
  await act(async () =>
    root.render(
      <AssetOrganization
        crewId="crew"
        userId="1"
        generation={1}
        initialNodeId={node.id}
        onClose={h.close}
      />
    )
  );
  expect(h.node).toHaveBeenCalledWith("crew", "1", 1, node.id, expect.any(AbortSignal));
  expect(host.querySelector("input")?.value).toBe("Art");
  h.node.mockRejectedValue(new Error("Asset access revoked"));
  await act(async () =>
    root.render(
      <AssetOrganization
        crewId="crew"
        userId="1"
        generation={1}
        initialNodeId={id(3)}
        onClose={h.close}
      />
    )
  );
  expect(host.textContent).toContain("Asset access revoked");
  expect(host.querySelector("input")).toBeNull();
});

it("does not treat an invalid external asset ID as the new-folder action", async () => {
  h.node.mockRejectedValue(new Error("Invalid asset ID"));
  await act(async () =>
    root.render(
      <AssetOrganization
        crewId="crew"
        userId="1"
        generation={1}
        initialNodeId="new"
        onClose={h.close}
      />
    )
  );
  expect(h.node).toHaveBeenCalledWith("crew", "1", 1, "new", expect.any(AbortSignal));
  expect(host.textContent).toContain("Invalid asset ID");
  expect(h.create).not.toHaveBeenCalled();
});

it("does not expose earlier asset details when the final context check denies view", async () => {
  h.context.mockResolvedValue({ capabilities: { view: false, upload: true } });
  await act(async () =>
    root.render(
      <AssetOrganization
        crewId="crew"
        userId="1"
        generation={1}
        initialNodeId={node.id}
        onClose={h.close}
      />
    )
  );
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(host.textContent).not.toContain(node.name);
  expect(host.textContent).toContain("studioMedia.accessDenied");
  expect(button("assetOrganization.favorite")).toBeUndefined();
  h.context.mockResolvedValue({ capabilities: { view: true, upload: true } });
  await click("thread.refresh");
  expect(host.querySelector("input")?.value).toBe(node.name);
  expect(h.update).not.toHaveBeenCalled();
});
