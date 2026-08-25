// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotComposer } from "./copilot-composer";

describe("CopilotComposer committed operation controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("does not offer Stop while a committed external operation is applying", async () => {
    await act(async () => {
      root.render(
        <CopilotComposer
          value=""
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onStop={vi.fn()}
          busy
          stopAvailable={false}
          placeholder="Message"
          inputLabel="Message"
          sendLabel="Send"
          stopLabel="Stop"
        />
      );
    });

    expect(container.querySelector('button[aria-label="Stop"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Send"]')).toBeNull();
  });

  it("focuses the textarea for a new host prefill request", async () => {
    await act(async () => {
      root.render(
        <CopilotComposer
          value="Prepare the next stage"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onStop={vi.fn()}
          busy={false}
          focusRequestKey={1}
          placeholder="Message"
          inputLabel="Message"
          sendLabel="Send"
          stopLabel="Stop"
        />
      );
    });

    expect(document.activeElement).toBe(
      container.querySelector('textarea[data-agent-composer-input="true"]')
    );
  });
});
