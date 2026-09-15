// @vitest-environment jsdom
import { act } from "react";
import { ApiRequestError } from "@/lib/api";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectCrewAssetLibrary } from "./project-crew-asset-library";
import { useProjectAssets } from "@/lib/canvas-authoring/use-project-assets";
import {
  getProjectCrewAssetContext,
  listProjectCrewAssets,
  listAllProjectCrewAssets,
} from "@/lib/collab/project-crew-assets-api";
const session = vi.hoisted(() => ({ id: "alice" }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: session.id } }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => ({
  useCanvasGraphContext: () => ({ assets: [] }),
}));
vi.mock("./asset-library-thumb", () => ({ AssetThumb: () => null }));
vi.mock("@/lib/collab/project-crew-assets-api", () => ({
  getProjectCrewAssetContext: vi.fn(),
  listProjectCrewAssets: vi.fn(),
  listAllProjectCrewAssets: vi.fn(),
}));
const context = (id: string) => ({
  crew: { id, name: id, logo: "" },
  assetContext: { capabilities: { view: true } },
});
const folder = {
  id: "old-folder",
  parentId: null,
  name: "Old folder",
  kind: "folder" as const,
  media: null,
};
const file = {
  id: "old-file",
  parentId: null,
  name: "Old file",
  kind: "file" as const,
  media: {
    id: "media",
    kind: "image" as const,
    contentType: "image/png",
    sizeBytes: 1,
    width: 1,
    height: 1,
    durationSeconds: null,
    previewUrl: "/fixture.png",
  },
};
let client: QueryClient;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.id = "alice";
  vi.mocked(getProjectCrewAssetContext).mockResolvedValue(context("crew-a"));
  vi.mocked(listProjectCrewAssets).mockResolvedValue({
    items: [folder],
    parentId: null,
    source: "all",
    nextCursor: null,
  });
  vi.mocked(listAllProjectCrewAssets).mockResolvedValue([file]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.resetAllMocks();
});
function Inventory() {
  const { assets } = useProjectAssets("project");
  return <div>{assets.map((asset) => asset.name).join(",")}</div>;
}
async function render(inventory = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        {inventory ? (
          <Inventory />
        ) : (
          <ProjectCrewAssetLibrary projectId="project" query="" floating={false} />
        )}
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it("resets the folder and cancels its read when the linked Crew changes", async () => {
  await render();
  vi.mocked(listProjectCrewAssets).mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => host.querySelector("button")!.click());
  const oldSignal = vi.mocked(listProjectCrewAssets).mock.calls.at(-1)?.[2];
  expect(vi.mocked(listProjectCrewAssets).mock.calls.at(-1)?.[1].parentId).toBe("old-folder");
  vi.mocked(listProjectCrewAssets).mockResolvedValue({
    items: [],
    parentId: null,
    source: "all",
    nextCursor: null,
  });
  await act(async () => {
    client.setQueryData(["project-crew-assets", "project", "context", "alice"], context("crew-b"));
  });
  await render();
  expect(oldSignal?.aborted).toBe(true);
  expect(vi.mocked(listProjectCrewAssets).mock.calls.at(-1)?.[1].parentId).toBeUndefined();
  expect(host.textContent).not.toContain("Old folder");
  expect(host.textContent).toContain("crew-b");
});
it("does not reuse a previous Crew's flat inventory after relinking or unlinking", async () => {
  await render(true);
  expect(host.textContent).toContain("Old file");
  vi.mocked(listAllProjectCrewAssets).mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => {
    client.setQueryData(["project-crew-assets", "project", "context", "alice"], context("crew-b"));
  });
  await render(true);
  expect(host.textContent).not.toContain("Old file");
  expect(listAllProjectCrewAssets).toHaveBeenCalledTimes(2);
  const signal = vi.mocked(listAllProjectCrewAssets).mock.calls.at(-1)?.[1];
  await act(async () => {
    client.setQueryData(["project-crew-assets", "project", "context", "alice"], {
      crew: null,
      assetContext: null,
    });
  });
  await render(true);
  expect(signal?.aborted).toBe(true);
  expect(host.textContent).not.toContain("Old file");
});
it("starts at the root folder after account replacement", async () => {
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(vi.mocked(listProjectCrewAssets).mock.calls.at(-1)?.[1].parentId).toBe("old-folder");
  session.id = "bob";
  await render();
  expect(vi.mocked(listProjectCrewAssets).mock.calls.at(-1)?.[1].parentId).toBeUndefined();
});
it("keeps loaded folders after next-page failure and retries the same cursor", async () => {
  vi.mocked(listProjectCrewAssets)
    .mockResolvedValueOnce({ items: [folder], parentId: null, source: "all", nextCursor: "page-2" })
    .mockRejectedValueOnce(new Error("temporarily unavailable"))
    .mockResolvedValueOnce({
      items: [{ ...folder, id: "new-folder", name: "New folder" }],
      parentId: null,
      source: "all",
      nextCursor: null,
    });
  await render();
  const more = () =>
    Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "loadMore"
    )!;
  await act(async () => more().click());
  await render();
  expect(host.textContent).toContain("Old folder");
  expect(more()).toBeDefined();
  await act(async () => more().click());
  await render();
  expect(host.textContent).toContain("Old folder");
  expect(host.textContent).toContain("New folder");
  expect(
    vi
      .mocked(listProjectCrewAssets)
      .mock.calls.slice(1)
      .map((call) => call[1].cursor)
  ).toEqual(["page-2", "page-2"]);
});

it.each([401, 403, 404, 410])(
  "removes loaded folders after access becomes unavailable (%s)",
  async (status) => {
    vi.mocked(listProjectCrewAssets)
      .mockResolvedValueOnce({
        items: [folder],
        parentId: null,
        source: "all",
        nextCursor: "page-2",
      })
      .mockRejectedValueOnce(new ApiRequestError("ACCESS_UNAVAILABLE", "Unavailable", status));
    await render();
    expect(host.textContent).toContain("Old folder");
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === "loadMore")!
        .click()
    );
    await render();
    expect(host.textContent).not.toContain("Old folder");
    expect(host.textContent).toContain("errorTitle");
  }
);
