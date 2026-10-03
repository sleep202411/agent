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
const reviewing = {
  gameId: PROJECT_ID,
  status: "reviewing",
};

describe("interactive-film API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries Java directly by projectId", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(reviewing);

    await expect(getInteractiveFilmPublication(PROJECT_ID)).resolves.toEqual({
      gameId: PROJECT_ID,
      status: "reviewing",
      rejectReason: null,
    });
    expect(api.get).toHaveBeenCalledWith("/api/user/interactive-film/project%2Fone", {
      requestScope: "user",
      signal: undefined,
    });
  });

  it("treats Java 404 as a project without a release", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiRequestError(404, "Not found", 404));

    await expect(getInteractiveFilmPublication(PROJECT_ID)).resolves.toBeNull();
  });

  it("prepares in Nest, then uploads and submits directly to Java", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce(release)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    vi.mocked(api.get).mockResolvedValueOnce(reviewing);

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
      expect.objectContaining({ requestScope: "project" })
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/api/user/interactive-film/releases",
      expect.objectContaining({ data: release, requestScope: "user" })
    );
    expect(api.post).toHaveBeenNthCalledWith(3, "/api/user/interactive-film/project%2Fone/status", {
      data: { action: "submit" },
      requestScope: "user",
      signal: undefined,
    });
  });

  it("takes the Java project offline and refreshes its state", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    vi.mocked(api.get).mockResolvedValueOnce({ gameId: PROJECT_ID, status: "offline" });

    await expect(offlineInteractiveFilm(PROJECT_ID)).resolves.toMatchObject({ status: "offline" });
    expect(api.post).toHaveBeenCalledWith("/api/user/interactive-film/project%2Fone/status", {
      data: { action: "offline" },
      requestScope: "user",
      signal: undefined,
    });
  });

  it("stops submission after release upload when its owner is abandoned", async () => {
    const controller = new AbortController();
    vi.mocked(api.post).mockImplementationOnce(async () => {
      controller.abort();
      return {};
    });
    await expect(
      submitInteractiveFilmRelease(PROJECT_ID, release, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
  });
});
