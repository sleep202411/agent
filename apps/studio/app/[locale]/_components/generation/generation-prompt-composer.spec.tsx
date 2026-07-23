// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationPromptComposer } from "./generation-prompt-composer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/canvas-authoring/use-labels", () => ({
  useModeLabel: () => (mode: string) => mode,
}));

vi.mock("@/lib/use-dismiss", () => ({
  useDismiss: vi.fn(),
}));

vi.mock("@/components/canvas/authoring/prompt-textarea", () => ({
  PromptTextarea: ({
    "aria-label": ariaLabel,
    onCommit,
    value,
  }: {
    "aria-label"?: string;
    onCommit: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onCommit(event.currentTarget.value)}
    />
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
