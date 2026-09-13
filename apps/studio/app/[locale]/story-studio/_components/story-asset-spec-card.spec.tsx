// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storyProductionKeys, type StoryAssetSpec } from "@/lib/story-production-api";
import { StoryAssetSpecCard } from "./story-asset-spec-card";

const mocks = vi.hoisted(() => ({ patch: vi.fn(), prepared: vi.fn() }));

vi.mock("@/lib/story-production-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/story-production-api")>()),
  patchStoryAssetSpec: mocks.patch,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./story-prompt-composer", () => ({
  useStoryAssetMentions: () => [],
  StoryPromptComposer: ({
    id,
    value,
    onChange,
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
  }) => <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} />,
}));

vi.mock("./story-asset-generation-toolbar", () => ({
  StoryAssetGenerationToolbar: ({
    children,
  }: {
    children: (settings: { selection: null; options: Record<string, never> }) => ReactNode;
  }) => children({ selection: null, options: {} }),
}));

vi.mock("./story-production-generation-control", () => ({
  StoryProductionGenerationControl: ({
    purpose = "primary",
    allowGeneration,
    generationDisabledReason,
    submitGeneration,
  }: {
    purpose?: string;
    allowGeneration?: boolean;
    generationDisabledReason?: string;
    submitGeneration: (submit: (version: number) => Promise<unknown>) => Promise<unknown>;
  }) =>
    allowGeneration ? (
      <button
        type="button"
        disabled={Boolean(generationDisabledReason)}
        title={generationDisabledReason}
        onClick={() => {
          void submitGeneration(async (version) => mocks.prepared(version));
        }}
      >
        generate:{purpose}
      </button>
    ) : null,
}));

describe("StoryAssetSpecCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  it("saves an edited prompt once before concurrent generations and reuses the persisted version", async () => {
    const asset = assetSpec();
    const client = new QueryClient();
    client.setQueryData(storyProductionKeys.assets("project-1", "chapter-1"), [asset]);
    let finishSave!: (value: StoryAssetSpec) => void;
    mocks.patch.mockReturnValue(
      new Promise<StoryAssetSpec>((resolve) => {
        finishSave = resolve;
      })
    );
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryAssetSpecCard asset={asset} projectId="project-1" chapterId="chapter-1" />
        </QueryClientProvider>
      );
    });
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        "A small kitten"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const generate = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "generate:primary"
    )!;
    expect(generate.disabled).toBe(false);
    expect(container.querySelector('button[aria-label="save"]')).toBeNull();
    await act(async () => {
      generate.click();
      generate.click();
    });
    expect(mocks.patch).toHaveBeenCalledOnce();
    expect(mocks.patch).toHaveBeenCalledWith(
      "project-1",
      "chapter-1",
      "asset-1",
      expect.any(String),
      {
        expectedVersion: 1,
        name: "Hero",
        imagePrompt: "A small kitten",
      }
    );
    expect(mocks.prepared).not.toHaveBeenCalled();
    await act(async () => {
      finishSave({ ...asset, imagePrompt: "A small kitten", version: 2 });
    });
    expect(mocks.prepared.mock.calls).toEqual([[2], [2]]);
    // Even before the parent projection rerenders, the cache holds the saved version.
    await act(async () => {
      generate.click();
    });
    expect(mocks.patch).toHaveBeenCalledOnce();
    expect(mocks.prepared).toHaveBeenLastCalledWith(2);
    client.clear();
  });

  it("keeps the three-view action visible but disabled until a character image exists", async () => {
    const client = new QueryClient();
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <StoryAssetSpecCard asset={assetSpec()} projectId="project-1" chapterId="chapter-1" />
        </QueryClientProvider>
      );
    });
    const generate = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "generate:turnaround"
    );
    expect(generate?.disabled).toBe(true);
    expect(generate?.title).toBe("turnaroundNeedsPrimary");
    client.clear();
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
      expect(container.querySelector('button[aria-label="save"]')).toBeNull();
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
