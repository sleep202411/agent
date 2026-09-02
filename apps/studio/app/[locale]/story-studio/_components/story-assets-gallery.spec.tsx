// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryAssetsGallery } from "./story-assets-gallery";

const queryState = vi.hoisted(() => ({
  assets: [] as Array<{
    id: string;
    version: number;
    kind: "character" | "location" | "prop";
    status: "current" | "stale";
    conflict: null;
    pendingSourceFingerprint: null;
  }>,
  production: {
    projectId: "project-1",
    chapterId: "chapter-1",
    profile: { status: "current" },
    script: { status: "current", documentId: "document-1", sequence: 1 },
    plotTree: { status: "current", nodeCount: 1 },
    assets: { status: "current", currentCount: 1, staleCount: 0 },
    storyboard: {
      status: "current",
      sequenceCount: 0,
      staleCount: 0,
      missingPlotNodeIds: [],
    },
    ready: true,
  },
}));

const navigationState = vi.hoisted(() => ({ kind: "character" }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`kind=${navigationState.kind}`),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data:
      queryKey[1] === "asset-specs"
        ? queryState.assets
        : queryKey[1] === "chapter-workbench"
          ? {
              project: {
                workspaceId: "workspace-1",
                capabilities: ["story.edit"],
              },
            }
          : queryState.production,
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/story-studio/projects/project-1/assets",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("./story-production-page-header", () => ({
  StoryProductionPageHeader: () => null,
}));

vi.mock("./story-asset-spec-card", () => ({
  StoryAssetSpecCard: ({ asset }: { asset: { kind: string } }) => <div>{asset.kind}</div>,
}));

vi.mock("./story-asset-batch-generation", () => ({
  StoryAssetBatchGeneration: ({ assets }: { assets: Array<{ id: string }> }) => (
    <output data-testid="batch-count">{assets.length}</output>
  ),
}));

vi.mock("./story-stage-empty-state", () => ({
  StoryStageEmptyState: ({ title, description }: { title: string; description: string }) => (
    <section data-testid="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  ),
  StoryStageNotice: () => null,
}));

describe("StoryAssetsGallery empty states", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    queryState.assets = [];
    navigationState.kind = "character";
    queryState.production.plotTree = { status: "current", nodeCount: 1 };
    queryState.production.assets = { status: "current", currentCount: 1, staleCount: 0 };
    useStoryProjectUiStore.setState({ activeChapterId: "chapter-1" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("uses a category-level empty state when the chapter has assets in another category", async () => {
    queryState.assets = [
      {
        id: "location-1",
        version: 1,
        kind: "location",
        status: "current",
        conflict: null,
        pendingSourceFingerprint: null,
      },
    ];

    await renderGallery();

    expect(container.textContent).toContain("categoryEmpty.character");
    expect(container.textContent).toContain("categoryEmptyHint");
    expect(container.textContent).not.toContain("stage.noAssets.title");
  });

  it("keeps manual asset creation available when the approved plan has no Asset Specs", async () => {
    queryState.production.assets.currentCount = 0;

    await renderGallery();

    expect(container.textContent).toContain("categoryEmpty.character");
    expect(container.textContent).toContain("addByKind.character");
    expect(container.textContent).not.toContain("stage.noAssets.title");
  });

  it("keeps manual asset controls available before Plot approval", async () => {
    queryState.production.plotTree.status = "missing";
    queryState.production.assets = { status: "missing", currentCount: 0, staleCount: 0 };

    await renderGallery();

    expect(container.textContent).toContain("addByKind.character");
    expect(container.textContent).toContain("tabs.character");
    expect(container.textContent).toContain("categoryEmpty.character");
  });

  it.each([
    ["en-US", enUS.storyStudio.assetsPage],
    ["zh-CN", zhCN.storyStudio.assetsPage],
    ["zh-HK", zhHK.storyStudio.assetsPage],
  ])("provides every category-level empty message in %s", (_locale, messages) => {
    expect(messages.categoryEmpty.character).toBeTruthy();
    expect(messages.categoryEmpty.location).toBeTruthy();
    expect(messages.categoryEmpty.prop).toBeTruthy();
    expect(messages.categoryEmptyHint).toBeTruthy();
  });

  it("batches only current-tab assets that still need media", async () => {
    queryState.assets = [
      ...makeAssets("character", 3, 1, 1),
      ...makeAssets("location", 4),
      ...makeAssets("prop", 3),
    ];

    await renderGallery();
    expect(batchCount()).toBe("1");

    navigationState.kind = "location";
    await renderGallery();
    expect(batchCount()).toBe("4");

    navigationState.kind = "prop";
    await renderGallery();
    expect(batchCount()).toBe("3");
  });

  async function renderGallery() {
    await act(async () => {
      root.render(<StoryAssetsGallery projectId="project-1" />);
    });
  }

  function batchCount() {
    return container.querySelector('[data-testid="batch-count"]')?.textContent;
  }
});

function makeAssets(
  kind: "character" | "location" | "prop",
  count: number,
  generatedCount = 0,
  inFlightCount = 0
) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${index + 1}`,
    version: 1,
    kind,
    status: "current" as const,
    conflict: null,
    pendingSourceFingerprint: null,
    selectedMediaVersion: index < generatedCount ? {} : null,
    latestGeneration:
      index >= generatedCount && index < generatedCount + inFlightCount
        ? {
            aiJob: { status: "in_progress" },
            materialization: { status: "waiting_for_job" },
          }
        : null,
  }));
}
