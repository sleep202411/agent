import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import { requestMediaAssetReadinessCheck } from "./media-asset-readiness";

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

function jsonResponse(status: number, body: object): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}
