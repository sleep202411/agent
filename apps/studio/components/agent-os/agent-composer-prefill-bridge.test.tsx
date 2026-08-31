// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentComposerPrefillBridge } from "./agent-composer-prefill-bridge";

describe("AgentComposerPrefillBridge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("applies a prefill while a decision and the composer remain mounted", async () => {
    const onPrefill = vi.fn();
    const onConsumed = vi.fn();
    const request = { id: 7, text: "Prepare Asset Specs for review." };

    await act(async () => {
      root.render(
        <>
          <div data-agent-composer-gate="approval">Approval required</div>
          <AgentComposerPrefillBridge
            request={request}
            onPrefill={onPrefill}
            onConsumed={onConsumed}
          />
          <textarea aria-label="Message" />
        </>
      );
    });

    expect(onPrefill).toHaveBeenCalledOnce();
    expect(onPrefill).toHaveBeenCalledWith(request.text);
    expect(onConsumed).toHaveBeenCalledWith(request.id);
  });
});
