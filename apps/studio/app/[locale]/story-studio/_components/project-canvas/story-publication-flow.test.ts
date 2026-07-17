import { describe, expect, it, vi } from "vitest";
import type {
  ExperienceReleaseResult,
  FilmBuild,
  FilmBuildDiagnostic,
  StoryRevision,
  StoryWorkbench,
} from "@/lib/story-projects-api";
import { StorySubmissionKeyRegistry } from "./story-trailer-production-model";
import {
  runStoryPublication,
  StoryPublicationFlowError,
  storyPublicationBuildFingerprint,
  type StoryPublicationFlowServices,
} from "./story-publication-flow";

describe("runStoryPublication", () => {
  it("saves, locks, reloads the exact revision, builds, and publishes in order", async () => {
    const order: string[] = [];
    const revision = storyRevision();
    const build = filmBuild();
    const phases: string[] = [];
    const services = flowServices({ revision, build, order });

    const result = await runStoryPublication({
      ...services,
      onPhaseChange: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["saving", "locking", "building", "publishing"]);
    expect(order).toEqual(["save", "lock", "workbench", "key", "build", "publish", "confirm"]);
    expect(services.loadLockedWorkbench).toHaveBeenCalledWith(revision.id);
    expect(services.createProductionBuild).toHaveBeenCalledWith(
      {
        revisionId: revision.id,
        expectedProductionRevision: 7,
        profile: "production",
        scope: { kind: "full" },
      },
      "submission-key-1"
    );
    expect(services.publishProductionBuild).toHaveBeenCalledWith(build.id);
    expect(result).toEqual({ lockedRevision: revision, build, release: releaseResult() });
  });

  it("retains the same submission key when the build response is unknown", async () => {
    const keys = registryAdapter();
    const createProductionBuild = vi
      .fn<StoryPublicationFlowServices["createProductionBuild"]>()
      .mockRejectedValueOnce(new Error("Connection reset after upload."))
      .mockResolvedValueOnce(filmBuild());
    const services = flowServices({ createProductionBuild, buildSubmissionKeys: keys.adapter });

    await expect(runStoryPublication(services)).rejects.toMatchObject({
      code: "BUILD_FAILED",
      phase: "building",
    });
    await runStoryPublication(services);

    expect(createProductionBuild.mock.calls.map((call) => call[1])).toEqual(["key-1", "key-1"]);
  });

  it("rotates the submission key after publication failure for recoverable retry", async () => {
    const keys = registryAdapter();
    const createProductionBuild = vi
      .fn<StoryPublicationFlowServices["createProductionBuild"]>()
      .mockResolvedValue(filmBuild());
    const publishProductionBuild = vi
      .fn<StoryPublicationFlowServices["publishProductionBuild"]>()
      .mockRejectedValueOnce(new Error("Publication result is unknown."))
      .mockResolvedValueOnce(releaseResult());
    const services = flowServices({
      createProductionBuild,
      publishProductionBuild,
      buildSubmissionKeys: keys.adapter,
    });

    await expect(runStoryPublication(services)).rejects.toMatchObject({
      code: "PUBLISH_FAILED",
      phase: "publishing",
    });
    await runStoryPublication(services);

    expect(createProductionBuild.mock.calls.map((call) => call[1])).toEqual(["key-1", "key-2"]);
  });

  it("rotates the submission key after a confirmed terminal build failure", async () => {
    const keys = registryAdapter();
    const diagnostic: FilmBuildDiagnostic = {
      severity: "error",
      code: "CLIP_VIDEO_MISSING",
      message: "Add a video to this clip.",
      entityType: "clip",
      entityId: "clip-1",
    };
    const createProductionBuild = vi
      .fn<StoryPublicationFlowServices["createProductionBuild"]>()
      .mockResolvedValueOnce(
        filmBuild({ status: "failed", runtimeJson: null, diagnostics: [diagnostic] })
      )
      .mockResolvedValueOnce(filmBuild());
    const services = flowServices({ createProductionBuild, buildSubmissionKeys: keys.adapter });

    await expect(runStoryPublication(services)).rejects.toMatchObject({
      code: "BUILD_NOT_READY",
      diagnostics: [diagnostic],
    });
    await runStoryPublication(services);

    expect(createProductionBuild.mock.calls.map((call) => call[1])).toEqual(["key-1", "key-2"]);
  });

  it("never publishes a ready build whose runtime is absent", async () => {
    const services = flowServices({ build: filmBuild({ runtimeJson: null }) });

    await expect(runStoryPublication(services)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      phase: "building",
    });
    expect(services.publishProductionBuild).not.toHaveBeenCalled();
    expect(services.buildSubmissionKeys.confirm).toHaveBeenCalledOnce();
  });

  it("distinguishes save failures from lock failures and preserves the upstream error", async () => {
    const saveError = new Error("Draft write failed with revision conflict.");
    const saveServices = flowServices({
      saveAndLockRevision: vi.fn().mockRejectedValue(saveError),
    });
    const lockError = new Error("Revision cannot be locked until the trailer is complete.");
    const lockServices = flowServices({
      saveAndLockRevision: vi.fn(async (onLockStart: () => void) => {
        onLockStart();
        throw lockError;
      }),
    });

    await expectPublicationError(runStoryPublication(saveServices), {
      code: "SAVE_FAILED",
      phase: "saving",
      upstreamError: saveError,
    });
    await expectPublicationError(runStoryPublication(lockServices), {
      code: "LOCK_FAILED",
      phase: "locking",
      upstreamError: lockError,
    });
  });

  it("accepts production revision zero in the immutable fingerprint", () => {
    expect(storyPublicationBuildFingerprint("revision-1", 0)).toBe(
      "story-publish:revision-1:0:production:full"
    );
  });
});

