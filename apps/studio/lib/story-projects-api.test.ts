import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { api } from "@/lib/api";
import {
  createFilmTake,
  getStoryWorkingPreview,
  listFilmTakes,
  prepareFilmClip,
} from "./story-projects-api";

describe("current-draft Story production routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists Takes by project and stable graph-node id", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ items: [], nextCursor: null });

    await listFilmTakes("workspace-1", "project / one", "clip / one", { limit: 25 });

    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/clips/clip%20%2F%20one/takes",
      expect.objectContaining({ params: { limit: 25 } })
    );
  });

  it("submits the exact saved draft revision without a locked revision id", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "take-1" });

    await createFilmTake(
      "workspace-1",
      "project-1",
      "clip-1",
      { expectedDraftRevision: 18, modelId: "seedance-2", variationNote: "slower camera" },
      "idempotency-1"
    );

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/clips/clip-1/takes",
      expect.objectContaining({
        data: {
          expectedDraftRevision: 18,
          modelId: "seedance-2",
          variationNote: "slower camera",
        },
      })
    );
  });

  it("prepares one graph-node clip from the exact saved draft without an AI submission", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      draftRevision: 18,
      revisionId: "revision-18",
      productionRevision: 1,
      clip: { id: "clip-1" },
    });

    await prepareFilmClip("workspace-1", "project / one", "clip / one", {
      expectedDraftRevision: 18,
      modelId: "seedance-2",
    });

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/clips/clip%20%2F%20one/prepare",
      {
        data: { expectedDraftRevision: 18, modelId: "seedance-2" },
        headers: { "x-fizz-workspace-id": "workspace-1" },
      }
    );
  });

  it("loads the ephemeral working preview from the project authoring head", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      draftRevision: 18,
      runtime: null,
      diagnostics: [],
      pathReport: null,
    });

    await getStoryWorkingPreview("workspace-1", "project-1", 18);

    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/working-preview",
      expect.objectContaining({ params: { expectedDraftRevision: 18 } })
    );
  });
});
