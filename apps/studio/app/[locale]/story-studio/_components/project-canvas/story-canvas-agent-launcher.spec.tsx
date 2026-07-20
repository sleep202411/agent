// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryCanvasAgentLauncher } from "./story-canvas-agent-launcher";
import type { StoryCanvasAssistantSession } from "./use-story-canvas-assistant-session";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

describe("Story Canvas agent launcher", () => {
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

  it("stays a starter surface and opens the full assistant only after an accepted submit", async () => {
    const submit = vi.fn(() => true);
    const onOpenAssistant = vi.fn();
    const session = {
      draft: "A story idea",
      setDraft: vi.fn(),
      selectedSkillKey: null,
      setSelectedSkillKey: vi.fn(),
      history: {
        status: "ready",
        conversationStatus: "ready",
        error: null,
        retry: vi.fn(),
      },
      recoveryReady: true,
      recoveryStorageError: false,
      busy: false,
      stop: vi.fn(),
      submit,
    } as unknown as StoryCanvasAssistantSession;

    await act(async () => {
      root.render(<StoryCanvasAgentLauncher session={session} onOpenAssistant={onOpenAssistant} />);
    });

    expect(container.querySelector('[role="log"]')).toBeNull();
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(2);
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(onOpenAssistant).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["failed", "responseFailed"],
    ["aborted", "responseStopped"],
  ] as const)(
    "shares canonical %s recovery with the full assistant",
    async (conversationStatus, expectedMessage) => {
      const regenerate = vi.fn(() => Promise.resolve(true));
      const session = {
        draft: "",
        setDraft: vi.fn(),
        selectedSkillKey: null,
        setSelectedSkillKey: vi.fn(),
        status: "ready",
        error: null,
        errorMessage: null,
        history: {
          status: "ready",
          conversationStatus,
          error: null,
          retry: vi.fn(),
        },
        recoveryReady: true,
        recoveryStorageError: false,
        busy: false,
        stop: vi.fn(),
        submit: vi.fn(),
        regenerate,
        startNewConversation: vi.fn(),
      } as unknown as StoryCanvasAssistantSession;

      await act(async () => {
        root.render(<StoryCanvasAgentLauncher session={session} onOpenAssistant={vi.fn()} />);
      });

      expect(container.textContent).toContain(expectedMessage);
      const retry = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "retry"
      );
      expect(retry).toBeDefined();
      await act(async () => retry?.click());
      expect(regenerate).toHaveBeenCalledTimes(1);
    }
  );
});
