// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasBackdrop } from "./canvas-backdrop";

describe("CanvasBackdrop", () => {
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

  it("renders a fixed screen-space dot field from the shared canvas tokens", async () => {
    await act(async () => root.render(<CanvasBackdrop />));

    const backdrop = container.querySelector<HTMLElement>('[data-slot="canvas-backdrop"]');
    expect(backdrop).not.toBeNull();
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.className).toContain("absolute");
    expect(backdrop?.className).toContain("inset-0");
    expect(backdrop?.className).toContain("pointer-events-none");
    expect(backdrop?.style.backgroundColor).toBe("var(--canvas-background)");
    expect(backdrop?.style.backgroundImage).toContain("var(--canvas-dot-color)");
    expect(backdrop?.style.backgroundSize).toBe(
      "var(--canvas-dot-spacing) var(--canvas-dot-spacing)"
    );
  });
});
