// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en-US.json";
import { createStudioAgentEventState } from "@/lib/studio-agent";

import { StoryCanvasAssistantLayer } from "./story-canvas-assistant-layer";

const useStoryStudioAgent = vi.hoisted(() => vi.fn());

vi.mock("./use-story-studio-agent", () => ({
  useStoryStudioAgent,
}));

describe("StoryCanvasAssistantLayer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useStoryStudioAgent.mockReturnValue(createSession());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps the runtime mounted while closed and overlays the canvas when opened", async () => {
    await render(false);

    expect(container.querySelector('[data-testid="story-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="studio-agent-overlay"]')).toBeNull();
    expect(useStoryStudioAgent).toHaveBeenCalledWith({
      projectId: "project-1",
      chapterId: "chapter-1",
      workspaceId: "workspace-1",
    });

    await render(true);

    const canvas = container.querySelector<HTMLElement>('[data-testid="story-canvas"]');
    const overlay = container.querySelector<HTMLElement>('[data-slot="studio-agent-overlay"]');
    expect(canvas?.style.width).toBe("100%");
    expect(overlay?.classList.contains("absolute")).toBe(true);
    expect(overlay?.classList.contains("inset-0")).toBe(true);
  });

  it("wires the load-earlier control to the session", async () => {
    const loadEarlierTurns = vi.fn().mockResolvedValue(undefined);
    useStoryStudioAgent.mockReturnValue(createSession({ hasEarlierTurns: true, loadEarlierTurns }));

    await render(true);

    // Asserting the click, not just the prop: a type-valid mis-wire such as
    // `loading: session.submitting` renders identically.
    const button = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Load earlier turns"
    );
    expect(button).toBeDefined();
    expect(button?.hasAttribute("disabled")).toBe(false);
    await act(async () => button?.click());
    expect(loadEarlierTurns).toHaveBeenCalledTimes(1);
  });

  it("hides the load-earlier control when the window covers the whole thread", async () => {
    useStoryStudioAgent.mockReturnValue(createSession({ hasEarlierTurns: false }));

    await render(true);

    expect(
      [...container.querySelectorAll("button")].some(
        (node) => node.textContent === "Load earlier turns"
      )
    ).toBe(false);
  });

  async function render(
    open: boolean,
    { onOpenChange = vi.fn() }: { onOpenChange?: (open: boolean) => void } = {}
  ) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <StoryCanvasAssistantLayer
            projectId="project-1"
            chapterId="chapter-1"
            workspaceId="workspace-1"
            open={open}
            onOpenChange={onOpenChange}
          >
            <main data-testid="story-canvas" style={{ width: "100%" }} />
          </StoryCanvasAssistantLayer>
        </NextIntlClientProvider>
      );
    });
  }
});

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    error: null,
    streamStatus: "connected",
    streamError: null,
    commandError: null,
    thread: null,
    eventState: createStudioAgentEventState("pending:test"),
    activeRun: null,
    isRunning: false,
    queuedCount: 0,
    submitting: false,
    cancelling: false,
    policyUpdating: false,
    resolvingApprovalIds: new Set(),
    hasEarlierTurns: false,
    loadingEarlierTurns: false,
    loadEarlierTurns: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn(),
    clearCommandError: vi.fn(),
    submit: vi.fn(),
    uploadAttachment: vi.fn(),
    cancelActiveRun: vi.fn(),
    updatePermissionMode: vi.fn(),
    resolveApproval: vi.fn(),
    ...overrides,
  };
}
