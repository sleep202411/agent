// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotScopeLifecycle } from "./use-copilot-scope-lifecycle";

describe("useCopilotScopeLifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("reactivates the session after the StrictMode effect rehearsal", async () => {
    let isActive = () => false;
    const activeStatesAtDisposal: boolean[] = [];
    const dispose = vi.fn(() => {
      activeStatesAtDisposal.push(isActive());
    });

    function Harness() {
      const activeRef = useCopilotScopeLifecycle(dispose);
      isActive = () => activeRef.current;
      return null;
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>
      );
    });

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(isActive()).toBe(true);

    await act(async () => root.unmount());
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(isActive()).toBe(false);
    expect(activeStatesAtDisposal).toEqual([false, false]);
  });
});
