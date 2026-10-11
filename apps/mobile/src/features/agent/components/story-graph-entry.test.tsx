import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryGraphEntry } from "./story-graph-entry";
const h = vi.hoisted(() => ({
  graph: undefined as string | string[] | undefined,
  active: true,
  generation: 1,
  status: "authenticated",
  context: {
    projectId: "project",
    chapterId: "chapter",
    refresh: vi.fn(),
    capabilities: ["story.read"],
    loading: false,
    error: undefined as string | undefined,
  },
  setParams: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ graph: h.graph }),
  useRouter: () => ({ setParams: h.setParams }),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation, user: { id: "user" } }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("../context/story-chapter-context", () => ({ useStoryChapterContext: () => h.context }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("./story-repair-sheet", () => ({
  StoryRepairSheet: ({
    scope,
    onClose,
  }: {
    scope: { projectId: string };

    onClose(): void;
  }) => (
    <div data-graph={scope.projectId}>
      <button onClick={onClose}>Close graph</button>
    </div>
  ),
}));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = () => act(async () => root.render(<StoryGraphEntry />));
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.graph = undefined;
  h.active = true;
  h.generation = 1;
  h.status = "authenticated";
  h.context = {
    projectId: "project",
    chapterId: "chapter",
    refresh: vi.fn(),
    capabilities: ["story.read"],
    loading: false,
    error: undefined,
  };
  h.setParams.mockImplementation(() => {
    h.graph = undefined;
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("waits for access, opens exact graph and consumes intent without reopening after close", async () => {
  h.graph = "1";
  h.context.loading = true;
  await render();
  expect(h.setParams).not.toHaveBeenCalled();
  h.context.loading = false;
  await render();
  expect(host.querySelector("[data-graph]")?.getAttribute("data-graph")).toBe("project");
  expect(h.setParams).not.toHaveBeenCalled();
  await click("Close graph");
  expect(h.setParams).toHaveBeenCalledWith({ graph: undefined });
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(host.querySelector("[data-graph]")).toBeNull();
  h.graph = "1";
  await render();
  expect(host.querySelector("[data-graph]")).not.toBeNull();
});
it("waits through inactivity, authentication and denied access", async () => {
  h.graph = "1";
  h.active = false;
  await render();
  expect(h.setParams).not.toHaveBeenCalled();
  h.active = true;
  h.status = "anonymous";
  await render();
  expect(h.setParams).not.toHaveBeenCalled();
  h.status = "authenticated";
  h.context.error = "Denied";
  await render();
  expect(h.setParams).not.toHaveBeenCalled();
  h.context.error = undefined;
  h.context.capabilities = [];
  await render();
  expect(h.setParams).not.toHaveBeenCalled();
  h.context.capabilities = ["story.read", "story.edit"];
  await render();
  expect(host.querySelector("[data-graph]")).not.toBeNull();
});
it.each([undefined, "0", ["1", "1"]])("keeps manual entry for intent %s", async (value) => {
  h.graph = value;
  await render();
  expect(host.querySelector("[data-graph]")).toBeNull();
  await click("storyGraph.title");
  expect(host.querySelector("[data-graph]")).not.toBeNull();
});
it("does not carry open graph into another account or project", async () => {
  await render();
  await click("storyGraph.title");
  h.generation++;
  await render();
  expect(host.querySelector("[data-graph]")).toBeNull();
  await click("storyGraph.title");
  h.context.projectId = "other";
  await render();
  expect(host.querySelector("[data-graph]")).toBeNull();
});

it("waits for a chapter and scopes manual graph editing to that chapter", async () => {
  h.graph = "1";
  h.context.chapterId = "";
  await render();
  expect(host.querySelector("[data-graph]")).toBeNull();
  h.context.chapterId = "chapter";
  await render();
  expect(host.querySelector("[data-graph]")).not.toBeNull();
  await click("Close graph");
  await render();
  await click("storyGraph.title");
  h.context.chapterId = "another";
  await render();
  expect(host.querySelector("[data-graph]")).toBeNull();
});
