import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryPlotImportAction } from "./story-plot-import";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  pick: vi.fn(),
  read: vi.fn(),
  done: vi.fn(),
  generation: 1,
  raw: null as string | null,
  active: true,
}));
vi.mock("@/config", () => ({ appEnv: { siteRegion: "global" } }));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: "authenticated", generation: h.generation, user: { id: "owner" } }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({
    read: () => h.raw,
    write: (s: string) => {
      h.raw = s;
    },
  }),
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000003" },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("../lib/plot-import-file", () => ({ readPlotImportFile: h.read }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn() },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div role="dialog">{children}</div> : null,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
    accessibilityState,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
    accessibilityRole: string;
    accessibilityState?: { checked?: boolean };
  }) => (
    <button
      role={accessibilityRole}
      aria-checked={accessibilityState?.checked}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = {
  projectId: id(1),
  chapterId: id(2),
  schemaVersion: "interactive-story-draft-v1",
  revision: 4,
  updatedBySessionId: null,
  content: { storyBible: { logline: "Keep" }, graph: { entryNodeId: null, nodes: [] } },
};
let root: Root, host: HTMLDivElement;
const render = (canEdit = true) =>
  act(async () =>
    root.render(
      <StoryPlotImportAction
        projectId={id(1)}
        chapterId={id(2)}
        canEdit={canEdit}
        onImported={h.done}
      />
    )
  );
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const confirm = () =>
  act(async () => host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.raw = null;
  h.get.mockResolvedValue({
    project: { id: id(1), capabilities: ["story.edit"] },
    chapter: { id: id(2) },
    draft,
  });
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ name: "plot.json", uri: "file://plot" }],
  });
  h.read.mockResolvedValue(
    JSON.stringify({
      entryNodeId: "opening",
      assets: [],
      nodes: [{ id: "opening", type: "scene", title: "Opening", next: null }],
    })
  );
  h.post.mockResolvedValue({
    draft: {
      ...draft,
      revision: 5,
      updatedBySessionId: id(3),
      content: {
        ...draft.content,
        graph: { entryNodeId: "imported", nodes: [{ nodeId: "imported" }] },
      },
    },
    importedNodeIds: ["imported"],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires current edit permission and explicit file/mode confirmation", async () => {
  await render(false);
  expect(host.textContent).toBe("");
  await render();
  await click("plotImport.title");
  await click("plotImport.choose");
  expect(button("plotImport.submit").disabled).toBe(true);
  await confirm();
  await click("plotImport.replace");
  expect(button("plotImport.submit").disabled).toBe(true);
  await confirm();
  await click("plotImport.submit");
  expect(h.post.mock.calls[0][1].data.mode).toBe("replace");
  expect(h.done).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("recovers a lost response after close/reopen without replaying it", async () => {
  h.post.mockRejectedValue(Error("Reply lost"));
  await render();
  await click("plotImport.title");
  await click("plotImport.choose");
  await confirm();
  await click("plotImport.submit");
  expect(host.textContent).toContain("plotImport.uncertain");
  await click("ipDetail.close");
  await click("plotImport.title");
  expect(host.textContent).toContain("plotImport.uncertain");
  expect(button("plotImport.choose")).toBeUndefined();
  expect(button("plotImport.clear").disabled).toBe(true);
  await click("plotImport.inspect");
  expect(host.textContent).toContain("entryNodeId");
  await confirm();
  await click("plotImport.clear");
  expect(button("plotImport.choose")).toBeDefined();
  expect(h.post).toHaveBeenCalledOnce();
  expect(h.done).not.toHaveBeenCalled();
});
it("ignores a late submission after closing and reopening", async () => {
  let finish!: (value: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("plotImport.title");
  await click("plotImport.choose");
  await confirm();
  await click("plotImport.submit");
  await click("ipDetail.close");
  await click("plotImport.title");
  await act(async () =>
    finish({ draft: { ...draft, revision: 5, updatedBySessionId: id(3) }, importedNodeIds: [] })
  );
  expect(host.textContent).toContain("plotImport.uncertain");
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(h.done).not.toHaveBeenCalled();
  expect(h.raw).toContain("plot.json");
});
it("exposes permission/read recovery and prevents import on a failed read", async () => {
  h.get.mockRejectedValueOnce(Error("Offline"));
  await render();
  await click("plotImport.title");
  expect(host.textContent).toContain("Offline");
  expect(button("plotImport.choose")).toBeUndefined();
  await click("plotImport.refresh");
  await click("plotImport.choose");
  expect(host.textContent).toContain("Opening");
  expect(h.post).not.toHaveBeenCalled();
});
it("reports invalid files without enabling submission", async () => {
  h.read.mockResolvedValue("not json");
  await render();
  await click("plotImport.title");
  await click("plotImport.choose");
  expect(host.textContent).toContain("plotImport.invalid");
  expect(button("plotImport.submit")).toBeUndefined();
  expect(h.post).not.toHaveBeenCalled();
});
