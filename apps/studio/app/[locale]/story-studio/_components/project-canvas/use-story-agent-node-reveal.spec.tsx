// @vitest-environment jsdom

import { act, useRef, type EffectCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { StoryAgentRunDto } from "@repo/shared/story-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryAgentNodeReveal } from "./use-story-agent-node-reveal";
import { storyAgentRunFixture } from "./story-agent-run.test-fixtures";

const animation = vi.hoisted(() => ({
  registerPlugin: vi.fn(),
  fromTo: vi.fn(),
  set: vi.fn(),
  revert: vi.fn(),
  matchMedia: vi.fn(),
}));

vi.mock("@gsap/react", async () => {
  const { useEffect } = await import("react");
  return {
    useGSAP: (callback: EffectCallback) => useEffect(() => callback()),
  };
});

vi.mock("gsap", () => ({
  default: {
    registerPlugin: animation.registerPlugin,
    fromTo: animation.fromTo,
    set: animation.set,
    matchMedia: animation.matchMedia,
  },
}));

function Harness({
  run,
  draftRevision,
  layoutRevision,
  projectionReconciled,
  renderedNodeCount,
  renderedNodeIds = [
    "clip:new",
    "__decision__:clip:new",
    "clip:changed",
    "__ending__:truth",
    "clip:untouched",
  ],
}: {
  run: StoryAgentRunDto | null;
  draftRevision: number;
  layoutRevision: number | null;
  projectionReconciled: boolean;
  renderedNodeCount: number;
  renderedNodeIds?: string[];
}) {
  const scopeRef = useRef<HTMLDivElement>(null);
  useStoryAgentNodeReveal({
    run,
    draftRevision,
    layoutRevision,
    projectionReconciled,
    renderedNodeCount,
    scopeRef,
  });
  return (
    <div ref={scopeRef}>
      {renderedNodeIds.map((nodeId) => (
        <article key={nodeId} data-story-node-id={nodeId} />
      ))}
    </div>
  );
}

describe("useStoryAgentNodeReveal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    animation.fromTo.mockReset();
    animation.set.mockReset();
    animation.revert.mockReset();
    animation.matchMedia.mockReset().mockImplementation(() => ({
      add(query: string, callback: () => void) {
        if (query === "(prefers-reduced-motion: no-preference)") callback();
      },
      revert: animation.revert,
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("waits for both committed projections, includes late-created nodes, and never replays one run", async () => {
    const now = new Date().toISOString();
    const run = storyAgentRunFixture("succeeded", {
      affectedNodeIds: ["clip:new", "clip:changed", "truth"],
      createdNodeIds: ["clip:new", "truth"],
      revealStartedAt: now,
      completedAt: now,
      updatedAt: now,
    });

    await render(
      <Harness
        run={run}
        draftRevision={8}
        layoutRevision={5}
        projectionReconciled={false}
        renderedNodeCount={1}
      />
    );
    expect(animation.fromTo).not.toHaveBeenCalled();

    await render(
      <Harness
        run={run}
        draftRevision={9}
        layoutRevision={5}
        projectionReconciled={false}
        renderedNodeCount={1}
        renderedNodeIds={["clip:changed"]}
      />
    );
    expect(animation.fromTo).not.toHaveBeenCalled();

    await render(
      <Harness
        run={run}
        draftRevision={9}
        layoutRevision={6}
        projectionReconciled={false}
        renderedNodeCount={1}
        renderedNodeIds={["clip:changed"]}
      />
    );
    expect(animation.fromTo).not.toHaveBeenCalled();

    await render(
      <Harness
        run={run}
        draftRevision={9}
        layoutRevision={6}
        projectionReconciled
        renderedNodeCount={5}
      />
    );
    expect(animation.fromTo).toHaveBeenCalledTimes(2);
    expect(nodeIds(animation.fromTo.mock.calls[0]?.[0])).toEqual([
      "clip:new",
      "__decision__:clip:new",
      "__ending__:truth",
    ]);
    expect(nodeIds(animation.fromTo.mock.calls[1]?.[0])).toEqual(["clip:changed"]);
    expect(animation.fromTo.mock.calls.flatMap((call) => nodeIds(call[0]))).not.toContain(
      "clip:untouched"
    );

    await render(
      <Harness
        run={run}
        draftRevision={9}
        layoutRevision={6}
        projectionReconciled
        renderedNodeCount={6}
      />
    );
    expect(animation.fromTo).toHaveBeenCalledTimes(2);
  });

  it("reveals graph projections restored by undo while treating surviving projections as changed", async () => {
    const now = new Date().toISOString();
    const run = storyAgentRunFixture("succeeded", {
      kind: "undo",
      affectedNodeIds: ["clip:new", "clip:changed", "truth"],
      createdNodeIds: ["clip:new"],
      revealStartedAt: now,
      completedAt: now,
      updatedAt: now,
    });

    await render(
      <Harness
        run={run}
        draftRevision={9}
        layoutRevision={6}
        projectionReconciled
        renderedNodeCount={5}
      />
    );

    expect(animation.fromTo).toHaveBeenCalledTimes(2);
    expect(nodeIds(animation.fromTo.mock.calls[0]?.[0])).toEqual([
      "clip:new",
      "__decision__:clip:new",
    ]);
    expect(nodeIds(animation.fromTo.mock.calls[1]?.[0])).toEqual([
      "clip:changed",
      "__ending__:truth",
    ]);
  });

  it("does not replay a terminal run restored from old history", async () => {
    const old = new Date(Date.now() - 31_000).toISOString();
    const run = storyAgentRunFixture("succeeded", {
      affectedNodeIds: ["clip:new"],
      createdNodeIds: ["clip:new"],
      revealStartedAt: old,
      completedAt: old,
      updatedAt: old,
    });

    await render(
      <Harness
        run={run}
        draftRevision={9}
        layoutRevision={6}
        projectionReconciled
        renderedNodeCount={5}
      />
    );

    expect(animation.matchMedia).not.toHaveBeenCalled();
    expect(animation.fromTo).not.toHaveBeenCalled();
  });

  async function render(element: React.ReactNode) {
    await act(async () => {
      root.render(element);
      await Promise.resolve();
    });
  }
});

function nodeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        item instanceof HTMLElement && item.dataset.storyNodeId ? [item.dataset.storyNodeId] : []
      )
    : [];
}
