// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryProjectUiStore } from "../../_stores/story-project-ui-store";
import { StoryPublicationDialog } from "./story-publication-dialog";
import type { StoryPublicationState } from "./use-story-publication";

const messages = {
  common: { close: "Close" },
  storyStudio: {
    canvas: {
      publish: {
        title: "Submit current version for review?",
        description: "Send the latest saved story to platform review.",
        confirmation: {
          title: "Ready for review",
          draftRevision: "Latest saved story · revision {revision}",
          detail: "Future edits do not alter the version under review.",
        },
        progress: {
          title: "Submitting current version",
          description: "Keep this window open.",
        },
        phases: {
          saving: { title: "Save latest changes", description: "Saving the story." },
          preparing: { title: "Prepare version", description: "Preparing the version." },
          submitting: { title: "Submit", description: "Requesting review." },
        },
        actions: {
          cancel: "Cancel",
          confirm: "Submit for review",
          close: "Close",
          retry: "Try again",
        },
        success: {
          title: "Version submitted",
          description: "The current version is in review.",
          version: "Review requested",
          detail: "Players cannot access it until approval.",
        },
        failure: {
          title: "This version was not submitted",
          description: "Resolve the issue below, then try again.",
          locateScene: "Locate scene",
        },
      },
    },
  },
};

describe("StoryPublicationDialog", () => {
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
    document.body.replaceChildren();
  });

  it("asks for an explicit creator-facing confirmation", async () => {
    const onConfirm = vi.fn();
    await renderDialog({ status: "confirming" }, { onConfirm });

    expect(document.body.textContent).toContain("Submit current version for review?");
    expect(document.body.textContent).toContain("Future edits do not alter");
    expect(document.body.textContent).not.toContain("manifest");
    await click(buttonByText("Submit for review"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows the upstream failure and permits retry", async () => {
    const onRetry = vi.fn();
    await renderDialog(
      {
        status: "failed",
        phase: "preparing",
        code: "PREPARE_FAILED",
        message: "Add a current video to the entrance clip.",
        issues: [],
      },
      { onRetry }
    );

    expect(document.body.textContent).toContain("Add a current video to the entrance clip.");
    await click(buttonByText("Try again"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("lists blocking issues and closes onto the offending scene on locate", async () => {
    const onClose = vi.fn();
    useStoryProjectUiStore.setState({ canvasFocusRequest: null, canvasFocusSequence: 0 });
    await renderDialog(
      {
        status: "failed",
        phase: "preparing",
        code: "PREPARE_FAILED",
        message: "Chapter Build build-1 is not ready for review.",
        issues: [
          {
            code: "STORY_BUILD_WORLD_NOT_READY",
            message: "Scene scene.entry world is still building.",
            nodeId: "scene.entry",
          },
          {
            code: "STORY_BUILD_TIMELINE_DUPLICATE",
            message: "Timeline repeats.",
            nodeId: null,
          },
        ],
      },
      { onClose }
    );

    expect(document.body.textContent).toContain("STORY_BUILD_WORLD_NOT_READY");
    expect(document.body.textContent).toContain("Timeline repeats.");
    const locateButtons = [...document.querySelectorAll("button")].filter(
      (button) => button.textContent?.trim() === "Locate scene"
    );
    expect(locateButtons).toHaveLength(1);
    await click(locateButtons[0] as HTMLButtonElement);
    expect(onClose).toHaveBeenCalledOnce();
    expect(useStoryProjectUiStore.getState().canvasFocusRequest).toMatchObject({
      nodeId: "scene.entry",
    });
  });

  it("cannot be dismissed while publication is active", async () => {
    const onClose = vi.fn();
    await renderDialog({ status: "saving" }, { onClose });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Save latest changes");
  });

  it("keeps an already-open confirmation read-only while Agent authoring owns writes", async () => {
    const onConfirm = vi.fn();
    await renderDialog(
      { status: "confirming" },
      {
        canMutate: false,
        disabledReason: "Agent is updating the project.",
        onConfirm,
      }
    );

    const confirm = buttonByText("Submit for review");
    expect(confirm.disabled).toBe(true);
    expect(confirm.title).toBe("Agent is updating the project.");
    confirm.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  async function renderDialog(
    state: StoryPublicationState,
    callbacks: {
      onClose?: () => void;
      onConfirm?: () => void;
      onRetry?: () => void;
      canMutate?: boolean;
      disabledReason?: string | null;
    } = {}
  ) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <StoryPublicationDialog
            state={state}
            draftRevision={18}
            canMutate={callbacks.canMutate ?? true}
            disabledReason={callbacks.disabledReason ?? null}
            onClose={callbacks.onClose ?? vi.fn()}
            onConfirm={callbacks.onConfirm ?? vi.fn()}
            onRetry={callbacks.onRetry ?? vi.fn()}
          />
        </NextIntlClientProvider>
      );
    });
  }
});

async function click(element: HTMLButtonElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}
