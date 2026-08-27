// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";

describe("Button", () => {
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

  const button = () => container.querySelector("button")!;

  it("defaults native type to 'button' — never submits an enclosing form by accident", async () => {
    await act(async () => root.render(<Button>Go</Button>));
    expect(button().getAttribute("type")).toBe("button");
  });

  it("honors an explicit type", async () => {
    await act(async () => root.render(<Button type="submit">Go</Button>));
    expect(button().getAttribute("type")).toBe("submit");
  });

  it("fires onClick when idle", async () => {
    const onClick = vi.fn();
    await act(async () => root.render(<Button onClick={onClick}>Go</Button>));
    await act(async () => button().click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("while loading: shows a spinner, marks aria-busy, and blocks activation", async () => {
    const onClick = vi.fn();
    await act(async () =>
      root.render(
        <Button loading onClick={onClick}>
          Go
        </Button>
      )
    );
    const el = button();
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(el.getAttribute("data-loading")).toBe("true");
    expect(el.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
    // A loading button stays focusable (busy, not disabled), so the guard — not
    // the native attribute — is what must swallow the activation.
    expect(el.disabled).toBe(false);
    await act(async () => el.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("while disabled: is natively disabled and blocks activation", async () => {
    const onClick = vi.fn();
    await act(async () =>
      root.render(
        <Button disabled onClick={onClick}>
          Go
        </Button>
      )
    );
    const el = button();
    expect(el.disabled).toBe(true);
    await act(async () => el.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("an icon-only button swaps its glyph for the spinner while loading", async () => {
    await act(async () =>
      root.render(
        <Button size="icon" loading aria-label="refresh">
          <svg data-glyph="true" />
        </Button>
      )
    );
    const el = button();
    expect(el.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
    expect(el.querySelector('[data-glyph="true"]')).toBeNull();
  });

  it("block stretches to full width", async () => {
    await act(async () => root.render(<Button block>Go</Button>));
    expect(button().className).toContain("w-full");
  });

  it("asChild renders the child element and does not force a button type onto it", async () => {
    await act(async () =>
      root.render(
        <Button asChild>
          <a href="https://example.com/x">Link</a>
        </Button>
      )
    );
    const anchor = container.querySelector("a")!;
    expect(anchor).not.toBeNull();
    expect(anchor.getAttribute("type")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});
