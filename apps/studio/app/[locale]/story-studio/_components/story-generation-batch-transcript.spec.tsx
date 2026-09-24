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
  type StoryStoryboardSequence,
} from "@/lib/story-production-api";
import { StoryGenerationBatchTranscript } from "./story-generation-batch-transcript";

const api = vi.hoisted(() => ({
  getBatch: vi.fn(),
  listAssets: vi.fn(),
  listStoryboard: vi.fn(),
  resumeBatch: vi.fn(),
  cancelBatch: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (key === "mobileCard.title") return `${values?.kind}: ${values?.name}`;
    if (key === "mobileStoryboard.title") return `${values?.index}: ${values?.name}`;
    return key;
  },
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
    getStoryStoryboard: api.listStoryboard,
    resumeStoryGenerationBatch: api.resumeBatch,
    cancelStoryGenerationBatch: api.cancelBatch,
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
    api.listStoryboard.mockReset();
    api.resumeBatch.mockReset();
    api.cancelBatch.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });

  async function renderTranscript(compactMobile: boolean) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryGenerationBatchTranscript
            compactMobile={compactMobile}
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
  }

  it("reveals only the settled prefix and current H5 generation item", async () => {
    api.getBatch.mockResolvedValue(batch());
    api.listAssets.mockResolvedValue([
      asset("asset-1", "Character 1", "https://media.example/character-1.jpg"),
      asset("asset-2", "Character 2", "https://media.example/character-2-old.jpg"),
      asset("asset-3", "Character 3", "https://media.example/character-3-old.jpg"),
    ]);

    await renderTranscript(true);

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.querySelectorAll("[data-generation-item]")).toHaveLength(2)
      );
      await vi.waitFor(() =>
        expect(
          container.querySelector('img[src="https://media.example/character-1.jpg"]')
        ).not.toBeNull()
      );
    });

    expect(api.getBatch).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "batch-1",
      expect.any(AbortSignal)
    );
    expect(container.querySelector('[data-testid="sequential-generation-stream"]')).not.toBeNull();
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    expect(container.textContent).toContain("Character 1");
    expect(container.textContent).toContain("Character 2");
    expect(container.textContent).not.toContain("Character 3");
    expect(container.textContent).toContain("mobileCard.generating");
    expect(container.textContent).not.toContain("itemStatus.completed");
    expect(container.textContent).not.toContain("%");
    expect(container.querySelector("[data-generation-item='asset-1']")?.hasAttribute("open")).toBe(
      true
    );
    expect(
      container.querySelector('img[src="https://media.example/character-2-old.jpg"]')
    ).toBeNull();
    expect(
      container.querySelector('img[src="https://media.example/character-3-old.jpg"]')
    ).toBeNull();
  });

  it("reveals the next H5 item only after the preceding item settles", async () => {
    const advanced = batch();
    advanced.counts = {
      ...advanced.counts,
      ready: 0,
      submitted: 1,
      completed: 2,
    };
    advanced.items = [
      item("item-1", "asset-1", "completed", 0),
      item("item-2", "asset-2", "completed", 1),
      item("item-3", "asset-3", "submitted", 2),
    ];
    api.getBatch.mockResolvedValue(advanced);
    api.listAssets.mockResolvedValue([
      asset("asset-1", "Character 1", "https://media.example/character-1.jpg"),
      asset("asset-2", "Character 2", "https://media.example/character-2.jpg"),
      asset("asset-3", "Character 3", "https://media.example/character-3-old.jpg"),
    ]);

    await renderTranscript(true);

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.querySelectorAll("[data-generation-item]")).toHaveLength(3)
      );
      await vi.waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
    });
    expect(container.textContent).toContain("Character 3");
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("keeps the complete batch visible on desktop", async () => {
    api.getBatch.mockResolvedValue(batch());
    api.listAssets.mockResolvedValue([
      asset("asset-1", "Character 1", "https://media.example/character-1.jpg"),
      asset("asset-2", "Character 2", "https://media.example/character-2-old.jpg"),
      asset("asset-3", "Character 3", "https://media.example/character-3-old.jpg"),
    ]);

    await renderTranscript(false);

    await act(async () => {
      await vi.waitFor(() => expect(container.querySelectorAll("article")).toHaveLength(3));
    });
    expect(container.querySelector("[role='progressbar']")).not.toBeNull();
    expect(container.querySelector('[data-testid="sequential-generation-stream"]')).toBeNull();
  });

  it("keeps polling until the explicit cancelling state becomes terminal", () => {
    const cancelling = { ...batch(), status: "cancelling" as const };
    expect(storyGenerationBatchHasPendingItems(cancelling)).toBe(true);
    expect(
      storyGenerationBatchHasPendingItems({
        ...cancelling,
        status: "cancelled",
        counts: { ...cancelling.counts, ready: 0, submitted: 0, completed: 3 },
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
      ready: 0,
      submitted: 0,
      completed: 0,
      failed: 3,
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

  it("keeps provider failure details collapsed inside the failed H5 asset card", async () => {
    const failed = batch();
    failed.status = "partial_failed";
    failed.counts = {
      ...failed.counts,
      ready: 0,
      submitted: 0,
      completed: 1,
      failed: 1,
      cancelled: 1,
    };
    failed.items = [
      item("item-1", "asset-1", "completed", 0),
      {
        ...item("item-2", "asset-2", "failed", 1),
        error: {
          code: "NO_MEDIA_GENERATED",
          message: "Provider returned a detailed failure.",
          retryable: false,
        },
      },
      item("item-3", "asset-3", "cancelled", 2),
    ];
    api.getBatch.mockResolvedValue(failed);
    api.listAssets.mockResolvedValue([
      asset("asset-1", "Character 1", "https://media.example/character-1.jpg"),
      asset("asset-2", "Character 2", "https://media.example/character-2-old.jpg"),
      asset("asset-3", "Character 3", "https://media.example/character-3-old.jpg"),
    ]);

    await renderTranscript(true);

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.querySelectorAll("[data-generation-item]")).toHaveLength(2)
      );
      await vi.waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(1));
    });
    const failedCard = container.querySelector("[data-generation-item='asset-2']");
    const errorDetails = failedCard?.querySelector("details");
    expect(failedCard?.textContent).toContain("mobileCard.failed");
    expect(errorDetails?.hasAttribute("open")).toBe(false);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.textContent).not.toContain("Character 3");
  });

  it("keeps a low-balance batch on its current card with recharge, resume, and stop actions", async () => {
    const blocked = batch();
    blocked.status = "blocked";
    blocked.availablePoints = "0";
    blocked.blockedAt = "2026-08-26T11:46:00.000Z";
    blocked.blockReason = {
      code: "INSUFFICIENT_COMPUTE_POINTS",
      message: "Not enough compute points.",
      retryable: true,
      requiredAmount: "60",
      availableBalance: "0",
    };
    blocked.counts = {
      awaiting_confirmation: 3,
      ready: 0,
      dispatching: 0,
      submitted: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    blocked.items = blocked.items.map((value) => ({
      ...value,
      status: "awaiting_confirmation" as const,
    }));
    api.getBatch.mockResolvedValue(blocked);
    api.listAssets.mockResolvedValue([
      asset("asset-1", "Character 1", "https://media.example/old.jpg"),
    ]);

    await renderTranscript(true);

    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain("recovery.balanceTitle"));
    });
    expect(container.querySelectorAll("[data-generation-item]")).toHaveLength(1);
    expect(container.textContent).toContain("mobileCard.paused");
    expect(container.textContent).toContain("recovery.recharge");
    expect(container.textContent).toContain("recovery.continue");
    expect(container.textContent).toContain("recovery.stop");
  });

  it("never reveals a later H5 Clip once an earlier Clip is already failed", async () => {
    const transient = batch();
    transient.status = "running";
    transient.itemCount = 2;
    transient.counts = {
      awaiting_confirmation: 0,
      ready: 0,
      dispatching: 0,
      submitted: 1,
      completed: 0,
      failed: 1,
      cancelled: 0,
    };
    transient.items = [
      {
        ...item("item-1", "clip-1", "failed", 0),
        targetKind: "storyboard_clip",
        sequenceId: "sequence-1",
        error: { code: "INSUFFICIENT_COMPUTE_POINTS", message: "No balance." },
      },
      {
        ...item("item-2", "clip-2", "submitted", 1),
        targetKind: "storyboard_clip",
        sequenceId: "sequence-1",
      },
    ];
    api.getBatch.mockResolvedValue(transient);
    api.listStoryboard.mockResolvedValue([
      {
        id: "sequence-1",
        title: "The awakening",
        clips: [
          storyboardClip("clip-1", "Opening image", "https://media.example/opening.jpg"),
          storyboardClip("clip-2", "Camera move", "https://media.example/move.jpg"),
        ],
      },
    ] as unknown as StoryStoryboardSequence[]);

    await renderTranscript(true);

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.querySelectorAll("[data-generation-item]")).toHaveLength(1)
      );
      await vi.waitFor(() => expect(container.textContent).toContain("Opening image"));
    });
    expect(container.textContent).toContain("Opening image");
    expect(container.textContent).not.toContain("Camera move");
    expect(container.textContent).not.toContain("mobileStoryboard.generating");
  });

  it("renders one H5 Storyboard card with its generated Clips and play action", async () => {
    const completed = batch();
    completed.status = "completed";
    completed.completedAt = "2026-08-26T12:00:00.000Z";
    completed.itemCount = 2;
    completed.counts = {
      awaiting_confirmation: 0,
      ready: 0,
      dispatching: 0,
      submitted: 0,
      completed: 2,
      failed: 0,
      cancelled: 0,
    };
    completed.items = [
      {
        ...item("item-1", "clip-1", "completed", 0),
        targetKind: "storyboard_clip",
        sequenceId: "sequence-1",
      },
      {
        ...item("item-2", "clip-2", "completed", 1),
        targetKind: "storyboard_clip",
        sequenceId: "sequence-1",
        outputKind: "video",
      },
    ];
    api.getBatch.mockResolvedValue(completed);
    api.listStoryboard.mockResolvedValue([
      {
        id: "sequence-1",
        title: "The awakening",
        clips: [
          storyboardClip("clip-1", "Opening image", "https://media.example/opening.jpg"),
          storyboardClip("clip-2", "Camera move", "https://media.example/move.mp4", "video"),
        ],
      },
    ] as unknown as StoryStoryboardSequence[]);

    await renderTranscript(true);

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.querySelectorAll("[data-storyboard-sequence]")).toHaveLength(1)
      );
      await vi.waitFor(() => expect(container.textContent).toContain("The awakening"));
    });
    expect(container.querySelectorAll("[data-generation-item]")).toHaveLength(2);
    expect(container.textContent).toContain("The awakening");
    expect(container.textContent).toContain("mobileStoryboard.play");
    expect(container.querySelector("a")?.getAttribute("href")).toContain("/playtest?chapter=");
  });
});

function storyboardClip(id: string, title: string, previewUrl: string, mediaKind = "image") {
  return {
    id,
    title,
    selectedMediaVersion: {
      previewUrl,
      thumbnailUrl: null,
      mediaKind,
      mimeType: mediaKind === "video" ? "video/mp4" : "image/jpeg",
    },
  };
}

function batch(): StoryGenerationBatch {
  return {
    id: "batch-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    status: "running",
    dispatchMode: "sequential",
    totalPoints: 180,
    availablePoints: null,
    itemCount: 3,
    version: 1,
    quoteExpiresAt: "2026-08-26T12:00:00.000Z",
    confirmedAt: "2026-08-26T11:45:00.000Z",
    completedAt: null,
    blockedAt: null,
    blockReason: null,
    canCancel: true,
    counts: {
      awaiting_confirmation: 0,
      ready: 1,
      dispatching: 0,
      submitted: 1,
      completed: 1,
      failed: 0,
      cancelled: 0,
    },
    items: [
      item("item-1", "asset-1", "completed", 0),
      item("item-2", "asset-2", "submitted", 1),
      item("item-3", "asset-3", "ready", 2),
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
    targetKind: "asset_spec",
    targetId,
    sequenceId: null,
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
