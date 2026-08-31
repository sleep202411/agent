// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FizzAgentSurface } from "./fizz-agent-surface";

const labels = {
  surface: "FizzAgent conversation",
  close: "Close",
  newConversation: "New chat",
  newConversationDialog: {
    title: "Start a new chat?",
    description: "The current chat remains in history.",
    cancel: "Cancel",
    confirm: "Start new chat",
  },
};

describe("FizzAgentSurface composer layout", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps the composer mounted directly below a pending decision", async () => {
    await act(async () => {
      root.render(
        <FizzAgentSurface
          open
          title="FizzAgent"
          labels={labels}
          composer={<textarea data-testid="composer" defaultValue="Keep this draft" />}
          composerAccessory={<section data-testid="decision">Approve this Plot Tree?</section>}
        >
          <div>Transcript</div>
        </FizzAgentSurface>
      );
    });

    const decision = host.querySelector<HTMLElement>("[data-testid='decision']");
    const composer = host.querySelector<HTMLTextAreaElement>("[data-testid='composer']");

    expect(decision?.textContent).toBe("Approve this Plot Tree?");
    expect(composer?.value).toBe("Keep this draft");
    expect(
      decision && composer
        ? decision.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0
    ).toBeTruthy();
  });
});
