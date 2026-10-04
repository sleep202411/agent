import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryRepairSheet } from "./story-repair-sheet";
const h = vi.hoisted(() => ({
  generation: 1,
  reconcile: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  discard: vi.fn(),
  close: vi.fn(),
  saved: vi.fn(),
  records: new Map<string, string>(),
  alert: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "en-US" }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000003" },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (...parts: string[]) => ({
    read: () => h.records.get(parts.join("/")) ?? null,
    write: (v: string) => h.records.set(parts.join("/"), v),
  }),
}));
vi.mock("../api/story-draft-repair-api", () => ({
  parseStoryRepairCommand: (v: unknown) => v,
  storyRepairPending: () => ({
    reconcile: h.reconcile,
    save: h.save,
    read: h.read,
    discard: h.discard,
  }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Alert: { alert: h.alert },
  TextInput: ({ value }: { value: string }) => <input value={value} readOnly />,
  ActivityIndicator: () => <span>Loading</span>,
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityRole: string;
  }) => (
    <button role={accessibilityRole} onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
const scope = {
  projectId: "00000000-0000-4000-8000-000000000001",
  chapterId: "00000000-0000-4000-8000-000000000002",
  generation: 1,
};
const draft = {
  ...scope,
  schemaVersion: "interactive-story-draft-v1",
  revision: 4,
  updatedBySessionId: null,
  content: {
    graph: {
      entryNodeId: "clip:a",
      nodes: [
        { nodeId: "clip:a", name: "A", exit: { kind: "auto", routes: [{ target: null }] } },
        { nodeId: "clip:b", name: "B" },
      ],
    },
  },
};
const result = { draft, canEdit: true, pending: null, applied: false };
let host: HTMLDivElement, root: Root;
const render = () =>
  act(async () =>
    root.render(
      <StoryRepairSheet
        scope={scope}
        userId="user"
        issues={[{ message: "Choose a destination", nodeId: "clip:a" }]}
        onClose={h.close}
        onSaved={h.saved}
      />
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.reconcile.mockResolvedValue(result);
  h.read.mockReturnValue(null);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("persists branch edits before saving and restores them after reopening", async () => {
  await render();
  await click("○ B");
  expect([...h.records.values()][0]).toContain('"nodeId":"clip:b"');
  await act(async () => root.render(null));
  await render();
  expect(button("● B")).toBeDefined();
  h.save.mockImplementation(async (command) => ({
    ...draft,
    revision: 5,
    content: command.input.content,
  }));
  await click("documentEditor.save");
  expect(h.save).toHaveBeenCalledOnce();
  expect(h.saved).toHaveBeenCalledOnce();
  expect([...h.records.values()][0]).toBe("null");
});
it("retains the repair on uncertain writes and requires reconciliation before editing", async () => {
  await render();
  await click("○ B");
  h.save.mockRejectedValue(Error("Connection lost"));
  h.read.mockReturnValue({ clientKey: "pending" });
  await click("documentEditor.save");
  expect(host.textContent).toContain("Connection lost");
  expect(button("○ A").disabled).toBe(true);
  expect([...h.records.values()][0]).toContain('"nodeId":"clip:b"');
});
it("shows read-only destinations without allowing changes", async () => {
  h.reconcile.mockResolvedValue({ ...result, canEdit: false });
  await render();
  expect(button("○ B").disabled).toBe(true);
  expect(button("documentEditor.save").disabled).toBe(true);
  expect(h.records.size).toBe(0);
});
it("does not expose stale chapter controls after a failed refresh", async () => {
  await render();
  h.reconcile.mockRejectedValue(Error("Access revoked"));
  await click("common.retry");
  expect(host.textContent).toContain("Access revoked");
  expect(button("○ B")).toBeUndefined();
});
it("preserves local edits on revision conflict and supports saved-content comparison", async () => {
  await render();
  await click("○ B");
  h.reconcile.mockResolvedValue({ ...result, draft: { ...draft, revision: 5 } });
  await click("common.retry");
  expect(host.textContent).toContain("storyRepair.conflict");
  expect(button("documentEditor.save").disabled).toBe(true);
  await click("storyRepair.remote");
  expect(button("○ B").disabled).toBe(true);
  await click("storyRepair.local");
  expect(button("● B").disabled).toBe(true);
  await click("storyRepair.discard");
  expect([...h.records.values()][0]).not.toBe("null");
  await act(async () => h.alert.mock.calls.at(-1)![2][1].onPress());
  expect([...h.records.values()][0]).toBe("null");
  expect(host.textContent).not.toContain("storyRepair.conflict");
});
it("retains the draft after a late save response for a previous account", async () => {
  await render();
  await click("○ B");
  let resolve!: (value: unknown) => void;
  h.save.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  await click("documentEditor.save");
  h.generation = 2;
  await act(async () => resolve({ ...draft, revision: 5 }));
  expect(h.saved).not.toHaveBeenCalled();
  expect([...h.records.values()][0]).not.toBe("null");
});
it("locks edits when storage cannot establish a failed save outcome", async () => {
  await render();
  await click("○ B");
  h.save.mockRejectedValue(Error("Connection lost"));
  h.read.mockImplementation(() => {
    throw Error("Storage unavailable");
  });
  await click("documentEditor.save");
  expect(host.textContent).toContain("Connection lost");
  expect(button("○ A").disabled).toBe(true);
  expect([...h.records.values()][0]).not.toBe("null");
});

it("repairs a missing entry node and preserves branch edits in the same draft", async () => {
  h.reconcile.mockResolvedValue({
    ...result,
    draft: {
      ...draft,
      content: { ...draft.content, graph: { ...draft.content.graph, entryNodeId: null } },
    },
  });
  await render();
  await click("○ B");
  await click("storyRepair.entry: storyRepair.entryMissing");
  await click("○ A");
  const local = JSON.parse([...h.records.values()][0]);
  expect(local.input.content.graph.entryNodeId).toBe("clip:a");
  expect(local.input.content.graph.nodes[0].exit.routes[0].target.nodeId).toBe("clip:b");
  await act(async () => root.render(null));
  await render();
  expect(button("storyRepair.entry: A")).toBeDefined();
});

it("requires confirmation to remove a choice and keeps the other branch intact", async () => {
  h.reconcile.mockResolvedValue({
    ...result,
    draft: {
      ...draft,
      content: {
        graph: {
          ...draft.content.graph,
          nodes: [
            {
              nodeId: "clip:a",
              name: "A",
              exit: {
                kind: "choice",
                decisionId: "decision:a",
                prompt: {},
                choices: [
                  { choiceId: "first", label: { "en-US": "First" }, target: null },
                  { choiceId: "second", label: { "en-US": "Second" }, target: null },
                ],
              },
            },
            draft.content.graph.nodes[1],
          ],
        },
      },
    },
  });
  await render();
  await click("storyRepair.moveDown");
  expect(
    JSON.parse([...h.records.values()][0]).input.content.graph.nodes[0].exit.choices[0].choiceId
  ).toBe("second");
  await click("storyRepair.removeChoice");
  expect(
    JSON.parse([...h.records.values()][0]).input.content.graph.nodes[0].exit.choices
  ).toHaveLength(2);
  await act(async () => h.alert.mock.calls.at(-1)![2][1].onPress());
  expect(
    JSON.parse([...h.records.values()][0]).input.content.graph.nodes[0].exit.choices.map(
      (c: { choiceId: string }) => c.choiceId
    )
  ).toEqual(["first"]);
});
