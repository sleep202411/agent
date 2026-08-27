// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScrollArea } from "./scroll-area";

describe("ScrollArea viewport accessibility", () => {
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

  it("forwards an accessible name and keyboard focus to the real scroll viewport", async () => {
    await act(async () => {
      root.render(
        <ScrollArea viewportProps={{ tabIndex: 0, "aria-label": "Proposal review" }}>
          <p>Review body</p>
        </ScrollArea>
      );
    });

    const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    expect(viewport?.getAttribute("aria-label")).toBe("Proposal review");
    expect(viewport?.tabIndex).toBe(0);

    viewport?.focus();
    expect(document.activeElement).toBe(viewport);
  });
});
