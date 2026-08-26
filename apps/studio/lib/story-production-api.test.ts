import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import {
  cancelStoryGenerationBatch,
  cancelStoryStoryboardClipGeneration,
  confirmStoryGenerationBatch,
  createStoryAssetGeneration,
  getStoryGenerationBatch,
  getStoryProductionState,
  getStoryStoryboardClipGeneration,
  getStoryStoryboard,
  listStoryGenerationBatches,
  listStoryAssetSpecs,
  quoteStoryAssetGenerationBatch,
  retryStoryAssetGenerationMaterialization,
  retryStoryStoryboardClipGeneration,
  retryStoryStoryboardClipGenerationMaterialization,
  resolveStoryAssetSpecConflict,
  resolveStoryStoryboardSequenceConflict,
} from "./story-production-api";

describe("Story production API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes production reads to the encoded project and chapter", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      projectId: "project / one",
      chapterId: "chapter / one",
      profile: { status: "current" },
      script: { status: "current", documentId: "doc-1", sequence: 2 },
      plotTree: { status: "current", nodeCount: 1 },
      assets: { status: "current", currentCount: 1, staleCount: 0 },
      storyboard: {
        status: "current",
        sequenceCount: 1,
        staleCount: 0,
        missingPlotNodeIds: [],
      },
      ready: true,
    });

    await getStoryProductionState("project / one", "chapter / one");

    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/chapters/chapter%20%2F%20one/production-state",
      {
        requestScope: "project",
        signal: undefined,
      }
    );
  });

  it("rejects a response that leaks another chapter into the active view", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      {
        projectId: "project-1",
        chapterId: "chapter-2",
      },
    ]);

    await expect(listStoryAssetSpecs("project-1", "chapter-1")).rejects.toThrow(
      "outside the requested chapter scope"
    );
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/chapters/chapter-1/asset-specs",
      { requestScope: "project", signal: undefined }
    );
  });

  it("rejects a nested Storyboard binding that embeds an Asset Spec from another chapter", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      {
        ...sequence(),
        clips: [
          {
            id: "clip-1",
            assetBindings: [
              {
                assetSpec: { projectId: "project-1", chapterId: "chapter-2" },
              },
            ],
          },
        ],
      },
    ]);

    await expect(getStoryStoryboard("project-1", "chapter-1")).rejects.toThrow(
      "outside the requested chapter scope"
    );
  });

  it("creates a default Asset Spec generation with only the authoritative target version", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(
      generation({ kind: "asset_spec", id: "asset-1", sequenceId: null })
    );

    await createStoryAssetGeneration("project-1", "chapter-1", "asset-1", "generate:key-1", {
      expectedVersion: 7,
    });

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/chapters/chapter-1/asset-specs/asset-1/generations",
      {
        data: { expectedVersion: 7 },
        requestScope: "project",
        headers: { "Idempotency-Key": "generate:key-1" },
      }
    );
  });

  it("uses Project Scope for every generation-batch command and query", async () => {
    vi.mocked(api.post).mockResolvedValue({});
    vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce({});

    await quoteStoryAssetGenerationBatch("project / one", "chapter / one", "quote:key-1", {
      targets: [{ id: "asset-1", expectedVersion: 3 }],
    });
    await confirmStoryGenerationBatch("project / one", "chapter / one", "batch / one", 4);
    await listStoryGenerationBatches("project / one", "chapter / one");
    await getStoryGenerationBatch("project / one", "chapter / one", "batch / one");
    await cancelStoryGenerationBatch("project / one", "chapter / one", "batch / one");

    const base =
      "/aurora/story-projects/project%20%2F%20one/chapters/chapter%20%2F%20one/generation-batches";
    expect(api.post).toHaveBeenNthCalledWith(1, `${base}/asset-specs/quote`, {
      data: { targets: [{ id: "asset-1", expectedVersion: 3 }] },
      requestScope: "project",
      headers: { "Idempotency-Key": "quote:key-1" },
    });
    expect(api.post).toHaveBeenNthCalledWith(2, `${base}/batch%20%2F%20one/confirm`, {
      data: { expectedVersion: 4 },
      requestScope: "project",
    });
    expect(api.get).toHaveBeenNthCalledWith(1, base, {
      requestScope: "project",
      signal: undefined,
    });
    expect(api.get).toHaveBeenNthCalledWith(2, `${base}/batch%20%2F%20one`, {
      requestScope: "project",
      signal: undefined,
    });
    expect(api.post).toHaveBeenNthCalledWith(3, `${base}/batch%20%2F%20one/cancel`, {
      requestScope: "project",
    });
  });

  it("uses target-scoped clip polling, cancel, and retry routes", async () => {
    const value = generation({
      kind: "storyboard_clip",
      id: "clip / one",
      sequenceId: "sequence / one",
    });
    vi.mocked(api.get).mockResolvedValueOnce(value);
    vi.mocked(api.post).mockResolvedValue(value);

    await getStoryStoryboardClipGeneration(
      "project-1",
      "chapter-1",
      "sequence / one",
      "clip / one",
      "generation / one"
    );
    await cancelStoryStoryboardClipGeneration(
      "project-1",
      "chapter-1",
      "sequence / one",
      "clip / one",
      "generation / one"
    );
    await retryStoryStoryboardClipGeneration(
      "project-1",
      "chapter-1",
      "sequence / one",
      "clip / one",
      "generation / one",
      "retry:key-1",
      { expectedVersion: 9 }
    );

    const base =
      "/aurora/story-projects/project-1/chapters/chapter-1/storyboard/sequences/sequence%20%2F%20one/clips/clip%20%2F%20one/generations/generation%20%2F%20one";
    expect(api.get).toHaveBeenCalledWith(base, {
      requestScope: "project",
      signal: undefined,
    });
    expect(api.post).toHaveBeenNthCalledWith(1, `${base}/cancel`, {
      requestScope: "project",
    });
    expect(api.post).toHaveBeenNthCalledWith(2, `${base}/retry`, {
      data: { expectedVersion: 9 },
      requestScope: "project",
      headers: { "Idempotency-Key": "retry:key-1" },
    });
  });

  it("uses a dedicated no-body materialization retry instead of the AI retry route", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(
      generation({ kind: "asset_spec", id: "asset-1", sequenceId: null })
    );
    vi.mocked(api.post).mockResolvedValueOnce(
      generation({ kind: "storyboard_clip", id: "clip-1", sequenceId: "sequence-1" })
    );

    await retryStoryAssetGenerationMaterialization(
      "project-1",
      "chapter-1",
      "asset-1",
      "generation-1",
      "/aurora/story-projects/project-1/chapters/chapter-1/asset-specs/asset-1/generations/generation-1/materialization/retry",
      "attach:key-1"
    );
    await retryStoryStoryboardClipGenerationMaterialization(
      "project-1",
      "chapter-1",
      "sequence-1",
      "clip-1",
      "generation-1",
      "/aurora/story-projects/project-1/chapters/chapter-1/storyboard/sequences/sequence-1/clips/clip-1/generations/generation-1/materialization/retry",
      "attach:key-2"
    );

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/aurora/story-projects/project-1/chapters/chapter-1/asset-specs/asset-1/generations/generation-1/materialization/retry",
      {
        requestScope: "project",
        headers: { "Idempotency-Key": "attach:key-1" },
      }
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/aurora/story-projects/project-1/chapters/chapter-1/storyboard/sequences/sequence-1/clips/clip-1/generations/generation-1/materialization/retry",
      {
        requestScope: "project",
        headers: { "Idempotency-Key": "attach:key-2" },
      }
    );
  });

  it("rejects a materialization retry URL outside the requested target scope", async () => {
    await expect(
      retryStoryAssetGenerationMaterialization(
        "project-1",
        "chapter-1",
        "asset-1",
        "generation-1",
        "/aurora/story-projects/project-1/chapters/chapter-2/asset-specs/asset-1/generations/generation-1/materialization/retry",
        "attach:key-1"
      )
    ).rejects.toThrow("outside the requested target scope");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("rejects a generation response for a different storyboard sequence", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      generation({ kind: "storyboard_clip", id: "clip-1", sequenceId: "sequence-2" })
    );

    await expect(
      getStoryStoryboardClipGeneration(
        "project-1",
        "chapter-1",
        "sequence-1",
        "clip-1",
        "generation-1"
      )
    ).rejects.toThrow("outside the requested storyboard scope");
  });

  it("resolves stale targets with both CAS fingerprints and chapter-scoped results", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      targetKind: "asset_spec",
      targetId: "asset-1",
      resolution: "keep_current",
      outcome: "kept_current",
      item: assetSpec(),
      productionState: productionState(),
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      targetKind: "storyboard_sequence",
      targetId: "sequence-1",
      resolution: "use_latest_plan",
      outcome: "applied_latest",
      item: sequence(),
      productionState: productionState(),
    });

    const fingerprint = "a".repeat(64);
    await resolveStoryAssetSpecConflict(
      "project-1",
      "chapter-1",
      "asset-1",
      "asset-conflict:key-1",
      {
        expectedVersion: 4,
        expectedPendingSourceFingerprint: fingerprint,
        resolution: "keep_current",
      }
    );
    await resolveStoryStoryboardSequenceConflict(
      "project-1",
      "chapter-1",
      "sequence-1",
      "sequence-conflict:key-1",
      {
        expectedVersion: 5,
        expectedPendingSourceFingerprint: fingerprint,
        resolution: "use_latest_plan",
      }
    );

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/aurora/story-projects/project-1/chapters/chapter-1/asset-specs/asset-1/conflict-resolution",
      {
        data: {
          expectedVersion: 4,
          expectedPendingSourceFingerprint: fingerprint,
          resolution: "keep_current",
        },
        requestScope: "project",
        headers: { "Idempotency-Key": "asset-conflict:key-1" },
      }
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/aurora/story-projects/project-1/chapters/chapter-1/storyboard/sequences/sequence-1/conflict-resolution",
      expect.objectContaining({
        data: expect.objectContaining({ resolution: "use_latest_plan" }),
      })
    );
  });

  it("rejects a conflict resolution result that leaks another chapter", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      targetKind: "asset_spec",
      targetId: "asset-1",
      resolution: "keep_current",
      outcome: "kept_current",
      item: { ...assetSpec(), chapterId: "chapter-2" },
      productionState: productionState(),
    });

    await expect(
      resolveStoryAssetSpecConflict("project-1", "chapter-1", "asset-1", "conflict:key-1", {
        expectedVersion: 1,
        expectedPendingSourceFingerprint: "b".repeat(64),
        resolution: "keep_current",
      })
    ).rejects.toThrow("outside the requested chapter scope");
  });
});

