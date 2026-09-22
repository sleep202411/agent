// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FizzAiModel } from "@/lib/canvas-authoring/generation-api";
import { GenerationPromptComposer } from "./generation-prompt-composer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/canvas-authoring/use-labels", () => ({
  useModeLabel: () => (mode: string) => mode,
  useOmniTaskTypeLabel: () => (value: string) => value,
  useComposerModeLabel:
    () =>
    (mode: string): string =>
      mode.split("::").pop() ?? mode,
}));

vi.mock("@/lib/use-dismiss", () => ({
  useDismiss: vi.fn(),
}));

vi.mock("@/components/canvas/authoring/prompt-textarea", () => ({
  PromptTextarea: ({
    "aria-label": ariaLabel,
    mentions,
    onMentionActivate,
    onCommit,
    value,
    maxLength,
  }: {
    "aria-label"?: string;
    mentions?: Array<{ id: string; kind: "image" | "video" | "audio" | "skill"; label: string }>;
    onMentionActivate?: (mention: {
      id: string;
      kind: "image" | "video" | "audio" | "skill";
      label: string;
    }) => void;
    onCommit: (value: string) => void;
    value: string;
    maxLength?: number;
  }) => (
    <div>
      <textarea
        aria-label={ariaLabel}
        data-prompt-max-length={maxLength}
        value={value}
        onChange={(event) => onCommit(event.currentTarget.value)}
      />
      {mentions?.map((mention) => (
        <button key={mention.id} type="button" onClick={() => onMentionActivate?.(mention)}>
          {mention.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/canvas/authoring/composer-quick-settings", () => ({
  ComposerQuickSettings: () => null,
}));

vi.mock("@/components/canvas/authoring/mode-menu", () => ({
  ModeMenu: () => null,
}));

vi.mock("@/components/canvas/authoring/model-picker", () => ({
  ModelPicker: () => null,
}));

vi.mock("@/components/canvas/authoring/model-settings", () => ({
  hasRenderableModelSettings: () => false,
  ModelSettings: () => null,
}));

function props(
  overrides: Partial<ComponentProps<typeof GenerationPromptComposer>> = {}
): ComponentProps<typeof GenerationPromptComposer> {
  return {
    ariaLabel: "Generate",
    modality: "image",
    catalog: undefined,
    model: undefined,
    modelPickerEnabled: false,
    prompt: "A quiet garden",
    onPromptCommit: vi.fn(),
    promptAriaLabel: "Prompt",
    settings: {},
    settingsEnabled: false,
    panel: null,
    onPanelChange: vi.fn(),
    onQuickSettingsOpenChange: vi.fn(),
    cost: 60,
    canSubmit: true,
    submitting: false,
    onSubmit: vi.fn(),
    submitLabel: "Generate",
    ...overrides,
  };
}

describe("GenerationPromptComposer presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0);
    globalThis.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("switches between compact and expanded presentation without writing canvas data", async () => {
    const onPromptCommit = vi.fn();
    const onSettingsChange = vi.fn();

    await act(async () => {
      root.render(<GenerationPromptComposer {...props({ onPromptCommit, onSettingsChange })} />);
    });

    expect(document.querySelector('[data-generation-composer="compact"]')).not.toBeNull();

    const expand = document.querySelector<HTMLButtonElement>(
      'button[aria-label="expandedComposer.expand"]'
    );
    await act(async () => {
      expand?.click();
    });

    expect(document.querySelector('[data-generation-composer="compact"]')).toBeNull();
    expect(document.querySelector('[data-generation-composer="expanded"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(onPromptCommit).not.toHaveBeenCalled();
    expect(onSettingsChange).not.toHaveBeenCalled();

    const collapse = document.querySelector<HTMLButtonElement>(
      'button[aria-label="expandedComposer.collapse"]'
    );
    await act(async () => {
      collapse?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-generation-composer="expanded"]')).toBeNull();
    expect(document.querySelector('[data-generation-composer="compact"]')).not.toBeNull();
  });

  it("keeps the prompt value continuous across presentation changes", async () => {
    await act(async () => {
      root.render(<GenerationPromptComposer {...props()} />);
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="expandedComposer.expand"]')
        ?.click();
    });

    expect(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')?.value
    ).toBe("A quiet garden");
  });

  it("passes the selected model prompt limit to the editor", async () => {
    const model: FizzAiModel = {
      id: "seedance-2.0",
      type: "video",
      name: "Seedance 2.0",
      enabled: true,
      schemaVersion: "1",
      input_schema: { properties: { prompt: { maxLength: 15_000 } } },
    };

    await act(async () => {
      root.render(<GenerationPromptComposer {...props({ model })} />);
    });

    expect(document.querySelector("textarea")?.dataset.promptMaxLength).toBe("15000");
  });

  it("renders an active Skill as an actionable inline prompt entity", async () => {
    const onMentionActivate = vi.fn();
    const skill = {
      id: "skill-classic-cel",
      kind: "skill" as const,
      label: "Classic Cel Animation",
    };
    await act(async () => {
      root.render(
        <GenerationPromptComposer
          {...props({
            mentions: [skill],
            onMentionActivate,
            prompt: "A rainy pursuit /Classic Cel Animation",
          })}
        />
      );
    });

    const prompt = document.querySelector('textarea[aria-label="Prompt"]');
    const skillButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Classic Cel Animation"
    );
    const toolbar = document.querySelector('button[aria-label="Generate"]');

    expect(prompt?.compareDocumentPosition(skillButton as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(skillButton?.compareDocumentPosition(toolbar as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );

    await act(async () => skillButton?.click());
    expect(onMentionActivate).toHaveBeenCalledWith(skill);
  });

  it("places the Skill picker in a dedicated action row above the prompt", async () => {
    await act(async () => {
      root.render(
        <GenerationPromptComposer
          {...props({
            skillMarketOptions: [],
          })}
        />
      );
    });

    const actionRow = document.querySelector('[data-composer-action-row=""]');
    const skillPicker = document.querySelector<HTMLButtonElement>(
      'button[aria-label="chooseSkill"]'
    );
    const prompt = document.querySelector('textarea[aria-label="Prompt"]');

    expect(actionRow).not.toBeNull();
    expect(skillPicker).not.toBeNull();
    expect(skillPicker?.compareDocumentPosition(prompt as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("places generation mode after the selected model", async () => {
    await act(async () => {
      root.render(
        <GenerationPromptComposer
          {...props({
            modelPickerEnabled: true,
            modelFallbackLabel: "MiniMax H3",
            onSelectModel: vi.fn(),
            mode: "all-round",
            modes: ["all-round", "start-end"],
            onSelectMode: vi.fn(),
          })}
        />
      );
    });

    const modelButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("MiniMax H3")
    );
    const modeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("all-round")
    );

    expect(modelButton).toBeDefined();
    expect(modeButton).toBeDefined();
    expect(modelButton?.compareDocumentPosition(modeButton as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("returns to the compact composer when Escape closes the expanded layer", async () => {
    await act(async () => {
      root.render(<GenerationPromptComposer {...props()} />);
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="expandedComposer.expand"]')
        ?.click();
    });

    await act(async () => {
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })
        );
      await Promise.resolve();
    });

    expect(document.querySelector('[data-generation-composer="expanded"]')).toBeNull();
    expect(document.querySelector('[data-generation-composer="compact"]')).not.toBeNull();
  });

  it("closes a nested settings layer before dismissing the expanded composer", async () => {
    const onPanelChange = vi.fn();
    await act(async () => {
      root.render(<GenerationPromptComposer {...props({ panel: "model", onPanelChange })} />);
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="expandedComposer.expand"]')
        ?.click();
    });
    onPanelChange.mockClear();

    await act(async () => {
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })
        );
      await Promise.resolve();
    });

    expect(onPanelChange).toHaveBeenCalledWith(null);
    expect(document.querySelector('[data-generation-composer="expanded"]')).not.toBeNull();
  });
});
