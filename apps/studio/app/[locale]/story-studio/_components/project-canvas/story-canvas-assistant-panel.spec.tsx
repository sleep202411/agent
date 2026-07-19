// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryCanvasAssistantPanel } from "./story-canvas-assistant-panel";
import type { StoryAgentRunController } from "./use-story-agent-run";
import type { StoryCanvasAssistantSession } from "./use-story-canvas-assistant-session";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

vi.mock("@/components/copilot/copilot-transcript", () => ({
  CopilotTranscript: () => <div role="log" />,
}));

vi.mock("./story-agent-run-card", () => ({
  StoryAgentRunCard: () => null,
  StoryAgentRunSummaryCard: () => null,
  storyAgentRunFromToolPart: () => null,
}));

describe("Story Canvas assistant panel", () => {
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

  it("hands keyboard focus to the composer when the launcher opens the panel", async () => {
    const props = {
      onClose: vi.fn(),
      session: sessionFixture(),
      agentRunController: controllerFixture(),
      canManageAgentRuns: true,
    };

    await render(<StoryCanvasAssistantPanel {...props} open={false} />);
    expect(container.querySelector("textarea")).toBeNull();

    await render(<StoryCanvasAssistantPanel {...props} open />);

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
  });

  it("lets the creator discard a preserved message from its notice", async () => {
    const session = sessionFixture({
      recoveredMessage: {
        id: "0198c1de-9d33-7c66-a06f-3f3ffe1f3b39",
        role: "user",
        parts: [{ type: "text", text: "Preserved instruction" }],
      },
    });

    await render(
      <StoryCanvasAssistantPanel
        open
        onClose={vi.fn()}
        session={session}
        agentRunController={controllerFixture()}
        canManageAgentRuns
      />
    );

    expect(container.textContent).toContain("messagePreserved");
    const discard = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "discardPreservedMessage"
    );
    expect(discard).not.toBeUndefined();

    await act(async () => {
      discard?.click();
      await Promise.resolve();
    });

    expect(session.discardRecoveredMessage).toHaveBeenCalledTimes(1);
  });

  it("renders a localized quota notice instead of the raw 429 JSON body", async () => {
    const rawBody = JSON.stringify({
      code: 429,
      error: "quota_exceeded",
      dimension: "chat",
      limit: 30,
      resetAt: "2026-07-19T15:00:00.000Z",
    });
    const session = sessionFixture({
      error: new Error(rawBody),
      errorMessage: rawBody,
      errorQuota: {
        kind: "quota_exceeded",
        dimension: "chat",
        limit: 30,
        resetAt: "2026-07-19T15:00:00.000Z",
      },
      history: {
        status: "ready",
        conversationStatus: "failed",
        error: null,
        resetting: false,
        retry: vi.fn(),
      },
    });

    await render(
      <StoryCanvasAssistantPanel
        open
        onClose={vi.fn()}
        session={session}
        agentRunController={controllerFixture()}
        canManageAgentRuns
      />
    );

    expect(container.textContent).toContain("quotaExceeded");
    expect(container.textContent).not.toContain(rawBody);
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "retry"
    );
    expect(retry).not.toBeUndefined();
  });

  async function render(element: React.ReactNode) {
    await act(async () => {
      root.render(element);
      await Promise.resolve();
    });
  }
});

function sessionFixture(overrides: Record<string, unknown> = {}): StoryCanvasAssistantSession {
  return {
    draft: "",
    setDraft: vi.fn(),
    selectedSkillKey: null,
    setSelectedSkillKey: vi.fn(),
    messages: [],
    status: "ready",
    error: null,
    errorMessage: null,
    errorAction: null,
    errorQuota: null,
    recoveredMessage: null,
    recoveryReady: true,
    recoveryStorageError: false,
    busy: false,
    attachment: null,
    attachmentError: null,
    attachmentUploading: false,
    attachDocument: vi.fn(() => true),
    removeAttachment: vi.fn(),
    submit: vi.fn(async () => true),
    stop: vi.fn(),
    regenerate: vi.fn(async () => true),
    retryRecoveredMessage: vi.fn(async () => true),
    discardRecoveredMessage: vi.fn(),
    startNewConversation: vi.fn(async () => true),
    history: {
      status: "ready",
      conversationStatus: "ready",
      error: null,
      resetting: false,
      retry: vi.fn(),
    },
    ...overrides,
  } as unknown as StoryCanvasAssistantSession;
}

function controllerFixture(): StoryAgentRunController {
  return {
    run: null,
    undoableRun: null,
    applying: false,
  } as StoryAgentRunController;
}
