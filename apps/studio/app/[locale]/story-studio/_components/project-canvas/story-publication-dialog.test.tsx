// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryPublicationDialog } from "./story-publication-dialog";
import type { StoryPublicationState } from "./use-story-publication";

const messages = {
  common: { close: "Close" },
  storyStudio: {
    canvas: {
      publish: {
        title: "Publish current version?",
        description: "Set the latest saved story as the live version.",
        confirmation: {
          title: "Ready to publish",
          draftRevision: "Latest saved story · revision {revision}",
          detail: "Future edits remain private until you publish again.",
        },
        progress: {
          title: "Publishing current version",
          description: "Keep this window open.",
        },
        phases: {
          saving: { title: "Save latest changes", description: "Saving the story." },
          locking: { title: "Prepare release version", description: "Preparing the version." },
          building: { title: "Check playable content", description: "Checking the story." },
          publishing: { title: "Publish", description: "Setting the live version." },
        },
        actions: {
          cancel: "Cancel",
          confirm: "Publish current version",
          close: "Close",
          retry: "Try again",
        },
        success: {
          title: "Version published",
          description: "The current version is now live.",
          version: "Current version is live",
          detail: "Players now enter this version.",
        },
        failure: {
          title: "This version was not published",
          description: "Resolve the issue below, then try again.",
        },
        diagnostics: { title: "{count} issues to resolve" },
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

    expect(document.body.textContent).toContain("Publish current version?");
    expect(document.body.textContent).toContain("Future edits remain private");
    expect(document.body.textContent).not.toContain("productionRevision");
    expect(document.body.textContent).not.toContain("manifest");
    await click(buttonByText("Publish current version"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows the upstream failure and actionable diagnostics, then permits retry", async () => {
    const onRetry = vi.fn();
    await renderDialog(
      {
        status: "failed",
        phase: "building",
        code: "BUILD_NOT_READY",
        message: "Add a current video to the entrance clip.",
        diagnostics: [
          {
            severity: "error",
            code: "CLIP_VIDEO_MISSING",
            message: "Entrance clip needs a video before publishing.",
            entityType: "clip",
            entityId: "entrance",
          },
        ],
      },
      { onRetry }
    );

    expect(document.body.textContent).toContain("Add a current video to the entrance clip.");
    expect(document.body.textContent).toContain("Entrance clip needs a video before publishing.");
    await click(buttonByText("Try again"));
    expect(onRetry).toHaveBeenCalledOnce();
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

  async function renderDialog(
    state: StoryPublicationState,
    callbacks: {
      onClose?: () => void;
      onConfirm?: () => void;
      onRetry?: () => void;
    } = {}
  ) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <StoryPublicationDialog
            state={state}
            draftRevision={18}
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
