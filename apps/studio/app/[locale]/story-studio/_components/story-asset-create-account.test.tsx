// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryAssetSpecCreateDialog } from "./story-asset-spec-create-dialog";
import { storyProductionKeys } from "@/lib/story-production-api";
const state = vi.hoisted(() => ({
  userId: "alice",
  create: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.userId } }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/story-production-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/story-production-api")>()),
  createStoryAssetSpec: state.create,
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/components/ui/dialog", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogContent: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogTitle: Container,
  };
});
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
let client = new QueryClient();
beforeEach(() => {
  state.userId = "alice";
  vi.clearAllMocks();
  document.body.append(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  root = createRoot(host);
  client = new QueryClient();
});
it.each([
  "switch",
  "switch-error",
  "unmount",
  "active",
  "active-error",
  "active-edit-error",
  "switch-before-admission",
])("keeps creation cache ownership and feedback correct after %s", async (mode) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let finish!: (v: unknown) => void;
  let fail!: (v: unknown) => void;
  state.create.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      })
  );
  const alice = storyProductionKeys.assets("project", "chapter", "alice");
  const bob = storyProductionKeys.assets("project", "chapter", "bob");
  client.setQueryData(alice, []);
  client.setQueryData(bob, [{ id: "bob-existing" }]);
  const render = () =>
    root.render(
      <QueryClientProvider client={client}>
        <StoryAssetSpecCreateDialog
          projectId="project"
          chapterId="chapter"
          initialKind="character"
          open
          onOpenChange={state.close}
        />
      </QueryClientProvider>
    );
  await act(async () => render());
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Hero");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    const form = host.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    if (mode === "switch-before-admission") {
      state.userId = "bob";
      flushSync(render);
    }
  });
  if (mode === "switch-before-admission") {
    expect(state.create).not.toHaveBeenCalled();
    expect(state.close).not.toHaveBeenCalled();
    expect(state.error).not.toHaveBeenCalled();
    expect(client.getQueryData(alice)).toEqual([]);
    return;
  }
  expect(state.create).toHaveBeenCalledTimes(1);
  if (mode.startsWith("switch")) {
    state.userId = "bob";
    await act(async () => render());
  }
  if (mode === "unmount") await act(async () => root.render(null));
  await act(async () => {
    if (mode.endsWith("error")) fail(new Error("Create failed"));
    else finish({ id: "alice-created" });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(client.getQueryData(alice)).toEqual(
    mode.endsWith("error") ? [] : [{ id: "alice-created" }]
  );
  expect(state.close).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
  expect(state.success).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
  expect(state.error).toHaveBeenCalledTimes(
    mode.startsWith("active") && mode.endsWith("error") ? 1 : 0
  );
  expect(client.getQueryData(bob)).toEqual([{ id: "bob-existing" }]);
  if (mode.startsWith("active") && mode.endsWith("error")) {
    state.create.mockResolvedValueOnce({ id: "retried" });
    if (mode === "active-edit-error") {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          "Different"
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    } else client.setQueryData(alice, [{ id: "retried" }]);
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(state.create).toHaveBeenCalledTimes(2);
    if (mode === "active-edit-error") {
      expect(state.create.mock.calls[1]![2]).not.toBe(state.create.mock.calls[0]![2]);
      expect(state.create.mock.calls[1]![3].name).toBe("Different");
    } else expect(state.create.mock.calls[1]![2]).toBe(state.create.mock.calls[0]![2]);
    expect(client.getQueryData(alice)).toEqual([{ id: "retried" }]);
    expect(state.success).toHaveBeenCalledTimes(1);
  }
});
