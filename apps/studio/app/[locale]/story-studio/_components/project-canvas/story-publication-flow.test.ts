import { describe, expect, it, vi } from "vitest";
import type { StoryBuild, StoryWorkbench } from "@/lib/story-projects-api";
import { runStoryPublication, storyPublicationBuildFingerprint } from "./story-publication-flow";

const HASH = "a".repeat(64);

describe("runStoryPublication", () => {
  it("builds the exact saved draft and video snapshot", async () => {
    const build = {
      id: "build",
      status: "ready",
      runtimeJson: {},
      diagnostics: [],
      sourceDraftRevision: 4,
      videoSnapshotHash: HASH,
    } as unknown as StoryBuild;
    const create = vi.fn().mockResolvedValue(build);
    const confirm = vi.fn(async () => undefined);

    const result = await runStoryPublication({
      saveDraftSnapshot: async () => 4,
      loadWorkbench: async () =>
        ({ draft: { revision: 4 }, video: { snapshotHash: HASH } }) as StoryWorkbench,
      createProductionBuild: create,
      publishProductionBuild: async () => ({
        gameId: "game",
        contentVersion: "v1",
        status: "published",
        manifestUrl: "/manifest.json",
      }),
      buildSubmissionKeys: { keyFor: async () => "key", confirm },
    });

    expect(create).toHaveBeenCalledWith(
      { expectedDraftRevision: 4, expectedVideoSnapshotHash: HASH, scope: { kind: "full" } },
      "key"
    );
    expect(result.sourceDraftRevision).toBe(4);
    expect(confirm).toHaveBeenCalledWith(storyPublicationBuildFingerprint(4, HASH));
  });
});
