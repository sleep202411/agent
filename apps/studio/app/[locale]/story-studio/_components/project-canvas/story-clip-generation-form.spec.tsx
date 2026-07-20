// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FizzAiCatalog, FizzAiModel } from "@/app/[locale]/canvas/_lib/generation-api";
import type { StoryVideoGenerationRecipeInput } from "@/lib/story-projects-api";
import { StoryClipGenerationForm } from "./story-clip-generation-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const catalogValue: { data: FizzAiCatalog | undefined } = { data: undefined };
vi.mock("@/app/[locale]/canvas/_lib/use-ai-catalog", () => ({
  useAiCatalog: () => catalogValue,
}));

function videoModel(id: string, generationModes: string[]): FizzAiModel {
  return {
    id,
    type: "video",
    name: id,
    enabled: true,
    schemaVersion: "1",
    generationModes,
    input_schema: {
      properties: { durationSeconds: { type: "number", enum: [5, 10], default: 5 } },
    },
  } as unknown as FizzAiModel;
}

const BOTH_MODEL = videoModel("both", ["multimodal_to_video", "first_last_frame_to_video"]);
const SINGLE_MODEL = videoModel("single", ["multimodal_to_video"]);

function recipe(
  overrides: Partial<StoryVideoGenerationRecipeInput> = {}
): StoryVideoGenerationRecipeInput {
  return {
    prompt: "A quiet street at dawn.",
    modelId: BOTH_MODEL.id,
    mode: "multimodal_to_video",
    durationMs: 5_000,
    references: [{ referenceVersionId: "ref-1", role: "reference" }],
    ...overrides,
  };
}

function baseProps(
  overrides: Partial<ComponentProps<typeof StoryClipGenerationForm>> = {}
): ComponentProps<typeof StoryClipGenerationForm> {
  return {
    target: null,
    recipe: recipe(),
    references: [],
    frameProfile: null,
    readOnly: false,
    canGenerate: true,
    disabledReason: null,
    pendingKey: null,
    error: null,
    onRecipeChange: vi.fn(),
    onGenerate: vi.fn(),
    ...overrides,
  };
}

function radios(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

describe("StoryClipGenerationForm multi-mode", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    catalogValue.data = { models: [BOTH_MODEL, SINGLE_MODEL] };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("renders a mode toggle for a model that drives both story modes", async () => {
    await act(async () => {
      root.render(<StoryClipGenerationForm {...baseProps()} />);
    });
    expect(radios(container)).toHaveLength(2);
  });

  it("hides the toggle for a single-mode model", async () => {
    await act(async () => {
      root.render(
        <StoryClipGenerationForm {...baseProps({ recipe: recipe({ modelId: SINGLE_MODEL.id }) })} />
      );
    });
    expect(radios(container)).toHaveLength(0);
  });

  it("switches mode and drops references that no longer fit", async () => {
    const onRecipeChange = vi.fn();
    await act(async () => {
      root.render(<StoryClipGenerationForm {...baseProps({ onRecipeChange })} />);
    });

    const [, firstLast] = radios(container);
    await act(async () => {
      firstLast!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onRecipeChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "first_last_frame_to_video", references: [] })
    );
  });

  it("shows the free-form upload control only when an upload context is provided", async () => {
    const uploadLabel = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].some((button) =>
        (button.textContent ?? "").includes("action")
      );

    await act(async () => {
      root.render(<StoryClipGenerationForm {...baseProps()} />);
    });
    expect(uploadLabel()).toBe(false);

    await act(async () => {
      root.render(
        <StoryClipGenerationForm
          {...baseProps({
            referenceUpload: { workspaceId: "w", projectId: "p", refresh: vi.fn() },
          })}
        />
      );
    });
    expect(uploadLabel()).toBe(true);
  });
});
