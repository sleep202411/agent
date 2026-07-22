// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryCanvasAssistantLayer } from "./story-canvas-assistant-layer";
import type { StoryAgentRunController } from "./use-story-agent-run";
import type { StoryCanvasAssistantSession } from "./use-story-canvas-assistant-session";

const sessionState = vi.hoisted(() => ({
  current: null as unknown as StoryCanvasAssistantSession,
}));

const panelLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("./use-story-canvas-assistant-session", () => ({
  useStoryCanvasAssistantSession: () => sessionState.current,
}));

vi.mock("./story-canvas-agent-launcher", () => ({
  StoryCanvasAgentLauncher: () => <div data-launcher />,
}));

vi.mock("./story-canvas-assistant-panel", async () => {
  const { useEffect } = await import("react");
  return {
    StoryCanvasAssistantPanel: ({ open }: { open: boolean }) => {
      useEffect(() => {
        panelLifecycle.mounts += 1;
        return () => {
          panelLifecycle.unmounts += 1;
        };
      }, []);
      return <div data-panel data-open={String(open)} />;
    },
  };
});

describe("Story Canvas assistant layer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    sessionState.current = sessionFixture(null);
    panelLifecycle.mounts = 0;
    panelLifecycle.unmounts = 0;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderLayer(
    open: boolean,
    onOpenChange: (open: boolean) => void,
    showProjectLauncher = false
  ) {
    await act(async () => {
      root.render(
        <StoryCanvasAssistantLayer
          projectId="0198c1de-9d33-7c66-a06f-3f3ffe1f3b30"
          chapterId="0198c1de-9d33-7c66-a06f-3f3ffe1f3b32"
          workspaceId="0198c1de-9d33-7c66-a06f-3f3ffe1f3b31"
          showProjectLauncher={showProjectLauncher}
          open={open}
          onOpenChange={onOpenChange}
          agentRunController={{ applying: false } as StoryAgentRunController}
          canManageAgentRuns
        />
      );
      await Promise.resolve();
    });
  }

  it("auto-opens exactly once per recovered message so the panel stays closable", async () => {
    const onOpenChange = vi.fn();
    sessionState.current = sessionFixture(recoveredMessage("m-1"));

    await renderLayer(false, onOpenChange);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    // The parent honors the request, then the creator closes the panel while
    // the same recovered message is still preserved.
    await renderLayer(true, onOpenChange);
    await renderLayer(false, onOpenChange);
    expect(onOpenChange).toHaveBeenCalledTimes(1);

    // A distinct recovered message earns one fresh auto-open.
    sessionState.current = sessionFixture(recoveredMessage("m-2"));
    await renderLayer(false, onOpenChange);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("never re-opens on close when the message was recovered while already open", async () => {
    const onOpenChange = vi.fn();
    sessionState.current = sessionFixture(recoveredMessage("m-1"));

    await renderLayer(true, onOpenChange);
    expect(onOpenChange).not.toHaveBeenCalled();

    await renderLayer(false, onOpenChange);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not open the panel without a recovered message", async () => {
    const onOpenChange = vi.fn();

    await renderLayer(false, onOpenChange);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the welcome launcher only for project bootstrap", async () => {
    const onOpenChange = vi.fn();

    await renderLayer(false, onOpenChange, true);
    expect(container.querySelector("[data-launcher]")).not.toBeNull();

    await renderLayer(false, onOpenChange, false);
    expect(container.querySelector("[data-launcher]")).toBeNull();
  });

  // Regression: an in-flight chat stream lives in this layer's session, and
  // the docked-column layout must toggle `open` purely via props — never by
  // unmounting the layer subtree.
  it("keeps the layer subtree mounted across open -> close -> open", async () => {
    const onOpenChange = vi.fn();

    await renderLayer(true, onOpenChange);
    await renderLayer(false, onOpenChange);
    await renderLayer(true, onOpenChange);

    expect(panelLifecycle.mounts).toBe(1);
    expect(panelLifecycle.unmounts).toBe(0);
    expect(container.querySelector("[data-panel]")?.getAttribute("data-open")).toBe("true");
  });
});

function recoveredMessage(id: string) {
  return { id, role: "user" as const, parts: [{ type: "text" as const, text: "Preserved" }] };
}

function sessionFixture(
  recovered: ReturnType<typeof recoveredMessage> | null
): StoryCanvasAssistantSession {
  return {
    recoveredMessage: recovered,
    history: { status: "ready", conversationStatus: "ready" },
  } as unknown as StoryCanvasAssistantSession;
}
