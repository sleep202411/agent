// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StoryPublicationDialog,
  StoryPublicationFailure,
  StoryPublicationProgress,
  StoryPublicationOfflineDialog,
} from "./story-publication-dialog";
import type { StoryPublicationState } from "./use-story-publication";

const signIn = vi.hoisted(() => vi.fn());
vi.mock("@/app/_components/auth-provider", () => ({ useAuth: () => ({ signIn }) }));

const messages = {
  common: { close: "Close" },
  storyStudio: {
    canvas: {
      publish: {
        actionError: {
          auth: "Sign in again before publishing.",
          permission: "Ask the project owner to check your publishing role.",
          service: "Retry the publication service.",
        },
        statusError: { signIn: "Sign in again" },
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
          locate: "Show on the plot tree",
        },
        offline: {
          title: "Take offline?",
          description: "Remove the public version.",
          confirm: "Take offline",
        },
      },
    },
  },
};

describe("StoryPublicationDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    signIn.mockReset();
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

  it("keeps upstream failures on the page outside the confirmation dialog", async () => {
    await renderContent(
      <StoryPublicationFailure message="Add a current video to the entrance clip." issues={[]} />
    );

    expect(document.body.textContent).toContain("Add a current video to the entrance clip.");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("offers sign-in recovery while preserving the exact session failure", async () => {
    await renderContent(
      <StoryPublicationFailure message="Upstream session expired" issues={[]} errorKind="auth" />
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Sign in again before publishing.");
    expect(document.body.textContent).toContain("Upstream session expired");
    await click(buttonByText("Sign in again"));
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("locates the plot node named by a publish failure", async () => {
    const onLocateIssue = vi.fn();
    const issue = {
      message: "Clip 9 cannot be reached from the chapter start.",
      nodeId: "clip:scene-17",
      chapterId: "chapter-two",
      chapterTitle: "Second Chapter",
    };
    await renderContent(
      <StoryPublicationFailure
        message={issue.message}
        issues={[issue]}
        onLocateIssue={onLocateIssue}
      />
    );

    expect(document.body.textContent).toContain("Clip 9 cannot be reached from the chapter start.");
    await click(buttonByText("Show on the plot tree"));
    expect(document.body.textContent).toContain("Second Chapter");
    expect(onLocateIssue).toHaveBeenCalledWith(issue);
  });

  it("shows progress on the page while the final confirmation is closed", async () => {
    await renderContent(
      <>
        <StoryPublicationDialog
          state={{ status: "saving" }}
          draftRevision={18}
          canMutate={false}
          disabledReason={null}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
        <StoryPublicationProgress phase="saving" />
      </>
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Save latest changes");
  });

  it("cannot dismiss the offline confirmation during its request", async () => {
    const onClose = vi.fn();
    await renderContent(
      <StoryPublicationOfflineDialog open pending onClose={onClose} onConfirm={vi.fn()} />
    );

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(buttonByText("Take offline").disabled).toBe(true);
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
          />
        </NextIntlClientProvider>
      );
    });
  }

  async function renderContent(content: ReactNode) {
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          {content}
        </NextIntlClientProvider>
      )
    );
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
