// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import { mediaAssetReadinessKeys } from "@/lib/media-asset-readiness";
import { CanvasDocumentProvider } from "./canvas-document-context";
import { MediaAssetReadinessControlForAsset } from "./media-asset-readiness";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ASSET_ID = "0197f4a2-0800-7000-8000-000000000001";
const DOCUMENT_ID = "0197f4a2-0800-7000-8000-000000000002";
const OTHER_DOCUMENT_ID = "0197f4a2-0800-7000-8000-000000000003";
const CAPABILITY = MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference;
const unchecked = {
  assetId: ASSET_ID,
  capability: CAPABILITY,
  status: "not_requested",
  statusReason: null,
  updatedAt: "2026-09-11T12:00:00.000Z",
};

describe("canvas readiness access", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(documentId = DOCUMENT_ID) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <CanvasDocumentProvider value={documentId}>
            <MediaAssetReadinessControlForAsset mediaAssetId={ASSET_ID} capability={CAPABILITY} />
          </CanvasDocumentProvider>
        </QueryClientProvider>
      );
    });
  }

  async function settle(assertion: () => void) {
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assertion();
    });
  }

  it("passes canvas context for both status and check, then shows progress", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ assets: [unchecked] }))
      .mockResolvedValueOnce(Response.json({ asset: { ...unchecked, status: "pending" } }));
    vi.stubGlobal("fetch", fetchMock);
    const otherKey = mediaAssetReadinessKeys.statuses(CAPABILITY, [ASSET_ID], OTHER_DOCUMENT_ID);
    client.setQueryData(otherKey, {});
    await render();
    await settle(() => expect(container.querySelector("button")).not.toBeNull());
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/aurora/media/asset-readiness/status",
      expect.objectContaining({
        body: JSON.stringify({
          capability: CAPABILITY,
          assetIds: [ASSET_ID],
          documentId: DOCUMENT_ID,
        }),
      })
    );

    await act(async () => container.querySelector("button")!.click());
    await settle(() => expect(container.textContent).toContain("seedance.checking"));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/aurora/media/assets/${ASSET_ID}/readiness-checks`,
      expect.objectContaining({
        body: JSON.stringify({ capability: CAPABILITY, documentId: DOCUMENT_ID }),
      })
    );
    expect(container.querySelector("button")).toBeNull();
    expect(client.getQueryData(otherKey)).toEqual({});
  });

  it("does not offer a check when the server omits an inaccessible or missing asset", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ assets: [] })));
    await render();
    await settle(() => expect(container.textContent).toContain("seedance.unavailable"));
    expect(container.querySelector("button")).toBeNull();
  });

  it("does not reuse another canvas’s allowed status when switching documents", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ assets: [unchecked] }))
      .mockResolvedValueOnce(Response.json({ assets: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await settle(() => expect(container.querySelector("button")).not.toBeNull());
    await render(OTHER_DOCUMENT_ID);
    await settle(() => expect(container.textContent).toContain("seedance.unavailable"));
    expect(container.querySelector("button")).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/aurora/media/asset-readiness/status",
      expect.objectContaining({
        body: JSON.stringify({
          capability: CAPABILITY,
          assetIds: [ASSET_ID],
          documentId: OTHER_DOCUMENT_ID,
        }),
      })
    );
  });
});
