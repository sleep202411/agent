// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAgentSurface } from "./studio-agent-surface";

const labels = {
  surface: "Agent surface",
  close: "Close",
  newConversation: "New conversation",
  newConversationDialog: {
    title: "Start a new conversation?",
    description: "This clears the current conversation.",
    cancel: "Keep conversation",
    confirm: "Clear and start new",
  },
};

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

  it("docks as an in-flow column beside the canvas instead of overlaying it", async () => {
    await act(async () => {
      root.render(
        <div data-testid="workspace" style={{ display: "flex", width: 900 }}>
          <main data-testid="canvas" style={{ flex: 1 }} />
          <StudioAgentSurface open title="StoryOS" labels={labels} onOpenChange={vi.fn()}>
            <div>timeline</div>
          </StudioAgentSurface>
        </div>
      );
    });

    const canvas = container.querySelector<HTMLElement>('[data-testid="canvas"]');
    const surface = container.querySelector<HTMLElement>('[data-slot="studio-agent-surface"]');

    // Siblings in one flex row: the canvas shrinks beside the panel, and the
    // panel never floats above it. An absolutely positioned surface would sit
    // OVER the canvas, hiding whatever is underneath — the rejected layout.
    expect(surface?.parentElement).toBe(canvas?.parentElement);
    expect(surface?.classList.contains("absolute")).toBe(false);
    expect(surface?.classList.contains("shrink-0")).toBe(true);

    // The column owns a clamped width — never a viewport-covering overlay.
    const aside = surface?.querySelector("aside");
    expect(aside?.getAttribute("aria-label")).toBe(labels.surface);
    expect(aside?.className).toContain("w-[clamp(360px,30vw,460px)]");
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
    expect(onNewConversation).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(labels.newConversationDialog.description);

    const confirm = document.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-action"]');
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

  it("keeps the title stable while busy and only guards conversation reset", async () => {
    await act(async () => {
      root.render(
        <StudioAgentSurface
          open
          busy
          title="StoryOS"
          labels={labels}
          onNewConversation={vi.fn()}
          onOpenChange={vi.fn()}
        >
          <div>timeline</div>
        </StudioAgentSurface>
      );
    });

    expect(container.querySelector("header .animate-spin")).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(`[aria-label="${labels.newConversation}"]`)
        ?.disabled
    ).toBe(true);
  });

  it("renders nothing when closed", async () => {
    await act(async () => {
      root.render(
        <StudioAgentSurface open={false} title="StoryOS" labels={labels} onOpenChange={vi.fn()}>
          <div>timeline</div>
        </StudioAgentSurface>
      );
    });

    expect(container.querySelector('[data-slot="studio-agent-surface"]')).toBeNull();
  });
});
