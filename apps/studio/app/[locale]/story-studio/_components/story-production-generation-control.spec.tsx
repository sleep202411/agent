// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StoryCreativeMediaVersion,
  StoryLatestGeneration,
  StoryProductionGeneration,
} from "@/lib/story-production-api";
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

  it("respects an explicit generation permission without deriving it from workflow state", async () => {
    await renderControl(assetTarget(null), false);

    expect(button("generate")).toBeNull();
    expect(button("retry")).toBeNull();
    expect(apiMocks.createAsset).not.toHaveBeenCalled();
    expect(apiMocks.retryAsset).not.toHaveBeenCalled();
  });

  it("generates from the target's persisted version", async () => {
    const accepted = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    apiMocks.createAsset.mockResolvedValue(accepted);
    apiMocks.getAsset.mockResolvedValue(accepted);

    await renderControl(assetTarget(null));
    await act(async () => button("generate")?.click());

    await vi.waitFor(() => expect(apiMocks.createAsset).toHaveBeenCalledTimes(1));
    expect(apiMocks.createAsset).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "asset-1",
      expect.stringMatching(/^story-generate:/),
      { expectedVersion: 3, purpose: "primary" }
    );
  });

  it("does not expose generation for an archived target", async () => {
    await renderControl(assetTarget(null, "archived"));

    expect(button("generate")).toBeNull();
    expect(apiMocks.createAsset).not.toHaveBeenCalled();
  });

  it("allows a fresh storyboard generation after a non-retryable provider configuration error", async () => {
    const failed = generation({ kind: "storyboard_clip", id: "clip-1", sequenceId: "sequence-1" });
    failed.aiJob.status = "failed";
    failed.aiJob.error = { message: "BAILIAN_API_KEY unset", retryable: false };
    apiMocks.getClip.mockResolvedValue(failed);
    apiMocks.createClip.mockResolvedValue({ ...failed, id: "generation-2" });
    await renderControl(clipTarget(latest(failed)));
    expect(button("retry")).toBeNull();
    expect(button("generate")?.disabled).toBe(false);
    await act(async () => button("generate")?.click());
    expect(apiMocks.createClip).toHaveBeenCalledOnce();
    expect(apiMocks.retryClip).not.toHaveBeenCalled();
  });

  it("keeps an incomplete asset's inline action visible with its reason", async () => {
    await renderControl(assetTarget(null), true, null, {
      layout: "inline",
      allowConcurrent: true,
      generationDisabledReason: "Generate the character image first.",
    });
    const generate = container.querySelector<HTMLButtonElement>('button[aria-label="generate"]');
    expect(generate?.disabled).toBe(true);
    expect(container.textContent).toContain("Generate the character image first.");
    await act(async () => generate?.click());
    expect(apiMocks.createAsset).not.toHaveBeenCalled();
  });

  it("waits for pending edits to save and generates from the returned version", async () => {
    let finishSave!: (version: number) => void;
    const prepareGeneration = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finishSave = resolve;
        })
    );
    const accepted = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    apiMocks.createAsset.mockResolvedValue(accepted);
    apiMocks.getAsset.mockResolvedValue(accepted);
    await renderControl(assetTarget(null), true, null, {
      submitGeneration: async (submit) => submit(await prepareGeneration()),
    });
    await act(async () => button("generate")?.click());
    expect(prepareGeneration).toHaveBeenCalledOnce();
    expect(apiMocks.createAsset).not.toHaveBeenCalled();
    await act(async () => finishSave(4));
    expect(apiMocks.createAsset).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "asset-1",
      expect.any(String),
      { expectedVersion: 4, purpose: "primary" }
    );
  });

  it("does not submit a paid run when saving the edits fails", async () => {
    await renderControl(assetTarget(null), true, null, {
      submitGeneration: async () => {
        throw new Error("Asset changed. Reload before saving.");
      },
    });
    await act(async () => button("generate")?.click());
    expect(apiMocks.createAsset).not.toHaveBeenCalled();
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
      { expectedVersion: 3, purpose: "primary" }
    );
  });

  it("submits every paid click with a unique key when concurrent Asset generation is enabled", async () => {
    const pendingCounts = vi.fn();
    const first = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    const second = {
      ...first,
      id: "generation-2",
      aiJob: { ...first.aiJob, id: "job-2" },
    };
    apiMocks.createAsset.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    apiMocks.getAsset.mockImplementation(async (_projectId, _chapterId, _assetId, generationId) =>
      generationId === second.id ? second : first
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryProductionGenerationControl
            scope={{ projectId: "project-1", chapterId: "chapter-1" }}
            target={assetTarget(null)}
            label="Production target"
            selectedMedia={null}
            layout="inline"
            purpose="turnaround"
            allowConcurrent
            onPendingPreviewCountChange={pendingCounts}
          />
        </QueryClientProvider>
      );
    });

    const generate = container.querySelector<HTMLButtonElement>('button[aria-label="generate"]');
    expect(generate).not.toBeNull();
    await act(async () => {
      generate?.click();
      generate?.click();
    });

    await vi.waitFor(() => expect(apiMocks.createAsset).toHaveBeenCalledTimes(2));
    const calls = apiMocks.createAsset.mock.calls;
    expect(calls[0]?.[4]).toEqual({ expectedVersion: 3, purpose: "turnaround" });
    expect(calls[1]?.[4]).toEqual({ expectedVersion: 3, purpose: "turnaround" });
    expect(calls[0]?.[3]).not.toBe(calls[1]?.[3]);
    expect(pendingCounts).toHaveBeenCalledWith(2);
  });

  it("reports one pending preview for every output requested by a generation", async () => {
    const pendingCounts = vi.fn();
    const accepted = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    accepted.requestedOutputCount = 2;
    let resolveGeneration!: (value: StoryProductionGeneration) => void;
    apiMocks.createAsset.mockReturnValue(
      new Promise<StoryProductionGeneration>((resolve) => {
        resolveGeneration = resolve;
      })
    );
    apiMocks.getAsset.mockResolvedValue(accepted);

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryProductionGenerationControl
            scope={{ projectId: "project-1", chapterId: "chapter-1" }}
            target={assetTarget(null)}
            label="Production target"
            selectedMedia={null}
            layout="inline"
            modelSelection={{ modelId: "model-1", schemaVersion: "1" }}
            generationOptions={{ numOutputs: 2 }}
            allowConcurrent
            onPendingPreviewCountChange={pendingCounts}
          />
        </QueryClientProvider>
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="generate"]')?.click();
    });
    await vi.waitFor(() => expect(pendingCounts).toHaveBeenCalledWith(2));

    await act(async () => resolveGeneration(accepted));
  });

  it("keeps an earlier concurrent failure visible while a later run is still active", async () => {
    const first = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    const second = {
      ...first,
      id: "generation-2",
      createdAt: "2026-08-21T00:00:01.000Z",
      updatedAt: "2026-08-21T00:00:01.000Z",
      aiJob: { ...first.aiJob, id: "job-2" },
    };
    const failed = {
      ...first,
      aiJob: {
        ...first.aiJob,
        status: "failed" as const,
        error: { message: "The provider rejected the first run", retryable: true },
      },
    };
    apiMocks.createAsset.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    apiMocks.getAsset.mockImplementation(async (_projectId, _chapterId, _assetId, generationId) =>
      generationId === first.id ? failed : second
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryProductionGenerationControl
            scope={{ projectId: "project-1", chapterId: "chapter-1" }}
            target={assetTarget(null)}
            label="Production target"
            selectedMedia={null}
            layout="inline"
            allowConcurrent
          />
        </QueryClientProvider>
      );
    });

    const generate = container.querySelector<HTMLButtonElement>('button[aria-label="generate"]');
    await act(async () => {
      generate?.click();
      generate?.click();
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "The provider rejected the first run"
      );
    });
    expect(container.querySelector('button[aria-label="generate"]')).not.toBeNull();
  });

  it("shows a just-completed generation while the authoritative target projection refreshes", async () => {
    const completed = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    completed.aiJob.status = "completed";
    completed.aiJob.progress = 1;
    completed.materialization.status = "completed";
    completed.materialization.materializedAt = "2026-08-21T00:01:00.000Z";
    completed.mediaVersions = [mediaVersion("new-media", "https://media.example/new.jpg")];
    apiMocks.createAsset.mockResolvedValue(completed);
    apiMocks.getAsset.mockResolvedValue(completed);
    await renderControl(assetTarget(null));

    await act(async () => button("generate")?.click());

    await vi.waitFor(() => {
      const image = container.querySelector<HTMLImageElement>('img[alt="Production target"]');
      expect(image?.getAttribute("src")).toBe("https://media.example/new.jpg");
    });
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

  it("shows manually selected media instead of an older completed generation result", async () => {
    const completed = generation({ kind: "asset_spec", id: "asset-1", sequenceId: null });
    completed.aiJob.status = "completed";
    completed.aiJob.progress = 1;
    completed.materialization.status = "completed";
    completed.materialization.materializedAt = "2026-08-21T00:01:00.000Z";
    completed.mediaVersions = [
      mediaVersion("generated-media", "https://media.example/generated.jpg"),
    ];
    apiMocks.getAsset.mockResolvedValue(completed);

    await renderControl(
      assetTarget(latest(completed)),
      true,
      mediaVersion("replacement-media", "https://media.example/replacement.jpg")
    );

    await vi.waitFor(() => expect(apiMocks.getAsset).toHaveBeenCalled());
    const image = container.querySelector<HTMLImageElement>('img[alt="Production target"]');
    expect(image?.getAttribute("src")).toBe("https://media.example/replacement.jpg");
  });

  it("does not present a completed output from an older target version as current media", async () => {
    const completed = generation({
      kind: "storyboard_clip",
      id: "clip-1",
      sequenceId: "sequence-1",
    });
    completed.targetVersion = 2;
    completed.aiJob.status = "completed";
    completed.aiJob.progress = 1;
    completed.materialization.status = "completed";
    completed.materialization.materializedAt = "2026-08-21T00:01:00.000Z";
    completed.mediaVersions = [
      mediaVersion("stale-generated-media", "https://media.example/stale-generated.jpg"),
    ];
    apiMocks.getClip.mockResolvedValue(completed);

    await renderControl(clipTarget(latest(completed)));

    await vi.waitFor(() => expect(apiMocks.getClip).toHaveBeenCalled());
    expect(container.querySelector<HTMLImageElement>('img[alt="Production target"]')).toBeNull();
    expect(button("generate")).not.toBeNull();
  });

  it("does not revive unselected generation history when the target still has no media", async () => {
    const completed = generation({
      kind: "storyboard_clip",
      id: "clip-1",
      sequenceId: "sequence-1",
    });
    completed.aiJob.status = "completed";
    completed.aiJob.progress = 1;
    completed.materialization.status = "completed";
    completed.materialization.materializedAt = "2026-08-21T00:01:00.000Z";
    completed.mediaVersions = [
      mediaVersion("unselected-history", "https://media.example/unselected-history.jpg"),
    ];
    apiMocks.getClip.mockResolvedValue(completed);

    await renderControl(clipTarget(latest(completed)));

    await vi.waitFor(() => expect(apiMocks.getClip).toHaveBeenCalled());
    expect(container.querySelector<HTMLImageElement>('img[alt="Production target"]')).toBeNull();
  });

  async function renderControl(
    target: ReturnType<typeof assetTarget> | ReturnType<typeof clipTarget>,
    allowGeneration = true,
    selectedMedia: StoryCreativeMediaVersion | null = null,
    options: Partial<ComponentProps<typeof StoryProductionGenerationControl>> = {}
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
            selectedMedia={selectedMedia}
            allowGeneration={allowGeneration}
            {...options}
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

function mediaVersion(id: string, previewUrl: string): StoryCreativeMediaVersion {
  return {
    id,
    versionNumber: 1,
    mediaAssetId: `${id}-asset`,
    mediaKind: "image",
    mediaStatus: "ready",
    preferredVariantId: null,
    previewUrl,
    thumbnailUrl: previewUrl,
    width: 1600,
    height: 900,
    durationSeconds: null,
    mimeType: "image/jpeg",
    sourceFingerprint: id,
    createdAt: "2026-08-21T00:00:00.000Z",
  };
}

function assetTarget(
  latestGeneration: StoryLatestGeneration | null,
  status: "current" | "archived" = "current"
) {
  return {
    kind: "asset_spec" as const,
    id: "asset-1",
    sequenceId: null,
    version: 3,
    status,
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
    requestedOutputCount: 1,
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
