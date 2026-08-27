// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryLatestGeneration, StoryProductionGeneration } from "@/lib/story-production-api";
import { StoryProductionGenerationControl } from "./story-production-generation-control";

const apiMocks = vi.hoisted(() => ({
  createAsset: vi.fn(),
  getAsset: vi.fn(),
  cancelAsset: vi.fn(),
  retryAsset: vi.fn(),
  retryAssetAttachment: vi.fn(),
  createClip: vi.fn(),
  getClip: vi.fn(),
  cancelClip: vi.fn(),
  retryClip: vi.fn(),
  retryClipAttachment: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));

vi.mock("@/lib/story-production-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/story-production-api")>(
    "@/lib/story-production-api"
  );
  return {
    ...actual,
    createStoryAssetGeneration: apiMocks.createAsset,
    getStoryAssetGeneration: apiMocks.getAsset,
    cancelStoryAssetGeneration: apiMocks.cancelAsset,
    retryStoryAssetGeneration: apiMocks.retryAsset,
    retryStoryAssetGenerationMaterialization: apiMocks.retryAssetAttachment,
    createStoryStoryboardClipGeneration: apiMocks.createClip,
    getStoryStoryboardClipGeneration: apiMocks.getClip,
    cancelStoryStoryboardClipGeneration: apiMocks.cancelClip,
    retryStoryStoryboardClipGeneration: apiMocks.retryClip,
    retryStoryStoryboardClipGenerationMaterialization: apiMocks.retryClipAttachment,
  };
});

describe("StoryProductionGenerationControl", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });

  it("never starts paid generation while rendering an idle target", async () => {
    await renderControl(assetTarget(null));

    expect(button("generate")).not.toBeNull();
    expect(apiMocks.createAsset).not.toHaveBeenCalled();
    expect(apiMocks.getAsset).not.toHaveBeenCalled();
  });

  it("keeps stale production targets inspectable without exposing generation actions", async () => {
    await renderControl(assetTarget(null), false);

    expect(button("generate")).toBeNull();
    expect(button("retry")).toBeNull();
    expect(apiMocks.createAsset).not.toHaveBeenCalled();
    expect(apiMocks.retryAsset).not.toHaveBeenCalled();
  });

  it("submits one default command even when the Generate button is clicked twice rapidly", async () => {
    const accepted = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    apiMocks.createAsset.mockResolvedValue(accepted);
    apiMocks.getAsset.mockResolvedValue(accepted);
    await renderControl(assetTarget(null));

    await act(async () => {
      button("generate")?.click();
      button("generate")?.click();
    });

    await vi.waitFor(() => expect(apiMocks.createAsset).toHaveBeenCalledTimes(1));
    expect(apiMocks.createAsset).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "asset-1",
      expect.stringMatching(/^story-generate:/),
      { expectedVersion: 3 }
    );
  });

  it("resumes an in-flight clip generation from the authoritative latest pointer and cancels it", async () => {
    const active = generation({
      kind: "storyboard_clip",
      id: "clip-1",
      sequenceId: "sequence-1",
    });
    apiMocks.getClip.mockResolvedValue(active);
    apiMocks.cancelClip.mockResolvedValue({
      ...active,
      aiJob: { ...active.aiJob, status: "cancelled" },
    });
    await renderControl(clipTarget(latest(active)));

    await vi.waitFor(() => expect(apiMocks.getClip).toHaveBeenCalled());
    expect(apiMocks.getClip).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "sequence-1",
      "clip-1",
      "generation-1",
      expect.any(AbortSignal)
    );

    await act(async () => button("cancel")?.click());
    await vi.waitFor(() => expect(apiMocks.cancelClip).toHaveBeenCalledTimes(1));
    expect(apiMocks.cancelClip).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "sequence-1",
      "clip-1",
      "generation-1"
    );
  });

  it("offers target-preserving retry for a failed generation", async () => {
    const failed = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    failed.aiJob.status = "failed";
    failed.aiJob.error = { message: "Provider was unavailable", retryable: true };
    const retried = { ...failed, id: "generation-2", retryOfGenerationId: failed.id };
    retried.aiJob = { ...failed.aiJob, id: "job-2", status: "in_queue", error: null };
    apiMocks.getAsset.mockResolvedValue(failed);
    apiMocks.retryAsset.mockResolvedValue(retried);
    await renderControl(assetTarget(latest(failed)));

    await vi.waitFor(() => expect(button("retry")).not.toBeNull());
    await act(async () => button("retry")?.click());

    await vi.waitFor(() => expect(apiMocks.retryAsset).toHaveBeenCalledTimes(1));
    expect(apiMocks.retryAsset).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "asset-1",
      "generation-1",
      expect.stringMatching(/^story-generate-retry:/),
      { expectedVersion: 3 }
    );
  });

  it("retries only attachment materialization after a completed job", async () => {
    const failedAttachment = generation({
      kind: "storyboard_clip",
      id: "clip-1",
      sequenceId: "sequence-1",
    });
    failedAttachment.aiJob.status = "completed";
    failedAttachment.materialization = {
      ...failedAttachment.materialization,
      status: "failed",
      canRetry: true,
      error: { message: "Attachment timed out", attachmentRetryable: true },
    };
    const retrying = {
      ...failedAttachment,
      materialization: {
        ...failedAttachment.materialization,
        status: "pending" as const,
        canRetry: false,
      },
    };
    apiMocks.getClip.mockResolvedValue(failedAttachment);
    apiMocks.retryClipAttachment.mockResolvedValue(retrying);
    await renderControl(clipTarget(latest(failedAttachment)));

    await vi.waitFor(() => expect(button("retryAttachment")).not.toBeNull());
    await act(async () => {
      button("retryAttachment")?.click();
      button("retryAttachment")?.click();
    });

    await vi.waitFor(() => expect(apiMocks.retryClipAttachment).toHaveBeenCalledTimes(1));
    expect(apiMocks.retryClip).not.toHaveBeenCalled();
    expect(apiMocks.createClip).not.toHaveBeenCalled();
    expect(apiMocks.retryClipAttachment).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "sequence-1",
      "clip-1",
      "generation-1",
      "/aurora/story-projects/project-1/chapters/chapter-1/storyboard/sequences/sequence-1/clips/clip-1/generations/generation-1/materialization/retry",
      expect.stringMatching(/^story-attachment-retry:/)
    );
  });

  it("invalidates only the active chapter projections after media is attached", async () => {
    const completed = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    completed.aiJob.status = "completed";
    completed.aiJob.progress = 1;
    completed.materialization.status = "completed";
    completed.materialization.materializedAt = "2026-08-21T00:01:00.000Z";
    apiMocks.getAsset.mockResolvedValue(completed);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await renderControl(assetTarget(latest(completed)));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["story-studio", "production-state", "project-1", "chapter-1"],
        ["story-studio", "asset-specs", "project-1", "chapter-1"],
        ["story-studio", "storyboard", "project-1", "chapter-1"],
      ])
    );
    expect(keys.flat()).not.toContain("chapter-2");
  });

  async function renderControl(
    target: ReturnType<typeof assetTarget> | ReturnType<typeof clipTarget>,
    allowGeneration = true
  ) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryProductionGenerationControl
            scope={{
              projectId: "project-1",
              chapterId: "chapter-1",
            }}
            target={target}
            label="Production target"
            selectedMedia={null}
            allowGeneration={allowGeneration}
          />
        </QueryClientProvider>
      );
    });
  }

  function button(label: string): HTMLButtonElement | null {
    return (
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.textContent?.trim() === label
      ) ?? null
    );
  }
});

