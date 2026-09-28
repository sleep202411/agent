import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryboardTaskPicker } from "./storyboard-task-picker";
const h = vi.hoisted(() => ({ list: vi.fn(), link: vi.fn(), close: vi.fn(), error: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: h.error } }));
vi.mock("@/lib/story-projects-api", () => ({
  storyApiErrorMessage: (error: Error) => error.message,
}));
vi.mock("@/lib/collab/storyboard-children-api", () => ({
  listStoryboardTaskCandidates: (...args: unknown[]) => h.list(...args),
  linkStoryboardChild: (...args: unknown[]) => h.link(...args),
}));
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  h.list.mockResolvedValue({
    items: [{ id: "task", title: "Existing shot", number: 3 }],
    nextCursor: null,
  });
  h.link.mockResolvedValue({ taskId: "task" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StoryboardTaskPicker projectId="project" nodeId="node" onClose={h.close} />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
it("links the selected task to the current project node and refreshes server state", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await render();
  const button = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Existing shot")
  )!;
  await act(async () => button.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(h.link).toHaveBeenCalledWith("project", "node", "task");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["storyboard-children", "project"] });
  expect(h.close).toHaveBeenCalled();
});
it("surfaces server permission failures without closing the picker", async () => {
  h.link.mockRejectedValueOnce(new Error("Task management denied"));
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Existing shot"))!
      .click()
  );
  expect(h.error).toHaveBeenCalledWith("Task management denied");
  expect(h.close).not.toHaveBeenCalled();
});
it("shows read errors and offers a retry instead of an empty success state", async () => {
  h.list.mockRejectedValue(new Error("Crew access denied"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Crew access denied");
  expect(host.textContent).not.toContain("noEligibleTasks");
});
