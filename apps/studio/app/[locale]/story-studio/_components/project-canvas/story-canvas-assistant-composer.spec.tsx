// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { StoryCanvasAssistantComposer } from "./story-canvas-assistant-composer";
import type { StoryCanvasAssistantSession } from "./use-story-canvas-assistant-session";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

function sessionFixture(overrides: Record<string, unknown> = {}): StoryCanvasAssistantSession {
  return {
    draft: "",
    setDraft: vi.fn(),
    selectedSkillKey: null,
    setSelectedSkillKey: vi.fn(),
    recoveryReady: true,
    busy: false,
    attachment: null,
    attachmentError: null,
    attachmentUploading: false,
    attachDocument: vi.fn(() => true),
    removeAttachment: vi.fn(),
    stop: vi.fn(),
    history: { status: "ready", conversationStatus: "ready" },
    ...overrides,
  } as unknown as StoryCanvasAssistantSession;
}

describe("Story Canvas assistant composer attachments", () => {
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

  async function render(element: ReactElement) {
    await act(async () => {
      root.render(element);
    });
  }

  function composer(session: StoryCanvasAssistantSession) {
    return (
      <StoryCanvasAssistantComposer
        session={session}
        placeholder="placeholder"
        onSubmit={vi.fn()}
      />
    );
  }

  it("offers a paperclip restricted to .docx/.md/.txt and forwards the picked file", async () => {
    const session = sessionFixture();
    await render(composer(session));

    const input = container.querySelector<HTMLInputElement>(
      "[data-testid=story-canvas-document-input]"
    );
    expect(input).not.toBeNull();
    expect(input!.accept).toBe(".docx,.md,.txt");
    const attach = container.querySelector<HTMLButtonElement>("button[aria-label=attachDocument]");
    expect(attach).not.toBeNull();

    const file = new File(["INT. GATE"], "script.docx");
    await act(async () => {
      Object.defineProperty(input!, "files", { value: [file], configurable: true });
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(session.attachDocument).toHaveBeenCalledWith(file);
  });

  it("renders the pending chip with name and size and lets the creator remove it", async () => {
    const session = sessionFixture({
      attachment: new File([new Uint8Array(2048)], "剧本.docx"),
    });
    await render(composer(session));

    expect(container.textContent).toContain("剧本.docx");
    expect(container.textContent).toContain("2.0KB");
    const remove = container.querySelector<HTMLButtonElement>(
      "button[aria-label=removeAttachment]"
    );
    expect(remove).not.toBeNull();
    await act(async () => remove!.click());
    expect(session.removeAttachment).toHaveBeenCalledTimes(1);
  });

  it("enables sending with an attachment and no text, but never while uploading", async () => {
    const session = sessionFixture({
      attachment: new File(["x"], "outline.md"),
    });
    await render(composer(session));
    const send = container.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(send).not.toBeNull();
    expect(send!.disabled).toBe(false);

    await render(
      composer(
        sessionFixture({
          attachment: new File(["x"], "outline.md"),
          attachmentUploading: true,
        })
      )
    );
    const uploadingSend = container.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(uploadingSend!.disabled).toBe(true);
  });

  it("shows the typed attachment errors", async () => {
    for (const [error, key] of [
      ["unsupported", "attachmentUnsupported"],
      ["tooLarge", "attachmentTooLarge"],
      ["uploadFailed", "attachmentUploadFailed"],
    ] as const) {
      await render(composer(sessionFixture({ attachmentError: error })));
      const alert = container.querySelector("[role=alert]");
      expect(alert?.textContent).toBe(key);
    }
  });
});