function flowServices({
  revision = storyRevision(),
  build = filmBuild(),
  order = [],
  saveAndLockRevision,
  createProductionBuild,
  publishProductionBuild,
  buildSubmissionKeys,
}: {
  revision?: StoryRevision;
  build?: FilmBuild;
  order?: string[];
  saveAndLockRevision?: StoryPublicationFlowServices["saveAndLockRevision"];
  createProductionBuild?: StoryPublicationFlowServices["createProductionBuild"];
  publishProductionBuild?: StoryPublicationFlowServices["publishProductionBuild"];
  buildSubmissionKeys?: StoryPublicationFlowServices["buildSubmissionKeys"];
} = {}): StoryPublicationFlowServices {
  const workbench = storyWorkbench(revision);
  return {
    saveAndLockRevision:
      saveAndLockRevision ??
      vi.fn(async (onLockStart) => {
        order.push("save");
        onLockStart();
        order.push("lock");
        return revision;
      }),
    loadLockedWorkbench: vi.fn(async () => {
      order.push("workbench");
      return workbench;
    }),
    createProductionBuild:
      createProductionBuild ??
      vi.fn(async () => {
        order.push("build");
        return build;
      }),
    publishProductionBuild:
      publishProductionBuild ??
      vi.fn(async () => {
        order.push("publish");
        return releaseResult();
      }),
    buildSubmissionKeys: buildSubmissionKeys ?? {
      keyFor: vi.fn(() => {
        order.push("key");
        return "submission-key-1";
      }),
      confirm: vi.fn(() => {
        order.push("confirm");
      }),
    },
  };
}

function registryAdapter() {
  const registry = new StorySubmissionKeyRegistry();
  let sequence = 0;
  const adapter: StoryPublicationFlowServices["buildSubmissionKeys"] = {
    keyFor: (fingerprint) =>
      registry.keyFor("production-full", fingerprint, () => `key-${++sequence}`),
    confirm: (fingerprint) => registry.confirm("production-full", fingerprint),
  };
  return { registry, adapter };
}

async function expectPublicationError(
  promise: Promise<unknown>,
  expected: Pick<StoryPublicationFlowError, "code" | "phase" | "upstreamError">
) {
  try {
    await promise;
    throw new Error("Expected publication to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(StoryPublicationFlowError);
    expect(error).toMatchObject(expected);
  }
}

function storyRevision(): StoryRevision {
  return {
    id: "revision-1",
    number: 3,
    sourceDraftRevision: 18,
    schemaVersion: "interactive-film-draft-v2",
    contentHash: "story-hash",
    label: null,
    source: "creator",
    createdByUserId: "user-1",
    createdAt: "2026-07-16T12:00:00.000Z",
    projectId: "project-1",
    format: "interactive_film",
    content: {},
  } as StoryRevision;
}

function storyWorkbench(revision: StoryRevision): StoryWorkbench {
  return {
    selectedRevision: revision,
    film: { productionRevision: 7 },
  } as StoryWorkbench;
}

function filmBuild(overrides: Partial<FilmBuild> = {}): FilmBuild {
  return {
    id: "build-1",
    projectId: "project-1",
    revisionId: "revision-1",
    number: 4,
    version: 1,
    profile: "production",
    scope: { kind: "full" },
    status: "ready",
    sourceProductionRevision: 7,
    inputHash: "input-hash",
    inputManifestHash: "input-manifest-hash",
    runtimeSchemaVersion: 2,
    runtimeJson: { schemaVersion: 2 },
    runtimeHash: "runtime-hash",
    assets: [],
    diagnostics: [],
    pathReport: null,
    publication: null,
    createdByUserId: "user-1",
    createdAt: "2026-07-16T12:00:00.000Z",
    completedAt: "2026-07-16T12:00:01.000Z",
    ...overrides,
  };
}

function releaseResult(): ExperienceReleaseResult {
  return {
    gameId: "jinling",
    contentVersion: "v3",
    status: "published",
    manifestUrl: "https://media.example.test/jinling/v3/manifest.json",
  };
}
