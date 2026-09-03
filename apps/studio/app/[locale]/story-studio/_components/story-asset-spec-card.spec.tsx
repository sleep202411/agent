// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryAssetSpec } from "@/lib/story-production-api";
import { StoryAssetSpecCard } from "./story-asset-spec-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./story-prompt-composer", () => ({
  useStoryAssetMentions: () => [],
  StoryPromptComposer: ({ id, value }: { id: string; value: string }) => (
    <textarea id={id} value={value} readOnly />
  ),
}));

vi.mock("./story-asset-generation-toolbar", () => ({
  StoryAssetGenerationToolbar: ({
    children,
  }: {
    children: (settings: { selection: null; options: Record<string, never> }) => ReactNode;
  }) => children({ selection: null, options: {} }),
}));

vi.mock("./story-production-generation-control", () => ({
  StoryProductionGenerationControl: ({ purpose = "primary" }: { purpose?: string }) => (
    <button type="button">generate:{purpose}</button>
  ),
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

  it.each(["character", "location", "prop"] as const)(
    "renders the appropriate %s asset workbench",
    async (kind) => {
      const client = new QueryClient();
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <StoryAssetSpecCard
              asset={assetSpec({ kind })}
              projectId="project-1"
              chapterId="chapter-1"
              workspaceId="workspace-1"
            />
          </QueryClientProvider>
        );
      });

      const text = container.textContent ?? "";
      const article = container.querySelector("article");
      expect(container.querySelector<HTMLInputElement>('input[value="Hero"]')?.value).toBe("Hero");
      expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        "A consistent red flight suit"
      );
      expect(text).toContain("generate:primary");
      if (kind === "character") {
        expect(text).toContain("turnaroundTitle");
      } else {
        expect(article?.className).toContain("h-full");
        expect(article?.className).not.toContain("lg:grid-cols-2");
      }
      expect(container.querySelectorAll("article > section")).toHaveLength(
        kind === "character" ? 2 : 1
      );
      expect(text).not.toContain("Lead character");
      expect(text).not.toContain("advancedSettings");
      const uploadButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="uploadImage"]'
      );
      expect(uploadButton).not.toBeNull();
      expect(uploadButton?.className).toContain(kind === "character" ? "size-24" : "aspect-video");
      expect(container.querySelectorAll("textarea")).toHaveLength(1);
      expect(container.querySelectorAll('section[aria-label="Hero"]')).toHaveLength(1);
      expect(container.querySelector('button[aria-label="delete"]')).not.toBeNull();
      expect(text.includes("generate:turnaround")).toBe(kind === "character");
    }
  );
});

function assetSpec(overrides: Partial<StoryAssetSpec> = {}): StoryAssetSpec {
  return {
    ...baseAssetSpec(),
    ...overrides,
  };
}

function baseAssetSpec(): StoryAssetSpec {
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
    version: 1,
    selectedMediaVersionId: null,
    selectedMediaVersion: null,
    mediaVersions: [],
    latestGeneration: null,
    userModifiedAt: null,
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}
