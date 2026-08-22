// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StoryAssetSpec,
  StoryProductionState,
  StoryStoryboardSequence,
} from "@/lib/story-production-api";
import { StoryProductionConflictPanel } from "./story-production-conflict-panel";

const apiMocks = vi.hoisted(() => ({
  resolveAsset: vi.fn(),
  resolveSequence: vi.fn(),
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
    resolveStoryAssetSpecConflict: apiMocks.resolveAsset,
    resolveStoryStoryboardSequenceConflict: apiMocks.resolveSequence,
  };
});

describe("StoryProductionConflictPanel", () => {
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

  it("shows the pending Asset plan and resolves Keep current with both CAS values", async () => {
    const asset = staleAsset();
    const resolved = { ...asset, status: "current" as const, conflict: null };
    apiMocks.resolveAsset.mockResolvedValue({
      targetKind: "asset_spec",
      targetId: asset.id,
      resolution: "keep_current",
      outcome: "kept_current",
      item: resolved,
      productionState: productionState(),
    });
    client.setQueryData(
      ["story-studio", "asset-specs", "workspace-1", "project-1", "chapter-1"],
      [asset]
    );
    await renderPanel({ kind: "asset_spec", item: asset });

    expect(container.textContent).toContain("latestAsset:Latest Hero,character");
    await act(async () => button("keepCurrent", container)?.click());
    await act(async () => {
      const confirm = button("confirmKeep", document.body);
      confirm?.click();
      confirm?.click();
    });

    await vi.waitFor(() => expect(apiMocks.resolveAsset).toHaveBeenCalledTimes(1));
    expect(apiMocks.resolveAsset).toHaveBeenCalledWith(
      "workspace-1",
      "project-1",
      "chapter-1",
      "asset-1",
      expect.stringMatching(/^story-conflict-resolution:/),
      {
        expectedVersion: 4,
        expectedPendingSourceFingerprint: FINGERPRINT,
        resolution: "keep_current",
      }
    );
    expect(
      client.getQueryData<StoryAssetSpec[]>([
        "story-studio",
        "asset-specs",
        "workspace-1",
        "project-1",
        "chapter-1",
      ])?.[0]?.status
    ).toBe("current");
    expect(
      client.getQueryData<StoryProductionState>([
        "story-studio",
        "production-state",
        "workspace-1",
        "project-1",
        "chapter-1",
      ])?.ready
    ).toBe(true);
  });

  it("does not offer an unsupported Keep current command for a removed Plot sequence", async () => {
    const sequence = staleSequence(true);
    await renderPanel({ kind: "storyboard_sequence", item: sequence });

    expect(button("keepCurrent", container)?.disabled).toBe(true);
    expect(container.textContent).toContain("removedSequenceCannotKeep");
    expect(container.textContent).toContain("sequenceRemovalSummary");
    expect(apiMocks.resolveSequence).not.toHaveBeenCalled();
  });

  it("blocks resolution when a stale Server DTO has not exposed its conflict metadata yet", async () => {
    const asset = {
      ...staleAsset(),
      pendingSourceFingerprint: null,
      conflict: null,
    };
    await renderPanel({ kind: "asset_spec", item: asset });

    expect(container.textContent).toContain("metadataUnavailable");
    expect(button("keepCurrent", container)).toBeNull();
    expect(button("useLatestPlan", container)).toBeNull();
    expect(apiMocks.resolveAsset).not.toHaveBeenCalled();
  });

  async function renderPanel(
    target:
      | { kind: "asset_spec"; item: StoryAssetSpec }
      | { kind: "storyboard_sequence"; item: StoryStoryboardSequence }
  ) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryProductionConflictPanel
            scope={{
              workspaceId: "workspace-1",
              projectId: "project-1",
              chapterId: "chapter-1",
            }}
            target={target}
          />
        </QueryClientProvider>
      );
    });
  }
});

const FINGERPRINT = "a".repeat(64);

function button(label: string, root: ParentNode): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === label
    ) ?? null
  );
}

function staleAsset(): StoryAssetSpec {
  return {
    id: "asset-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    stableKey: "hero",
    kind: "character",
    sourceCharacterId: "hero",
    sourceNodeIds: ["plot-1"],
    name: "Hero",
    description: "Current hero",
    imagePrompt: "Current red suit",
    videoPrompt: null,
    negativePrompt: null,
    generationConfig: {},
    sourceFingerprint: "source-asset-1",
    status: "stale",
    planDisposition: "user_override",
    pendingSourceFingerprint: FINGERPRINT,
    conflict: {
      pendingSourceFingerprint: FINGERPRINT,
      pendingPlanFingerprint: "b".repeat(64),
      removed: false,
      pendingItem: {
        stableKey: "hero",
        kind: "character",
        sourceCharacterId: "hero",
        sourceNodeIds: ["plot-1"],
        name: "Latest Hero",
        description: "Latest approved hero",
        imagePrompt: "Latest blue suit",
      },
    },
    version: 4,
    selectedMediaVersionId: null,
    selectedMediaVersion: null,
    mediaVersions: [],
    latestGeneration: null,
    userModifiedAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

function staleSequence(removed: boolean): StoryStoryboardSequence {
  return {
    id: "sequence-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    plotNodeId: "plot-1",
    stableKey: "plot-1",
    title: "Current opening",
    description: null,
    suggestedDurationMs: 4_000,
    durationMs: 4_000,
    sourceFingerprint: "source-sequence-1",
    status: "stale",
    planDisposition: "user_override",
    pendingSourceFingerprint: FINGERPRINT,
    conflict: {
      pendingSourceFingerprint: FINGERPRINT,
      pendingPlanFingerprint: "b".repeat(64),
      removed,
      pendingItem: removed
        ? null
        : {
            plotNodeId: "plot-1",
            title: "Latest opening",
            description: "Latest opening footage.",
            durationMs: 5_000,
            clips: [
              {
                stableKey: "shot-1",
                title: "Opening",
                description: "Wide shot",
                kind: "image",
                startMs: 0,
                durationMs: 5_000,
                imagePrompt: "Wide view",
              },
            ],
            cues: [],
          },
    },
    version: 2,
    userModifiedAt: "2026-08-21T00:00:00.000Z",
    clips: [],
    cues: [],
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

function productionState(): StoryProductionState {
  return {
    projectId: "project-1",
    chapterId: "chapter-1",
    profile: { status: "current" },
    script: { status: "current", documentId: "script-1", sequence: 1 },
    plotTree: { status: "current", nodeCount: 1 },
    assets: { status: "current", currentCount: 1, staleCount: 0 },
    storyboard: {
      status: "current",
      sequenceCount: 1,
      staleCount: 0,
      missingPlotNodeIds: [],
    },
    ready: true,
  };
}
