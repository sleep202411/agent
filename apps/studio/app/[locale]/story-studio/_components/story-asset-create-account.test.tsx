// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { StoryAssetSpecCreateDialog } from "./story-asset-spec-create-dialog";
import { storyProductionKeys } from "@/lib/story-production-api";
const state = vi.hoisted(() => ({ userId: "alice", create: vi.fn() }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.userId } }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/story-production-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/story-production-api")>()),
  createStoryAssetSpec: state.create,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
const root = createRoot(host);
const client = new QueryClient();
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
it("keeps a completed creation in its originating account cache after account replacement", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let finish!: (v: unknown) => void;
  state.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
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
          onOpenChange={() => {}}
        />
      </QueryClientProvider>
    );
  await act(async () => render());
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Hero");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(state.create).toHaveBeenCalledTimes(1);
  state.userId = "bob";
  await act(async () => render());
  await act(async () => {
    finish({ id: "alice-created" });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(client.getQueryData(alice)).toEqual([{ id: "alice-created" }]);
  expect(client.getQueryData(bob)).toEqual([{ id: "bob-existing" }]);
});
