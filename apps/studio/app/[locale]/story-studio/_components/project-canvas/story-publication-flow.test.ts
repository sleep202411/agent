import { describe, expect, it, vi } from "vitest";
import type { ExperienceReleaseRequest } from "@repo/shared/experience-runtime";
import { runStoryPublication } from "./story-publication-flow";

describe("runStoryPublication", () => {
  it("saves, prepares, and submits the same immutable release", async () => {
    const release = {
      gameId: "project-1",
      contentVersion: "build-1",
      manifest: {},
      status: "draft",
      setCurrent: true,
    } satisfies ExperienceReleaseRequest;
    const prepare = vi.fn(async () => release);
    const submit = vi.fn(async () => ({
      gameId: "project-1",
      status: "reviewing" as const,
      rejectReason: null,
    }));
    const phases: string[] = [];

    const result = await runStoryPublication({
      saveDraftSnapshot: async () => 4,
      prepareRelease: prepare,
      submitRelease: submit,
      onPhaseChange: (phase) => phases.push(phase),
    });

    expect(prepare).toHaveBeenCalledWith(4);
    expect(submit).toHaveBeenCalledWith(release);
    expect(result.publication.status).toBe("reviewing");
    expect(phases).toEqual(["saving", "preparing", "submitting"]);
  });
});
