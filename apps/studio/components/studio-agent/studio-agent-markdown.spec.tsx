// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StudioAgentMarkdown } from "./studio-agent-markdown";

describe("StudioAgentMarkdown", () => {
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

  it("renders GFM content and safe external links", async () => {
    await act(async () => {
      root.render(
        <StudioAgentMarkdown>{`## Story plan

| Path | Result |
| --- | --- |
| A | Continue |

[Reference](https://example.com)`}</StudioAgentMarkdown>
      );
    });

    expect(container.querySelector("h3")?.textContent).toBe("Story plan");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_blank");
    expect(container.querySelector("a")?.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("blocks raw HTML, remote images, and unsafe navigation protocols", async () => {
    await act(async () => {
      root.render(
        <StudioAgentMarkdown>{`<script>alert("xss")</script>

![tracking pixel](https://example.com/pixel.png)

[Unsafe](javascript:alert('xss'))`}</StudioAgentMarkdown>
      );
    });

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("Unsafe");
  });
});
