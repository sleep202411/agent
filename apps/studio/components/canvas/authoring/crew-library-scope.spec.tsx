// @vitest-environment jsdom
import { act } from "react";
import { ApiRequestError } from "@/lib/api";
import { createRoot, type Root } from "react-dom/client";
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
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
  useCanvasGraphContext: () => ({
    assets: [
      {
        id: "local",
        kind: "image",
        source: "uploaded",
        url: "/local.png",
        name: "Local canvas image",
        createdAt: 0,
      },
    ],
  }),
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
  notifyManager.setScheduler(queueMicrotask);
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
  notifyManager.setScheduler(defaultScheduler);
  host.remove();
  vi.resetAllMocks();
});
function Inventory() {
  const { assets, error, retry, isRetrying } = useProjectAssets("project");
  return (
    <div>
      {assets.map((asset) => asset.name).join(",")}
      {error && (
        <>
          <p role="alert">{error.message}</p>
          <button disabled={isRetrying} onClick={() => void retry()}>
            retry
          </button>
        </>
      )}
    </div>
  );
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

it.each(["context", "listing"])(
  "recovers an initial %s read failure without reopening the library",
  async (target) => {
    const read =
      target === "context"
        ? vi.mocked(getProjectCrewAssetContext)
        : vi.mocked(listProjectCrewAssets);
    read.mockRejectedValueOnce(new Error("Asset service unavailable"));
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Asset service unavailable"
    );
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!;
    await act(async () => retry.click());
    expect(host.textContent).toContain("Old folder");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  }
);

it.each([401, 403, 404, 410])(
  "removes denied inventory while preserving local canvas assets (%s)",
  async (status) => {
    await render(true);
    expect(host.textContent).toContain("Old file");
    vi.mocked(listAllProjectCrewAssets).mockRejectedValueOnce(
      new ApiRequestError("ACCESS_UNAVAILABLE", "Crew access revoked", status)
    );
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["project-crew-assets", "project", "all-folders"],
      });
    });
    expect(host.textContent).not.toContain("Old file");
    expect(host.textContent).toContain("Local canvas image");
    expect(host.textContent).toContain("Crew access revoked");
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Old file");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  }
);

it("removes flat Crew inventory when context refresh fails and recovers through context retry", async () => {
  await render(true);
  vi.mocked(getProjectCrewAssetContext).mockRejectedValueOnce(
    new ApiRequestError("FORBIDDEN", "Project access revoked", 403)
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["project-crew-assets", "project", "context"] });
  });
  expect(host.textContent).not.toContain("Old file");
  expect(host.textContent).toContain("Local canvas image");
  expect(host.textContent).toContain("Project access revoked");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("Old file");
});

it("allows leaving a folder whose access was revoked", async () => {
  await render();
  vi.mocked(listProjectCrewAssets).mockRejectedValueOnce(
    new ApiRequestError("FORBIDDEN", "Folder access revoked", 403)
  );
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("Folder access revoked");
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "back")!.click()
  );
  expect(host.textContent).toContain("Old folder");
});
