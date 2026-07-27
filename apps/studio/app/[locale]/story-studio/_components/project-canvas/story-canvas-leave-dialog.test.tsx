// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryCanvasLeaveDialog } from "./story-canvas-leave-dialog";

const messages = {
  common: { close: "Close" },
  storyStudio: {
    canvas: {
      leaveGuard: {
        title: "Leave with local recovery work?",
        description: "Some local work cannot be saved now.",
        planes: {
          draft: { title: "Story draft", description: "Draft recovery exists." },
          layout: { title: "Canvas layout", description: "Layout recovery exists." },
          generation: { title: "Generation settings", description: "Settings are unsaved." },
        },
        stay: "Stay on canvas",
        export: "Export recovery",
        discardAndLeave: "Discard and leave",
        exported: "Recovery exported.",
      },
    },
  },
};

describe("StoryCanvasLeaveDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("offers export, explicit discard, and a safe stay action", async () => {
    const onStay = vi.fn();
    const onExport = vi.fn();
    const onDiscardAndLeave = vi.fn();
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <StoryCanvasLeaveDialog
            open
            planes={["draft", "layout"]}
            recoveryExported={false}
            onStay={onStay}
            onExport={onExport}
            onDiscardAndLeave={onDiscardAndLeave}
          />
        </NextIntlClientProvider>
      );
    });

    expect(document.body.textContent).toContain("Draft recovery exists.");
    expect(document.body.textContent).toContain("Layout recovery exists.");
    await click(buttonByText("Export recovery"));
    await click(buttonByText("Discard and leave"));
    expect(onExport).toHaveBeenCalledOnce();
    expect(onDiscardAndLeave).toHaveBeenCalledOnce();
    expect(onStay).not.toHaveBeenCalled();
  });
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