function sequence() {
  return {
    id: "sequence-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    plotNodeId: "plot-1",
    stableKey: "sequence-1",
    title: "Opening",
    description: null,
    suggestedDurationMs: 3_000,
    durationMs: 3_000,
    sourceFingerprint: "source-sequence-1",
    status: "current" as const,
    planDisposition: "planned" as const,
    pendingSourceFingerprint: null,
    conflict: null,
    version: 1,
    userModifiedAt: null,
    clips: [],
    cues: [],
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

function assetSpec() {
  return {
    id: "asset-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    stableKey: "hero",
    kind: "character" as const,
    sourceCharacterId: "hero",
    sourceNodeIds: ["plot-1"],
    name: "Hero",
    description: "Lead character",
    imagePrompt: "Red flight suit",
    videoPrompt: null,
    negativePrompt: null,
    generationConfig: {},
    sourceFingerprint: "source-asset-1",
    status: "current" as const,
    planDisposition: "user_override" as const,
    pendingSourceFingerprint: null,
    conflict: null,
    version: 5,
    selectedMediaVersionId: null,
    selectedMediaVersion: null,
    mediaVersions: [],
    latestGeneration: null,
    userModifiedAt: null,
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

function productionState() {
  return {
    projectId: "project-1",
    chapterId: "chapter-1",
    profile: { status: "current" as const },
    script: { status: "current" as const, documentId: "script-1", sequence: 1 },
    plotTree: { status: "current" as const, nodeCount: 1 },
    assets: { status: "current" as const, currentCount: 1, staleCount: 0 },
    storyboard: {
      status: "current" as const,
      sequenceCount: 1,
      staleCount: 0,
      missingPlotNodeIds: [],
    },
    ready: true,
  };
}

function generation(
  target:
    | { kind: "asset_spec"; id: string; sequenceId: null }
    | { kind: "storyboard_clip"; id: string; sequenceId: string }
) {
  return {
    id: "generation-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    target,
    outputKind: "image" as const,
    targetVersion: 1,
    targetSourceFingerprint: "source-1",
    retryOfGenerationId: null,
    aiJob: {
      id: "job-1",
      modelId: "model-1",
      schemaVersion: "1",
      status: "in_progress" as const,
      stage: "generating",
      progress: 0.5,
      queuePosition: null,
      estimatedWaitSeconds: null,
      estimatedRunSeconds: 20,
      estimatedTotalSeconds: 20,
      etaConfidence: "high",
      error: null,
    },
    materialization: {
      status: "waiting_for_job" as const,
      attempts: 0,
      canRetry: false,
      error: null,
      materializedAt: null,
      nextReconcileAt: null,
      retryUrl: "/materialization/retry",
    },
    timing: {
      timelineDurationMs: null,
      requestedSourceDurationSeconds: null,
      generatedSourceDurationSeconds: null,
      trimToTimeline: false,
    },
    mediaVersions: [],
    statusUrl: "/status",
    cancelUrl: "/cancel",
    retryUrl: "/retry",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}
