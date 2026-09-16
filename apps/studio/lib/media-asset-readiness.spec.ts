import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import {
  getMediaAssetReadinessStatuses,
  requestMediaAssetReadinessCheck,
} from "./media-asset-readiness";

const ASSET_ID = "0197f4a2-0800-7000-8000-000000000001";
const CAPABILITY = MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestMediaAssetReadinessCheck", () => {
  it("returns the durable status from the Aurora envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(200, {
          code: 200,
          data: {
            asset: {
              assetId: ASSET_ID,
              capability: CAPABILITY,
              status: "processing",
              statusReason: null,
              updatedAt: "2026-07-23T12:00:00.000Z",
            },
          },
        })
      )
    );

    await expect(requestMediaAssetReadinessCheck(ASSET_ID, CAPABILITY)).resolves.toMatchObject({
      assetId: ASSET_ID,
      capability: CAPABILITY,
      status: "processing",
    });
    expect(fetch).toHaveBeenCalledWith(
      `/aurora/media/assets/${ASSET_ID}/readiness-checks`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ capability: CAPABILITY }),
      })
    );
  });

  it("surfaces the backend's actionable error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(503, {
          message: { message: "Seedance safety checking is unavailable." },
        })
      )
    );

    await expect(requestMediaAssetReadinessCheck(ASSET_ID, CAPABILITY)).rejects.toThrow(
      "Seedance safety checking is unavailable."
    );
  });

  it("rejects malformed success responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { code: 200, data: {} }))
    );

    await expect(requestMediaAssetReadinessCheck(ASSET_ID, CAPABILITY)).rejects.toThrow(
      "response missing asset status"
    );
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("readiness status response admission", () => {
  it("retains requested valid rows while ignoring null and unrelated entries", async () => {
    const asset = { assetId: ASSET_ID, capability: CAPABILITY, status: "active" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { assets: [null, asset, { ...asset, assetId: "other" }] })
        )
    );
    await expect(getMediaAssetReadinessStatuses(CAPABILITY, [ASSET_ID])).resolves.toEqual({
      [ASSET_ID]: asset,
    });
  });
  it("preserves nested upstream errors for the status read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(503, { message: { message: "Provider unavailable" } }))
    );
    await expect(getMediaAssetReadinessStatuses(CAPABILITY, [ASSET_ID])).rejects.toThrow(
      "Provider unavailable"
    );
  });
  it("reports an HTTP failure when the response body is null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, null)));
    await expect(getMediaAssetReadinessStatuses(CAPABILITY, [ASSET_ID])).rejects.toThrow(
      "HTTP 503"
    );
    await expect(requestMediaAssetReadinessCheck(ASSET_ID, CAPABILITY)).rejects.toThrow("HTTP 503");
  });
});

it("reads every requested asset in batches within the server's 100-ID limit", async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `asset-${index}`);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body)) as { assetIds: string[]; documentId: string };
    expect(body.assetIds.length).toBeLessThanOrEqual(100);
    expect(body.documentId).toBe("doc");
    return jsonResponse(200, {
      assets: body.assetIds.map((assetId) => ({
        assetId,
        capability: CAPABILITY,
        status: "active",
      })),
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await getMediaAssetReadinessStatuses(CAPABILITY, [...ids, ids[0]!], "doc");
  expect(Object.keys(result)).toEqual(ids);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("does not fetch an empty selection or report a failed later batch as complete", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
    .mockResolvedValueOnce(jsonResponse(503, { message: "Later batch unavailable" }));
  vi.stubGlobal("fetch", fetcher);
  await expect(getMediaAssetReadinessStatuses(CAPABILITY, [])).resolves.toEqual({});
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    getMediaAssetReadinessStatuses(
      CAPABILITY,
      Array.from({ length: 101 }, (_, i) => `asset-${i}`)
    )
  ).rejects.toThrow("Later batch unavailable");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not start a cancelled status read", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] }));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    getMediaAssetReadinessStatuses(CAPABILITY, [ASSET_ID], "doc", controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("stops after a delayed cancelled batch and forwards the query signal", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    controller.abort();
    return jsonResponse(200, { assets: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    getMediaAssetReadinessStatuses(
      CAPABILITY,
      Array.from({ length: 101 }, (_, i) => `asset-${i}`),
      "doc",
      controller.signal
    )
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1]?.signal).toBe(controller.signal);
});
