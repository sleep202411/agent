// @vitest-environment jsdom
/* eslint-disable @next/next/no-img-element -- next/image is intentionally reduced to an img in jsdom. */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  storyGenerationBatchHasPendingItems,
  type StoryAssetSpec,
  type StoryGenerationBatch,
} from "@/lib/story-production-api";
import { StoryGenerationBatchTranscript } from "./story-generation-batch-transcript";

const api = vi.hoisted(() => ({
  getBatch: vi.fn(),
  listAssets: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock("@/lib/story-production-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-production-api")>();
  return {
    ...actual,
    getStoryGenerationBatch: api.getBatch,
    listStoryAssetSpecs: api.listAssets,
  };
});

describe("StoryGenerationBatchTranscript", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.getBatch.mockReset();
    api.listAssets.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });

  it("keeps one horizontal card row and shows media only after that item completes", async () => {
    api.getBatch.mockResolvedValue(batch());
    api.listAssets.mockResolvedValue([
      asset("asset-queued", "Queued hero", "https://media.example/old.jpg"),
      asset("asset-done", "Finished hero", "https://media.example/generated.jpg"),
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryGenerationBatchTranscript
            reference={{
              kind: "story_generation_batch",
              generationBatchId: "batch-1",
              storyProjectId: "project-1",
              storyChapterId: "chapter-1",
              schemaVersion: "story-generation-batch-artifact/v1",
            }}
          />
        </QueryClientProvider>
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await vi.waitFor(() => expect(container.querySelectorAll("article")).toHaveLength(2));
      await vi.waitFor(() =>
        expect(
          container.querySelector('img[src="https://media.example/generated.jpg"]')
        ).not.toBeNull()
      );
    });

    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(api.getBatch).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "batch-1",
      expect.any(AbortSignal)
    );
    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
    expect(container.querySelectorAll(".aspect-\\[3\\/4\\]")).toHaveLength(2);
    expect(
      container.querySelector('img[src="https://media.example/generated.jpg"]')
    ).not.toBeNull();
    expect(container.querySelector('img[src="https://media.example/old.jpg"]')).toBeNull();
  });

  it("keeps polling until the explicit cancelling state becomes terminal", () => {
    const cancelling = { ...batch(), status: "cancelling" as const };
    expect(storyGenerationBatchHasPendingItems(cancelling)).toBe(true);
    expect(
      storyGenerationBatchHasPendingItems({
        ...cancelling,
        status: "cancelled",
        counts: { ...cancelling.counts, submitted: 0, completed: 2 },
        items: cancelling.items.map((value) => ({ ...value, status: "completed" as const })),
      })
    ).toBe(false);
  });

  it("keeps an insufficient-credit failure visible in the persisted transcript", async () => {
    const failed = batch();
    failed.status = "failed";
    failed.completedAt = "2026-08-26T11:46:00.000Z";
    failed.counts = {
      ...failed.counts,
      submitted: 0,
      completed: 0,
      failed: 2,
    };
    failed.items = failed.items.map((value) => ({
      ...value,
      status: "failed" as const,
      generationId: null,
      error: {
        code: "INSUFFICIENT_COMPUTE_POINTS",
        message: "Conflict Exception",
        retryable: false,
      },
    }));
    api.getBatch.mockResolvedValue(failed);
    api.listAssets.mockResolvedValue([]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryGenerationBatchTranscript
            reference={{
              kind: "story_generation_batch",
              generationBatchId: "batch-1",
              storyProjectId: "project-1",
              storyChapterId: "chapter-1",
              schemaVersion: "story-generation-batch-artifact/v1",
            }}
          />
        </QueryClientProvider>
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain("insufficientCredits"));
    });
  });
});

function batch(): StoryGenerationBatch {
  return {
    id: "batch-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    status: "running",
    totalPoints: 120,
    availablePoints: null,
    itemCount: 2,
    version: 1,
    quoteExpiresAt: "2026-08-26T12:00:00.000Z",
    confirmedAt: "2026-08-26T11:45:00.000Z",
    completedAt: null,
    canCancel: true,
    counts: {
      awaiting_confirmation: 0,
      ready: 0,
      dispatching: 0,
      submitted: 1,
      completed: 1,
      failed: 0,
      cancelled: 0,
    },
    items: [
      item("item-queued", "asset-queued", "submitted", 0),
      item("item-done", "asset-done", "completed", 1),
    ],
  };
}

function item(
  id: string,
  targetId: string,
  status: StoryGenerationBatch["items"][number]["status"],
  ordinal: number
): StoryGenerationBatch["items"][number] {
  return {
    id,
    ordinal,
    status,
    targetId,
    targetVersion: 1,
    outputKind: "image",
    modelId: "gpt-image-2",
    schemaVersion: "v1",
    quotedPoints: 60,
    generationId: status === "completed" ? "generation-1" : null,
    error: null,
  };
}

function asset(id: string, name: string, previewUrl: string): StoryAssetSpec {
  return {
    id,
    projectId: "project-1",
    chapterId: "chapter-1",
    stableKey: id,
    kind: "character",
    sourceCharacterId: null,
    sourceNodeIds: [],
    name,
    description: null,
    imagePrompt: "portrait",
    videoPrompt: null,
    negativePrompt: null,
    generationConfig: {},
    sourceFingerprint: `source-${id}`,
    status: "current",
    planDisposition: "planned",
    pendingSourceFingerprint: null,
    conflict: null,
    version: 1,
    selectedMediaVersionId: `media-${id}`,
    selectedMediaVersion: {
      id: `media-${id}`,
      versionNumber: 1,
      mediaAssetId: `blob-${id}`,
      mediaKind: "image",
      mediaStatus: "ready",
      preferredVariantId: null,
      previewUrl,
      thumbnailUrl: null,
      width: 768,
      height: 1024,
      durationSeconds: null,
      mimeType: "image/jpeg",
      sourceFingerprint: `media-source-${id}`,
      createdAt: "2026-08-26T12:00:00.000Z",
    },
    mediaVersions: [],
    latestGeneration: null,
    userModifiedAt: null,
    updatedAt: "2026-08-26T12:00:00.000Z",
  };
}
