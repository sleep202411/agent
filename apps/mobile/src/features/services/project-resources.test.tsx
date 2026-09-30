import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ProjectResources } from "./project-resources";
const h = vi.hoisted(() => ({
  generation: 1,
  remove: vi.fn(),
  close: vi.fn(),
  read: vi.fn(),
  add: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./project-resources-api", async (original) => ({
  ...(await original<typeof import("./project-resources-api")>()),
  fetchProjectResources: h.read,
  addProjectResource: h.add,
  removeProjectResource: h.remove,
  resolveProjectResource: h.resolve,
}));
vi.mock("../crew-assets/asset-picker", () => ({
  CrewAssetPicker: ({ onSelect }: { onSelect: (v: unknown[]) => void }) => (
    <button
      onClick={() => onSelect([{ id: "22222222-2222-4222-8222-222222222222", name: "Movie" }])}
    >
      choose file
    </button>
  ),
}));
vi.mock("./conversation-file", () => ({ ConversationFile: () => <span>file preview</span> }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./user-displays", () => ({ useUserDisplays: () => new Map() }));
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const resource = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  kind: "link",
  title: "Guide",
  url: "https://example.com",
  assetNodeId: null,
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
};
const data = { resources: [resource], canManage: true };
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(<ProjectResources crewId="crew" userId="actor" generation={1} onClose={h.close} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.remove.mockResolvedValue(undefined);
  h.read.mockResolvedValue(data);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("requires confirmation to remove only a resource reference", async () => {
  await render();
  await click("projectResources.remove");
  expect(h.remove).not.toHaveBeenCalled();
  expect(host.textContent).toContain("projectResources.removeHelp");
  await click("projectResources.confirmRemove");
  expect(h.remove).toHaveBeenCalledWith("crew", "actor", 1, resource);
  expect(h.read).toHaveBeenCalledTimes(2);
});
it("keeps read-only resources accessible without mutation controls", async () => {
  h.read.mockResolvedValue({ ...data, canManage: false });
  await render();
  expect(button("projectResources.add")).toBeUndefined();
  expect(button("projectResources.remove")).toBeUndefined();
  expect(button("projectResources.open")).toBeDefined();
});
it("selects a Crew file and confirms before creation", async () => {
  await render();
  await click("projectResources.add");
  await click("projectResources.asset");
  await click("crewAssets.choose");
  await click("choose file");
  await click("projectResources.review");
  expect(h.add).not.toHaveBeenCalled();
  await click("projectResources.confirmAdd");
  expect(h.add).toHaveBeenCalledWith("crew", "actor", 1, {
    kind: "asset",
    title: "Movie",
    assetNodeId: "22222222-2222-4222-8222-222222222222",
  });
});
it("locks uncertain deletion until refreshing", async () => {
  h.remove.mockRejectedValue(new Error("Connection lost"));
  await render();
  await click("projectResources.remove");
  await click("projectResources.confirmRemove");
  expect(host.textContent).toContain("Connection lost");
  expect(button("projectResources.confirmRemove")!.disabled).toBe(true);
  await click("crewTasks.back");
  expect(h.read).toHaveBeenCalledTimes(2);
});
it("resolves files only when opened", async () => {
  h.resolve.mockResolvedValue({ kind: "asset", mediaAssetId: "media", name: "Movie" });
  await render();
  expect(h.resolve).not.toHaveBeenCalled();
  await click("projectResources.open");
  expect(host.textContent).toContain("file preview");
});
it("blocks duplicate requests", async () => {
  let finish!: () => void;
  h.remove.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await click("projectResources.remove");
  await act(async () => {
    button("projectResources.confirmRemove")!.click();
    button("projectResources.confirmRemove")!.click();
  });
  expect(h.remove).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});
it("blocks stale-account deletion", async () => {
  await render();
  await click("projectResources.remove");
  h.generation = 2;
  await click("projectResources.confirmRemove");
  expect(h.remove).not.toHaveBeenCalled();
});

it("validates link input and confirms before adding", async () => {
  await render();
  await click("projectResources.add");
  expect(button("projectResources.review")!.disabled).toBe(true);
  const type = async (value: string) =>
    act(async () => {
      const input = host.querySelectorAll("input")[1]!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await type("javascript:alert(1)");
  expect(button("projectResources.review")!.disabled).toBe(true);
  await type("https://example.com/guide");
  await click("projectResources.review");
  await click("projectResources.confirmAdd");
  expect(h.add).toHaveBeenCalledWith("crew", "actor", 1, {
    kind: "link",
    url: "https://example.com/guide",
  });
});
