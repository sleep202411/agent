// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAgentSurface } from "./studio-agent-surface";

const labels = { surface: "Agent surface", close: "Close", newConversation: "New conversation" };

describe("StudioAgentSurface", () => {
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

  it("renders as an absolute overlay that never participates in canvas layout", async () => {
    await act(async () => {
      root.render(
        <div data-testid="workspace" style={{ display: "grid", width: 900 }}>
          <main data-testid="canvas" style={{ width: "100%" }} />
          <StudioAgentSurface open title="StoryOS" labels={labels} onOpenChange={vi.fn()}>
            <div>timeline</div>
          </StudioAgentSurface>
        </div>
      );
    });

    const canvas = container.querySelector<HTMLElement>('[data-testid="canvas"]');
    const overlay = container.querySelector<HTMLElement>('[data-slot="studio-agent-overlay"]');

    // Opening the assistant must not resize the sibling canvas.
    expect(canvas?.style.width).toBe("100%");
    expect(overlay?.dataset.layout).toBe("overlay");
    expect(overlay?.classList.contains("absolute")).toBe(true);
    expect(overlay?.classList.contains("inset-0")).toBe(true);
  });

  it("renders the title and closes via onOpenChange", async () => {
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        <StudioAgentSurface open title="StoryOS" labels={labels} onOpenChange={onOpenChange}>
          <div>timeline</div>
        </StudioAgentSurface>
      );
    });

    expect(container.querySelector("h2")?.textContent).toBe("StoryOS");

    const close = container.querySelector<HTMLButtonElement>(`[aria-label="${labels.close}"]`);
    expect(close).not.toBeNull();
    await act(async () => {
      close?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * "New conversation" is destructive-looking but recoverable, and it is the
   * creator's only way out of a thread whose turn is wedged — so it has to be
   * reachable from the header, not buried, and it must not appear before there
   * is a thread to retire.
   */
  it("offers a new conversation, and hides it when there is nothing to retire", async () => {
    const onNewConversation = vi.fn();
    await act(async () => {
      root.render(
        <StudioAgentSurface
          open
          title="StoryOS"
          labels={labels}
          onNewConversation={onNewConversation}
          onOpenChange={vi.fn()}
        >
          <div>timeline</div>
        </StudioAgentSurface>
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      `[aria-label="${labels.newConversation}"]`
    );
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNewConversation).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <StudioAgentSurface open title="StoryOS" labels={labels} onOpenChange={vi.fn()}>
          <div>timeline</div>
        </StudioAgentSurface>
      );
    });
    expect(container.querySelector(`[aria-label="${labels.newConversation}"]`)).toBeNull();
  });

  it("renders nothing when closed", async () => {
    await act(async () => {
      root.render(
        <StudioAgentSurface open={false} title="StoryOS" labels={labels} onOpenChange={vi.fn()}>
          <div>timeline</div>
        </StudioAgentSurface>
      );
    });

    expect(container.querySelector('[data-slot="studio-agent-overlay"]')).toBeNull();
  });
});
