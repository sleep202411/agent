// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FizzAiCatalog, FizzAiModel } from "@/lib/canvas-authoring/generation-api";
import { ModelPicker } from "./model-picker";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    (
      ({
        "modelPicker.allModels": "All models",
        "modelPicker.allVendors": "All vendors",
        "modelPicker.featuredModels": "Popular",
        "modelPicker.filterByVendor": "Filter by vendor",
        "modelPicker.noModels": "No models",
        "modelPicker.otherVendor": "Other",
        "modelPicker.searchPlaceholder": "Search models",
        "modelPicker.searchResults": "Search results",
        "modelPicker.signInToLoad": "Sign in to load models",
        "modelPicker.taglines.stableMotionVideo": "Makes stable motion videos",
        "modelPicker.vendor": "Vendor",
      }) as Record<string, string>
    )[key] ?? key,
}));

const catalog: FizzAiCatalog = {
  models: [
    videoModel({ id: "veo-3-1", name: "Veo 3.1", vendor: "Google", family: "veo" }),
    videoModel({
      id: "minimax-h3",
      name: "MiniMax H3",
      vendor: "MiniMax",
      family: "hailuo",
    }),
  ],
};

describe("ModelPicker vendor discovery", () => {
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

  it("shows the canonical vendor beside every model", async () => {
    await renderPicker(root);

    expect(modelRow(container, "Veo 3.1")?.textContent).toContain("Google");
    expect(modelRow(container, "MiniMax H3")?.textContent).toContain("MiniMax");
  });

  it("filters the visible catalog by vendor", async () => {
    await renderPicker(root);

    const trigger = requiredElement(
      container.querySelector<HTMLButtonElement>('[aria-label="Filter by vendor"]')
    );
    await act(async () => trigger.click());

    const popover = requiredElement(container.querySelector<HTMLElement>("[data-vendor-menu]"));
    const google = Array.from(popover.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Google"
    );
    await act(async () => requiredElement(google).click());

    expect(modelRow(container, "Veo 3.1")).not.toBeNull();
    expect(modelRow(container, "MiniMax H3")).toBeNull();
  });

  it("finds models by vendor as well as model name", async () => {
    await renderPicker(root);

    const search = requiredElement(
      container.querySelector<HTMLInputElement>('input[placeholder="Search models"]')
    );
    await act(async () => {
      setInputValue(search, "google");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(modelRow(container, "Veo 3.1")).not.toBeNull();
    expect(modelRow(container, "MiniMax H3")).toBeNull();
  });
});

async function renderPicker(root: Root) {
  await act(async () => {
    root.render(
      <ModelPicker catalog={catalog} modality="video" onClose={vi.fn()} onSelect={vi.fn()} />
    );
  });
}

function videoModel(fields: Pick<FizzAiModel, "id" | "name" | "vendor" | "family">): FizzAiModel {
  return {
    ...fields,
    type: "video",
    enabled: true,
    schemaVersion: "1",
    input_schema: { type: "object", properties: {} },
  };
}

function modelRow(container: HTMLElement, name: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes(name)
    ) ?? null
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

function requiredElement<T extends Element>(element: T | null | undefined): T {
  if (!element) throw new Error("Missing required element.");
  return element;
}