function assetTarget(latestGeneration: StoryLatestGeneration | null) {
  return {
    kind: "asset_spec" as const,
    id: "asset-1",
    sequenceId: null,
    version: 3,
    status: "current" as const,
    latestGeneration,
  };
}

function clipTarget(latestGeneration: StoryLatestGeneration | null) {
  return {
    kind: "storyboard_clip" as const,
    id: "clip-1",
    sequenceId: "sequence-1",
    version: 3,
    status: "current" as const,
    latestGeneration,
  };
}

function latest(value: StoryProductionGeneration): StoryLatestGeneration {
  return value;
}

function generation(
  target:
    | { kind: "asset_spec"; id: string; sequenceId: null }
    | { kind: "storyboard_clip"; id: string; sequenceId: string }
): StoryProductionGeneration {
  const materializationRetryUrl =
    target.kind === "asset_spec"
      ? `/aurora/story-projects/project-1/chapters/chapter-1/asset-specs/${target.id}/generations/generation-1/materialization/retry`
      : `/aurora/story-projects/project-1/chapters/chapter-1/storyboard/sequences/${target.sequenceId}/clips/${target.id}/generations/generation-1/materialization/retry`;
  return {
    id: "generation-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    target,
    outputKind: target.kind === "storyboard_clip" ? "image" : "image",
    targetVersion: 3,
    targetSourceFingerprint: "source-1",
    retryOfGenerationId: null,
    aiJob: {
      id: "job-1",
      modelId: "model-1",
      schemaVersion: "1",
      status: "in_progress",
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
      status: "waiting_for_job",
      attempts: 0,
      canRetry: false,
      error: null,
      materializedAt: null,
      nextReconcileAt: null,
      retryUrl: materializationRetryUrl,
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
