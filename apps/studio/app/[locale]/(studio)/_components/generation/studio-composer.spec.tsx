// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FizzAiModel } from "@/lib/canvas-authoring/generation-api";
import { StudioComposer } from "./studio-composer";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ requireAuth: (action: () => void) => action() }),
}));
vi.mock("@/lib/use-dismiss", () => ({ useDismiss: vi.fn() }));
vi.mock("@/components/ui/glass-rim", () => ({ GlassRim: () => null }));
vi.mock("@/components/canvas/authoring/model-picker", () => ({ ModelPicker: () => null }));
vi.mock("@/components/canvas/authoring/model-settings", () => ({
  hasRenderableModelSettings: () => false,
  ModelSettings: () => null,
}));
vi.mock("@/components/canvas/authoring/composer-quick-settings", () => ({
  ComposerQuickSettings: () => null,
}));
vi.mock("@/components/canvas/authoring/mode-menu", () => ({ ModeMenu: () => null }));
vi.mock("@/components/canvas/authoring/validation-alert-dialog", () => ({
  ValidationAlertDialog: () => null,
}));
vi.mock("./reference-fan", () => ({ ReferenceFan: () => null }));

describe("StudioComposer prompt policy", () => {
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

  it("uses the selected model's prompt limit instead of a fixed UI cap", async () => {
    const model: FizzAiModel = {
      id: "seedance-2.0",
      type: "video",
      name: "Seedance 2.0",
      enabled: true,
      schemaVersion: "1",
      input_schema: { properties: { prompt: { maxLength: 15_000 } } },
    };

    await act(async () => {
      root.render(
        <StudioComposer
          modality="video"
          catalog={undefined}
          prompt="A quiet garden"
          onPromptChange={vi.fn()}
          model={model}
          onSelectModel={vi.fn()}
          settings={{}}
          onSettingsChange={vi.fn()}
          referenceFields={[]}
          referenceItems={[]}
          onAddReferences={vi.fn()}
          onRemoveReference={vi.fn()}
          cost={null}
          canSubmit
          submitting={false}
          onSubmit={vi.fn()}
        />
      );
    });

    expect(container.querySelector("textarea")?.maxLength).toBe(15_000);
  });
});

describe("Home keyboard submission", () => {
  it.each([{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { shiftKey: true }])(
    "keeps composition, repeated keys and newlines in the prompt (%j)",
    async (options) => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      const submit = vi.fn();
      await act(async () =>
        root.render(
          <StudioComposer
            modality="image"
            catalog={undefined}
            prompt="测试 prompt"
            onPromptChange={vi.fn()}
            model={undefined}
            onSelectModel={vi.fn()}
            settings={{}}
            onSettingsChange={vi.fn()}
            referenceFields={[]}
            referenceItems={[]}
            onAddReferences={vi.fn()}
            onRemoveReference={vi.fn()}
            cost={null}
            canSubmit
            submitting={false}
            onSubmit={submit}
            submitOnEnter
            docked={false}
          />
        )
      );
      const textarea = host.querySelector("textarea")!;
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
            ...options,
          })
        )
      );
      expect(submit).not.toHaveBeenCalled();
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
        )
      );
      expect(submit).toHaveBeenCalledTimes(1);
      await act(async () => root.unmount());
      host.remove();
    }
  );
});
