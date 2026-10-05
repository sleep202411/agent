import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryCanvasEntry } from "./story-canvas-entry";
const h = vi.hoisted(() => ({
  canvas: undefined as string | string[] | undefined,
  active: true,
  generation: 1,
  status: "authenticated",
  context: {
    projectId: "project",
    capabilities: ["story.read"],
    loading: false,
    error: undefined as string | undefined,
  },
  setParams: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ canvas: h.canvas }),
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
vi.mock("./story-canvas-panel", () => ({
  StoryCanvasPanel: ({
    scope,
    canEdit,
    close,
  }: {
    scope: { projectId: string };
    canEdit: boolean;
    close(): void;
  }) => (
    <div data-canvas={scope.projectId} data-edit={String(canEdit)}>
      <button onClick={close}>Close canvas</button>
    </div>
  ),
}));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = () => act(async () => root.render(<StoryCanvasEntry />));
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.canvas = undefined;
  h.active = true;
  h.generation = 1;
  h.status = "authenticated";
  h.context = {
    projectId: "project",
    capabilities: ["story.read"],
    loading: false,
    error: undefined,
  };
  h.setParams.mockImplementation(() => {
    h.canvas = undefined;
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("waits for access, opens exact canvas and consumes intent without reopening after close", async () => {
  h.canvas = "1";
  h.context.loading = true;
  await render();
  expect(h.setParams).not.toHaveBeenCalled();
  h.context.loading = false;
  await render();
  expect(host.querySelector("[data-canvas]")?.getAttribute("data-edit")).toBe("false");
  expect(h.setParams).not.toHaveBeenCalled();
  await click("Close canvas");
  expect(h.setParams).toHaveBeenCalledWith({ canvas: undefined });
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(host.querySelector("[data-canvas]")).toBeNull();
  h.canvas = "1";
  await render();
  expect(host.querySelector("[data-canvas]")).not.toBeNull();
});
it("waits through inactivity, authentication and denied access", async () => {
  h.canvas = "1";
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
  expect(host.querySelector("[data-canvas]")?.getAttribute("data-edit")).toBe("true");
});
it.each([undefined, "0", ["1", "1"]])("keeps manual entry for intent %s", async (value) => {
  h.canvas = value;
  await render();
  expect(host.querySelector("[data-canvas]")).toBeNull();
  await click("storyCanvas.title");
  expect(host.querySelector("[data-canvas]")).not.toBeNull();
});
it("does not carry open canvas into another account or project", async () => {
  await render();
  await click("storyCanvas.title");
  h.generation++;
  await render();
  expect(host.querySelector("[data-canvas]")).toBeNull();
  await click("storyCanvas.title");
  h.context.projectId = "other";
  await render();
  expect(host.querySelector("[data-canvas]")).toBeNull();
});
