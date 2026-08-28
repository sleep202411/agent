// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryAssetSpec } from "@/lib/story-production-api";
import { StoryAssetSpecCard } from "./story-asset-spec-card";

const mocks = vi.hoisted(() => ({
  addCandidate: vi.fn(),
  patchAsset: vi.fn(),
  refreshCandidates: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/media-upload", () => ({
  uploadFileViaSignedUrl: mocks.upload,
}));

vi.mock("@/lib/story-projects-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/story-projects-api")>()),
  addStoryCandidateAsset: mocks.addCandidate,
}));

vi.mock("@/lib/story-production-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/story-production-api")>()),
  createStoryProductionIdempotencyKey: () => "idempotency-key",
  patchStoryAssetSpec: mocks.patchAsset,
}));

vi.mock("./project-canvas/use-story-candidate-assets", () => ({
  useStoryCandidateAssets: () => ({
    items: [],
    candidateIds: new Set(),
    pendingIds: new Set(),
    loading: false,
    failed: false,
    error: null,
    canEdit: true,
    toggle: vi.fn(),
    remove: vi.fn(),
    refresh: mocks.refreshCandidates,
  }),
}));

vi.mock("./story-asset-spec-detail-dialog", () => ({
  StoryAssetSpecDetailDialog: () => null,
}));

vi.mock("./story-production-generation-control", () => ({
  StoryProductionGenerationControl: ({ secondaryAction }: { secondaryAction?: ReactNode }) => (
    <div>{secondaryAction}</div>
  ),
}));

describe("StoryAssetSpecCard media replacement", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.addCandidate.mockReset();
    mocks.patchAsset.mockReset();
    mocks.refreshCandidates.mockReset();
    mocks.upload.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("uploads and replaces media directly from the card", async () => {
    const asset = assetSpec();
    const candidate = {
      asset: {
        id: "media-2",
        kind: "image" as const,
        status: "ready" as const,
        moderationStatus: "unreviewed" as const,
        contentType: "image/png",
        width: 1600,
        height: 900,
        durationSeconds: null,
        checksumSha256: "checksum",
        previewUrl: "https://media.example/replacement.png",
      },
      videoVariant: null,
      addedByUserId: "creator-1",
      addedAt: "2026-08-28T00:00:00.000Z",
    };
    mocks.upload.mockImplementation(
      async (_file: File, options: { onProgress?: (progress: number) => void }) => {
        options.onProgress?.(100);
        return {
          mediaAssetId: candidate.asset.id,
          variantId: "variant-2",
          storageKey: "story/replacement.png",
          url: candidate.asset.previewUrl,
        };
      }
    );
    mocks.addCandidate.mockResolvedValue(candidate);
    mocks.refreshCandidates.mockResolvedValue(undefined);
    mocks.patchAsset.mockResolvedValue({
      ...asset,
      version: 2,
      selectedMediaVersionId: "asset-media-version-2",
      selectedMediaVersion: {
        id: "asset-media-version-2",
        mediaAssetId: candidate.asset.id,
      },
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryAssetSpecCard
            asset={asset}
            projectId="project-1"
            chapterId="chapter-1"
            workspaceId="workspace-1"
          />
        </QueryClientProvider>
      );
    });

    const uploadImage = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "uploadImage"
    );
    expect(uploadImage).toBeDefined();
    await act(async () => uploadImage?.click());

    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["replacement"], "replacement.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(() => expect(mocks.patchAsset).toHaveBeenCalledTimes(1));
    expect(mocks.upload).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        kind: "ai_reference_image",
        workspaceId: "workspace-1",
        scope: { projectId: "project-1" },
      })
    );
    expect(mocks.addCandidate).toHaveBeenCalledWith("project-1", candidate.asset.id);
    expect(mocks.refreshCandidates).toHaveBeenCalledTimes(1);
    expect(mocks.patchAsset).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      asset.id,
      "idempotency-key",
      {
        expectedVersion: asset.version,
        sourceMediaAssetId: candidate.asset.id,
      }
    );
  });
});

function assetSpec(): StoryAssetSpec {
  return {
    id: "asset-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    stableKey: "location.gate",
    kind: "location",
    sourceCharacterId: null,
    sourceNodeIds: ["plot-1"],
    name: "City gate",
    description: "A stone gate at night",
    imagePrompt: "A cinematic stone gate at night",
    videoPrompt: null,
    negativePrompt: null,
    generationConfig: {},
    sourceFingerprint: "source-asset-1",
    status: "current",
    planDisposition: "planned",
    pendingSourceFingerprint: null,
    conflict: null,
    version: 1,
    selectedMediaVersionId: null,
    selectedMediaVersion: null,
    mediaVersions: [],
    latestGeneration: null,
    userModifiedAt: null,
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}
