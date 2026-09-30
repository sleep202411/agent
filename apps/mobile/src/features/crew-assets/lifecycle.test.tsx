import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AssetTrash, AssetLifecycleAction } from "./lifecycle";
const h = vi.hoisted(() => ({
  generation: 1,
  list: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./lifecycle-api", () => ({
  fetchAssetTrash: h.list,
  trashOrganizationAsset: h.trash,
  restoreOrganizationAsset: h.restore,
  permanentlyDeleteOrganizationAsset: h.remove,
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
  kind: "folder" as const,
  parentId: null,
  status: "trashed" as const,
  effectivePermission: "manage" as const,
  favorite: false,
  updatedAt: "2026-09-30T00:00:00Z",
  trashedAt: "2026-09-30T00:00:00Z",
  media: null,
  linkedStudio: null,
};
const page = { items: [node], nextCursor: null };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(<AssetTrash crewId="crew" userId="1" generation={1} onClose={h.close} />)
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
  h.list.mockResolvedValue(page);
  h.trash.mockResolvedValue(undefined);
  h.restore.mockResolvedValue({ ...node, status: "active" });
  h.remove.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("requires a restore confirmation and refreshes trash", async () => {
  await render();
  await click("Art");
  await click("assetLifecycle.restore");
  expect(h.restore).not.toHaveBeenCalled();
  await click("assetLifecycle.confirmRestore");
  expect(h.restore).toHaveBeenCalledWith("crew", "1", 1, node);
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("requires the exact asset name before permanent deletion", async () => {
  await render();
  await click("Art");
  await click("assetLifecycle.delete");
  expect(button("assetLifecycle.confirmDelete")?.disabled).toBe(true);
  await type(0, "art");
  expect(button("assetLifecycle.confirmDelete")?.disabled).toBe(true);
  await type(0, "Art");
  await click("assetLifecycle.confirmDelete");
  expect(h.remove).toHaveBeenCalledWith("crew", "1", 1, node);
});
it("hides permanent deletion for edit-only users", async () => {
  h.list.mockResolvedValue({ items: [{ ...node, effectivePermission: "edit" }], nextCursor: null });
  await render();
  await click("Art");
  expect(button("assetLifecycle.delete")).toBeUndefined();
  expect(button("assetLifecycle.restore")?.disabled).toBe(false);
});
it("confirms moving an active asset to trash", async () => {
  const active = { ...node, status: "active" as const };
  await act(async () =>
    root.render(
      <AssetLifecycleAction
        crewId="crew"
        userId="1"
        generation={1}
        node={active}
        onClose={h.close}
      />
    )
  );
  await click("assetLifecycle.moveTrash");
  expect(h.trash).not.toHaveBeenCalled();
  await click("assetLifecycle.confirmTrash");
  expect(h.trash).toHaveBeenCalledWith("crew", "1", 1, active);
  expect(h.close).toHaveBeenCalledOnce();
});
it("continues through empty pages with more results", async () => {
  h.list.mockResolvedValueOnce({ items: [], nextCursor: id(9) }).mockResolvedValueOnce(page);
  await render();
  expect(host.textContent).not.toContain("assetLifecycle.empty");
  await click("crewAssets.more");
  expect(button("Art")).toBeTruthy();
});
it("blocks repeated pagination cursors", async () => {
  h.list.mockResolvedValue({ items: [], nextCursor: id(9) });
  await render();
  await click("crewAssets.more");
  expect(host.textContent).toContain("pagination did not advance");
});
it("prevents duplicate deletes and navigation while pending", async () => {
  h.remove.mockImplementation(() => new Promise(() => {}));
  await render();
  await click("Art");
  await click("assetLifecycle.delete");
  await type(0, "Art");
  await act(async () => {
    button("assetLifecycle.confirmDelete")!.click();
    button("assetLifecycle.confirmDelete")!.click();
  });
  expect(h.remove).toHaveBeenCalledOnce();
  expect(button("crewTasks.back")?.disabled).toBe(true);
});
it("locks failed restoration until returning to fresh trash", async () => {
  h.restore.mockRejectedValue(new Error("Restore ancestor first"));
  await render();
  await click("Art");
  await click("assetLifecycle.restore");
  await click("assetLifecycle.confirmRestore");
  expect(host.textContent).toContain("assetLifecycle.recheck");
  expect(button("assetLifecycle.confirmRestore")?.disabled).toBe(true);
  await click("crewTasks.back");
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("ignores old-account list responses", async () => {
  let finish!: (v: unknown) => void;
  h.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => finish(page));
  expect(button("Art")).toBeUndefined();
});
