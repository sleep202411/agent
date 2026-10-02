// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { PlaySessionReporter } from "@repo/experience-engine";
import { usePlaySessionReporter } from "./use-play-session-reporter";

it("retains controller input identity and sends each session to its original reporter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  let stable!: PlaySessionReporter;
  function Harness({ reporter }: { reporter?: PlaySessionReporter }) {
    const value = usePlaySessionReporter(reporter);
    useLayoutEffect(() => {
      stable = value;
    });
    return null;
  }
  const first = {
    onStart: vi.fn().mockResolvedValue({ sessionId: "one" }),
    onProgress: vi.fn(),
    onComplete: vi.fn(),
  };
  const second = {
    onStart: vi.fn().mockResolvedValue({ sessionId: "two" }),
    onProgress: vi.fn(),
    onComplete: vi.fn(),
  };
  try {
    act(() => root.render(<Harness reporter={first} />));
    const original = stable;
    await stable.onStart({ gameId: "game" });
    act(() => root.render(<Harness reporter={second} />));
    expect(stable).toBe(original);
    await stable.onStart({ gameId: "game" });
    await stable.onProgress("one", { currentNode: "later-node" });
    await stable.onComplete("two", { endingId: "end" });
    expect(first.onProgress).toHaveBeenCalledWith("one", { currentNode: "later-node" });
    expect(second.onProgress).not.toHaveBeenCalled();
    expect(second.onComplete).toHaveBeenCalledWith("two", { endingId: "end" });
    act(() => root.render(<Harness />));
    expect(stable).toBe(original);
    await expect(stable.onStart({ gameId: "game" })).resolves.toBeNull();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
