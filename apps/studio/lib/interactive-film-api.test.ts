import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      public code: number | string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));

import { api, ApiRequestError } from "@/lib/api";
import {
  getInteractiveFilmPublication,
  offlineInteractiveFilm,
  prepareInteractiveFilmRelease,
  submitInteractiveFilmRelease,
} from "./interactive-film-api";

const PROJECT_ID = "project/one";
const release = {
  gameId: PROJECT_ID,
  contentVersion: "build-1",
  manifest: {},
  status: "draft" as const,
  setCurrent: true,
};
const reviewing = { gameId: PROJECT_ID, status: "reviewing" };

describe("interactive-film project gateway", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads publication through project authorization without ambient workspace scope", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(reviewing);
    const signal = new AbortController().signal;
    await expect(getInteractiveFilmPublication(PROJECT_ID, signal)).resolves.toEqual({
      gameId: PROJECT_ID,
      status: "reviewing",
      rejectReason: null,
    });
    expect(api.get).toHaveBeenCalledWith("/aurora/story-projects/project%2Fone/publication", {
      requestScope: "project",
      signal,
    });
  });

  it("accepts only a successful null result as no published version", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(null);
    await expect(getInteractiveFilmPublication(PROJECT_ID)).resolves.toBeNull();
  });

  it.each([401, 403, 404, 502])(
    "preserves HTTP %s failures instead of treating them as drafts",
    async (status) => {
      const error = new ApiRequestError(status, "Exact upstream detail", status);
      vi.mocked(api.get).mockRejectedValueOnce(error);
      await expect(getInteractiveFilmPublication(PROJECT_ID)).rejects.toBe(error);
    }
  );

  it("prepares the exact snapshot and submits its receipt through the project gateway", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(release).mockResolvedValueOnce(reviewing);
    const prepared = await prepareInteractiveFilmRelease(PROJECT_ID, {
      expectedDraftRevision: 8,
      expectedVideoSnapshotHash: "a".repeat(64),
    });
    await expect(submitInteractiveFilmRelease(PROJECT_ID, prepared)).resolves.toMatchObject({
      status: "reviewing",
    });
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/aurora/story-projects/project%2Fone/release-candidate",
      expect.objectContaining({
        requestScope: "project",
        data: {
          expectedDraftRevision: 8,
          expectedVideoSnapshotHash: "a".repeat(64),
        },
      })
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/aurora/story-projects/project%2Fone/publication/submit",
      expect.objectContaining({ data: release, requestScope: "project" })
    );
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("takes the project offline and uses the gateway's authoritative response", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ gameId: PROJECT_ID, status: "offline" });
    await expect(offlineInteractiveFilm(PROJECT_ID)).resolves.toMatchObject({ status: "offline" });
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project%2Fone/publication/offline",
      {
        data: {},
        requestScope: "project",
        signal: undefined,
      }
    );
    expect(api.get).not.toHaveBeenCalled();
  });

  it("rejects a gateway response for another project", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ gameId: "other-project", status: "reviewing" });
    await expect(submitInteractiveFilmRelease(PROJECT_ID, release)).rejects.toThrow(
      "invalid publication status"
    );
  });

  it("discards submission responses after the account owner is abandoned", async () => {
    const controller = new AbortController();
    vi.mocked(api.post).mockImplementationOnce(async () => {
      controller.abort();
      return reviewing;
    });
    await expect(
      submitInteractiveFilmRelease(PROJECT_ID, release, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.post).toHaveBeenCalledOnce();
  });
});
