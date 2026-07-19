// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GlitchText } from "./glitch-text";

describe("GlitchText", () => {
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

  it("keeps one accessible text copy and configures a hover-only monochrome effect", async () => {
    await act(async () => {
      root.render(
        <GlitchText speed={1.2} enableOnHover>
          Every choice rewrites the story
        </GlitchText>
      );
    });

    const text = container.querySelector(".react-bits-glitch-text") as HTMLSpanElement;
    const base = text.querySelector("[data-glitch-base]");
    const layers = text.querySelectorAll("[data-glitch-layer]");
    expect(base?.textContent).toBe("Every choice rewrites the story");
    expect(layers).toHaveLength(2);
    expect([...layers].every((layer) => layer.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(text.dataset.glitchTrigger).toBe("hover");
    expect(text.style.getPropertyValue("--glitch-after-duration")).toBe("3.6s");
    expect(text.style.getPropertyValue("--glitch-after-shadow")).toBe("none");
    expect(text.style.getPropertyValue("--glitch-before-shadow")).toBe("none");
  });
});
