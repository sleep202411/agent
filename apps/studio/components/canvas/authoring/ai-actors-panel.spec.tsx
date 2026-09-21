// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  notifyManager,
  defaultScheduler,
} from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AiActorsPanel } from "./ai-actors-panel";
const state = vi.hoisted(() => ({
  user: "alice",
  canEdit: true,
  get: vi.fn(),
  post: vi.fn(),
  addNode: vi.fn(),
  getNode: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.user } }),
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectContext: () => ({
    workspaceId: "workspace",
    projectId: "project",
    canEdit: state.canEdit,
  }),
}));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => ({
  useCanvasGraphContext: () => ({
    canEdit: state.canEdit,
    addNode: state.addNode,
    getNode: state.getNode,
    getNodes: () => [],
    selectNodes: vi.fn(),
  }),
}));
vi.mock("@/lib/api", () => ({ api: { get: state.get, post: state.post } }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
let root: Root, host: HTMLDivElement, client: QueryClient;
const actor = { id: "actor", name: "Mira", photoUrl: "/mira.png", unlocked: true };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler(queueMicrotask);
  state.user = "alice";
  state.canEdit = true;
  state.get.mockResolvedValue({ items: [actor], hasMore: false });
  state.post.mockImplementation((_path, config) =>
    Promise.resolve({
      nodeId: config.data.requestId,
      actorId: "actor",
      name: "Mira",
      mediaAssetId: "photo",
      url: "/photo",
    })
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
  vi.resetAllMocks();
  notifyManager.setScheduler(defaultScheduler);
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AiActorsPanel documentId="document" onClose={() => {}} />
      </QueryClientProvider>
    )
  );
}
async function click(label: string) {
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
}
it("inserts the returned photo as a real reference node", async () => {
  await render();
  await click("use");
  expect(state.addNode).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "image",
      data: { src: "/photo", mediaAssetId: "photo", label: "Mira", aiActorId: "actor" },
    })
  );
});
it("unlocks in the project workspace without creating a node", async () => {
  state.get.mockResolvedValue({ items: [{ ...actor, unlocked: false }], hasMore: false });
  await render();
  await click("unlock");
  expect(state.post).toHaveBeenCalledWith(
    "/aurora/ai-actors/actor/unlock",
    expect.objectContaining({ data: { workspaceId: "workspace" } })
  );
  expect(state.addNode).not.toHaveBeenCalled();
});
it("retains its request identity on a retry", async () => {
  state.post.mockRejectedValueOnce(new Error("Network unavailable"));
  await render();
  await click("use");
  await click("use");
  expect(state.post.mock.calls[0][1].data.requestId).toBe(
    state.post.mock.calls[1][1].data.requestId
  );
  expect(state.addNode).toHaveBeenCalledTimes(1);
});
it("suppresses stale insertion after an account change", async () => {
  let resolve!: () => void;
  state.post.mockImplementation(
    (_path, config) =>
      new Promise((r) => {
        resolve = () =>
          r({
            nodeId: config.data.requestId,
            actorId: "actor",
            name: "Mira",
            mediaAssetId: "photo",
            url: "/photo",
          });
      })
  );
  await render();
  await click("use");
  state.user = "bob";
  await render();
  await act(async () => resolve());
  expect(state.addNode).not.toHaveBeenCalled();
});
it("excludes overlapping clicks", async () => {
  state.post.mockImplementation(() => new Promise(() => {}));
  await render();
  await click("use");
  await click("working");
  expect(state.post).toHaveBeenCalledTimes(1);
});
it("disables changes for project viewers", async () => {
  state.canEdit = false;
  await render();
  await click("use");
  expect(state.post).not.toHaveBeenCalled();
});
it("does not show a failed catalogue as empty", async () => {
  state.get.mockRejectedValue(new Error("Access denied"));
  await render();
  expect(host.textContent).toContain("Access denied");
  expect(host.textContent).not.toContain("empty");
});
