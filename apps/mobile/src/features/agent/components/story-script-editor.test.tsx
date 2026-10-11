import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryScriptEditor } from "./story-script-editor";
import type { createScriptEditorHost } from "../lib/story-script-editor-host";
const h = vi.hoisted(() => ({ open: vi.fn(), reload: vi.fn(), create: vi.fn(), active: true }));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: "authenticated", generation: 1, user: { id: "owner" } }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "session" } }));
vi.mock("../api/story-script-collaboration", () => ({
  openScriptCollaboration: h.open,
  reloadScriptCollaboration: h.reload,
}));
vi.mock("../lib/story-script-editor-host", () => ({ createScriptEditorHost: h.create }));
vi.mock("../lib/story-script-editor-bridge", () => ({ scriptEditorHtml: () => "editor" }));
vi.mock("./story-script-editor-frame", () => ({
  ScriptEditorFrame: () => <div>Editor frame</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
let options: Parameters<typeof createScriptEditorHost>[0];
const instance = { remote: vi.fn(), retry: vi.fn(), dispose: vi.fn(), setEditable: vi.fn() };
const snapshot = { document: { id: "document" } };
const render = (chapterId = "one") =>
  act(async () =>
    root.render(<StoryScriptEditor projectId="project" chapterId={chapterId} canEdit />)
  );
const tick = () => act(async () => vi.advanceTimersByTimeAsync(3000));
const retry = () => act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  h.active = true;
  h.open.mockResolvedValue(snapshot);
  h.reload.mockResolvedValue(snapshot);
  h.create.mockImplementation((value) => {
    options = value;
    return instance;
  });
  instance.retry.mockImplementation(() => options.onError(undefined));
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("clears a transient refresh error after successful automatic synchronization", async () => {
  h.reload.mockRejectedValueOnce(Error("Refresh offline"));
  await render();
  await tick();
  expect(container.textContent).toContain("Refresh offline");
  await tick();
  expect(container.textContent).not.toContain("Refresh offline");
  expect(instance.remote).toHaveBeenCalledWith(snapshot);
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("retries the failed read immediately and does not overlap repeated Retry presses", async () => {
  h.reload.mockRejectedValueOnce(Error("Refresh offline"));
  await render();
  await tick();
  let resolve!: (value: typeof snapshot) => void;
  h.reload.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  await retry();
  await retry();
  expect(h.reload).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Refresh offline");
  await act(async () => resolve(snapshot));
  expect(container.textContent).not.toContain("Refresh offline");
  await tick();
  expect(h.reload).toHaveBeenCalledTimes(3);
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("does not clear pending-edit errors when the remote read succeeds", async () => {
  await render();
  await act(async () => options.onError("Edit save offline"));
  await tick();
  expect(container.textContent).toContain("Edit save offline");
  await retry();
  expect(instance.retry).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Edit save offline");
});
it("ignores an old chapter's late refresh and aborts its request", async () => {
  let resolve!: (value: typeof snapshot) => void;
  h.reload.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  await render();
  await tick();
  const signal = h.reload.mock.calls[0][1];
  await render("two");
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(snapshot));
  expect(instance.remote).not.toHaveBeenCalled();
  await tick();
  expect(h.reload).toHaveBeenLastCalledWith(
    expect.objectContaining({ chapterId: "two" }),
    expect.any(AbortSignal)
  );
});
it("stops remote polling after a fatal editor failure and reopens on Retry", async () => {
  await render();
  await act(async () => options.onFatal?.("Editor failed"));
  await tick();
  expect(h.reload).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Editor failed");
  await retry();
  expect(h.open).toHaveBeenCalledTimes(2);
  await tick();
  expect(h.reload).toHaveBeenCalledTimes(1);
});
