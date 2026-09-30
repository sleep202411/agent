import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpisodeTemplatePreview } from "./episode-template-preview";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), user: "user" as string | null }));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({ crewApi: { get: state.get, post: state.post } }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.user ? { id: state.user } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
const snapshot = { templateId: "template", templateVersion: 2, episodeVersion: 3 };
const plan = {
  ...snapshot,
  name: "Standard",
  items: [
    {
      templateKey: "script",
      taskKind: "script",
      title: "Script",
      roleRequirement: "Writer",
      defaultDependencies: [],
      deliveryFields: [],
    },
  ],
};
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  state.user = "user";
  state.get.mockReset().mockResolvedValue(plan);
  state.post.mockReset().mockResolvedValue({ taskIds: ["task"], replayed: false });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
async function render(
  onStage?: (batch: import("./workbench-task-batch").WorkbenchTaskBatch) => void
) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <EpisodeTemplatePreview
          crewId="crew"
          episodeId="episode"
          onClose={() => undefined}
          onStage={onStage}
        />
      </QueryClientProvider>
    );
  });
  await settle();
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}
function button(text: string) {
  return [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
it("previews without writes and sends only the reviewed snapshot once on rapid clicks", async () => {
  await render();
  expect(document.body.textContent).toContain("Script");
  expect(state.post).not.toHaveBeenCalled();
  await act(async () => {
    button("confirm").click();
    button("confirm").click();
  });
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.post).toHaveBeenCalledWith("/crews/crew/episodes/episode/task-template", {
    body: snapshot,
  });
  expect(document.body.textContent).toContain("created");
  expect(button("confirm")).toBeUndefined();
});
it("surfaces a lost response and permits an idempotent retry", async () => {
  state.post
    .mockRejectedValueOnce(new Error("Connection interrupted"))
    .mockResolvedValueOnce({ taskIds: ["original"], replayed: true });
  await render();
  await act(async () => button("confirm").click());
  expect(document.body.textContent).toContain("Connection interrupted");
  await act(async () => button("confirm").click());
  expect(document.body.textContent).toContain("reused");
  expect(state.post).toHaveBeenCalledTimes(2);
  expect(state.post.mock.calls[0]).toEqual(state.post.mock.calls[1]);
});
it("never creates tasks from a failed preview", async () => {
  state.get.mockRejectedValue(new Error("Permission denied"));
  await render();
  expect(document.body.textContent).toContain("Permission denied");
  expect(button("confirm").disabled).toBe(true);
  expect(state.post).not.toHaveBeenCalled();
});
it("does not reuse the old account's preview or in-flight result", async () => {
  let finish!: (value: unknown) => void;
  state.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => button("confirm").click());
  state.user = "other";
  state.get.mockRejectedValue(new Error("No access"));
  await render();
  await act(async () => finish({ taskIds: ["old"], replayed: false }));
  await settle();
  expect(document.body.textContent).toContain("No access");
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(button("confirm").disabled).toBe(true);
});
it("does not fetch or submit while signed out", async () => {
  state.user = null;
  await render();
  expect(state.get).not.toHaveBeenCalled();
  expect(button("confirm").disabled).toBe(true);
});

it("stages episode tasks and role requirements without a write", async () => {
  const onStage = vi.fn();
  await render(onStage);
  await act(async () => button("stageTemplate").click());
  expect(state.post).not.toHaveBeenCalled();
  expect(onStage).toHaveBeenCalledWith({
    key: "episode:episode",
    title: "Standard",
    path: "/crews/crew/episodes/episode/task-template",
    body: snapshot,
    items: [{ title: "Script", role: "Writer", assetCategory: "scripts" }],
  });
});
