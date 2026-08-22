// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryAssetSpec } from "@/lib/story-production-api";
import { StoryAssetSpecCard } from "./story-asset-spec-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("StoryAssetSpecCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps a zero-media logical spec visible and @referenceable", async () => {
    const client = new QueryClient();
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryAssetSpecCard
            asset={assetSpec()}
            workspaceId="workspace-1"
            projectId="project-1"
            chapterId="chapter-1"
          />
        </QueryClientProvider>
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("@hero");
    expect(text).toContain("generate");
    expect(container.querySelector("article")).not.toBeNull();
    // The prompt is carried by an always-editable textarea, not display text.
    const prompt = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(prompt?.value).toContain("A consistent red flight suit");
  });
});

function assetSpec(): StoryAssetSpec {
  return {
    id: "asset-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    stableKey: "hero",
    kind: "character",
    sourceCharacterId: "character-1",
    sourceNodeIds: ["plot-1"],
    name: "Hero",
    description: "Lead character",
    imagePrompt: "A consistent red flight suit",
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
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}
