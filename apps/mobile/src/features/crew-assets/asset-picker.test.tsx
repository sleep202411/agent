import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewAssetPicker } from "./asset-picker";
import type { CrewAsset } from "./api";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  authenticated: true,
  items: [] as CrewAsset[],
  error: undefined as string | undefined,
  more: false,
  loading: false,
  accessDenied: false,
  load: vi.fn(),
  query: vi.fn(),
  select: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    generation: h.generation,
    status: h.authenticated ? "authenticated" : "anonymous",
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./use-crew-assets", () => ({
  useCrewAssets: (...args: unknown[]) => {
    h.query(...args);
    return {
      items: h.items,
      loading: h.loading,
      accessDenied: h.accessDenied,
      error: h.error,
      hasMore: h.more,
      loadMore: h.load,
      retry: h.load,
      refresh: h.load,
    };
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
    accessibilityLabel: string;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
  }: {
    value: string;
    onChangeText: (value: string) => void;
  }) => <input value={value} onChange={(e) => onChangeText(e.target.value)} />,
  FlatList: ({
    data,
    renderItem,
    ListEmptyComponent,
    ListFooterComponent,
  }: {
    data: CrewAsset[];
    renderItem: (args: { item: CrewAsset }) => ReactNode;
    ListEmptyComponent: ReactNode;
    ListFooterComponent: ReactNode;
  }) => (
    <div>
      {data.length
        ? data.map((item) => <div key={item.id}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
      {ListFooterComponent}
    </div>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const file: CrewAsset = {
  id: "file",
  parentId: null,
  name: "Film",
  kind: "file",
  status: "active",
  effectivePermission: "view",
  media: { id: "media", kind: "video", contentType: "video/mp4", sizeBytes: 100 },
};
const folder: CrewAsset = { ...file, id: "folder", name: "Episode", kind: "folder", media: null };
let root: Root, host: HTMLDivElement;
const render = (crewId = "crew", excludedIds: string[] = [], remaining = 2) =>
  act(async () =>
    root.render(
      <CrewAssetPicker
        crewId={crewId}
        excludedIds={excludedIds}
        remaining={remaining}
        onSelect={h.select}
        onClose={h.close}
      />
    )
  );
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label
  )!;
const click = (label: string) => act(async () => button(label).click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.authenticated = true;
  h.error = undefined;
  h.more = false;
  h.loading = false;
  h.accessDenied = false;
  h.items = [folder, file];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("browses folders and returns without accidentally selecting a folder", async () => {
  await render();
  await click("Episode");
  expect(h.query.mock.calls.at(-1)?.[2]).toMatchObject({ parentId: "folder", source: "all" });
  expect(h.select).not.toHaveBeenCalled();
  await click("crewAssets.back");
  expect(h.query.mock.calls.at(-1)?.[2].parentId).toBeUndefined();
  await click("crewAssets.source.favorites");
  expect(h.query.mock.calls.at(-1)?.[2]).toMatchObject({ source: "favorites" });
});
it("enforces remaining capacity and confirms a selection once", async () => {
  h.items = [file, { ...file, id: "second", name: "Second" }];
  await render("crew", [], 1);
  await click("Film");
  expect(button("Second").disabled).toBe(true);
  await act(async () => {
    button("crewAssets.attach").click();
    button("crewAssets.attach").click();
  });
  expect(h.select).toHaveBeenCalledExactlyOnceWith([file]);
});
it("excludes attached files and files with no media", async () => {
  h.items = [file, { ...file, id: "missing", name: "Missing", media: null }];
  await render("crew", ["file"]);
  expect(button("Film").disabled).toBe(true);
  expect(button("Missing").disabled).toBe(true);
  expect(button("crewAssets.attach").disabled).toBe(true);
});
it("resets selections on account, Crew and foreground changes", async () => {
  await render();
  await click("Film");
  h.generation = 2;
  await render();
  expect(button("crewAssets.attach").disabled).toBe(true);
  await click("Film");
  await render("other");
  expect(button("crewAssets.attach").disabled).toBe(true);
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  await render();
  expect(button("crewAssets.attach").disabled).toBe(true);
});
it("keeps load-more available on empty permission-filtered pages and blocks error confirmation", async () => {
  h.items = [];
  h.more = true;
  await render();
  await click("crewAssets.more");
  expect(h.load).toHaveBeenCalledTimes(1);
  h.items = [file];
  await render();
  await click("Film");
  h.error = "Access revoked";
  await render();
  expect(button("crewAssets.attach").disabled).toBe(true);
  expect(host.textContent).toContain("Access revoked");
});
it("requires an explicit search and never submits stale-account selections", async () => {
  await render();
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      " Clip "
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(h.query.mock.calls.at(-1)?.[2].query).toBeUndefined();
  await click("crewAssets.searchAction");
  expect(h.query.mock.calls.at(-1)?.[2].query).toBe("Clip");
  await click("Film");
  h.generation = 3;
  await click("crewAssets.attach");
  expect(h.select).not.toHaveBeenCalled();
});
it("can remove selected files after navigating away and release capacity", async () => {
  await render("crew", [], 1);
  await click("Film");
  await click("Episode");
  h.items = [{ ...file, id: "new", name: "New" }];
  await render("crew", [], 1);
  expect(button("New").disabled).toBe(true);
  await click("crewAssets.remove Film");
  expect(button("New").disabled).toBe(false);
  await click("New");
  await click("crewAssets.attach");
  expect(h.select.mock.calls[0][0][0].id).toBe("new");
});

it("removes revoked selections and does not restore them after retry", async () => {
  await render();
  await click("Film");
  expect(button("crewAssets.attach").disabled).toBe(false);
  h.accessDenied = true;
  h.error = "Access revoked";
  h.items = [];
  await render();
  expect(host.textContent).not.toContain("Film");
  expect(button("crewAssets.attach").disabled).toBe(true);
  h.error = undefined;
  h.loading = true;
  await render();
  expect(button("crewAssets.attach").disabled).toBe(true);
  h.loading = false;
  h.accessDenied = false;
  h.items = [file];
  await render();
  expect(button("crewAssets.attach").disabled).toBe(true);
  await click("Film");
  await click("crewAssets.attach");
  expect(h.select).toHaveBeenCalledWith([file]);
});
it("retains selections on network failure but prevents attachment during retry", async () => {
  await render();
  await click("Film");
  h.error = "offline";
  await render();
  expect(button("crewAssets.attach").disabled).toBe(true);
  h.error = undefined;
  h.loading = true;
  await render();
  expect(button("crewAssets.attach").disabled).toBe(true);
  h.loading = false;
  await render();
  await click("crewAssets.attach");
  expect(h.select).toHaveBeenCalledWith([file]);
});
