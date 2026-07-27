// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CopilotMarkdown } from "./copilot-markdown";

describe("CopilotMarkdown", () => {
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

  it("renders GFM structure and safe external links", async () => {
    await act(async () => {
      root.render(
        <CopilotMarkdown>{`## Story plan

**Promise**

- First beat
- Second beat

| Path | Result |
| --- | --- |
| A | Continue |

[Reference](https://example.com)`}</CopilotMarkdown>
      );
    });

    expect(container.querySelector("h3")?.textContent).toBe("Story plan");
    expect(container.querySelector("strong")?.textContent).toBe("Promise");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_blank");
    expect(container.querySelector("a")?.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("does not render raw HTML or remote images", async () => {
    await act(async () => {
      root.render(
        <CopilotMarkdown>{`<script>alert("xss")</script>\n\n![tracking pixel](https://example.com/pixel.png)`}</CopilotMarkdown>
      );
    });

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not create navigable links for unsafe protocols", async () => {
    await act(async () => {
      root.render(
        <CopilotMarkdown>{`[Javascript](javascript:alert('xss')) [Data](data:text/html,xss) [Protocol relative](//example.com)`}</CopilotMarkdown>
      );
    });

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("Javascript");
    expect(container.textContent).toContain("Data");
    expect(container.textContent).toContain("Protocol relative");
  });
});
