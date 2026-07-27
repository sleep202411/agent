// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/message-scroller", () => ({
  MessageScrollerProvider: ({ children }: { children: ReactNode }) => children,
  MessageScroller: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageScrollerViewport: ({ children, ...props }: { children: ReactNode }) => (
    <section {...props}>{children}</section>
  ),
  MessageScrollerContent: ({ children, ...props }: { children: ReactNode }) => (
    <div role="log" {...props}>
      {children}
    </div>
  ),
  MessageScrollerItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageScrollerButton: ({ label }: { label: string }) => <button>{label}</button>,
}));

import { CopilotTranscript } from "./copilot-transcript";

describe("CopilotTranscript", () => {
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

  it("renders assistant Markdown while preserving user text verbatim", async () => {
    const messages: UIMessage[] = [
      { id: "user", role: "user", parts: [{ type: "text", text: "**literal user text**" }] },
      {
        id: "assistant",
        role: "assistant",
        parts: [{ type: "text", text: "**formatted assistant text**" }],
      },
    ];

    await act(async () => {
      root.render(
        <CopilotTranscript
          messages={messages}
          status="ready"
          assistantLabel="Assistant"
          userLabel="You"
          thinkingLabel="Thinking"
          transcriptLabel="Conversation"
          scrollToLatestLabel="Latest"
          empty={null}
        />
      );
    });

    expect(container.textContent).toContain("**literal user text**");
    expect(container.querySelectorAll("strong")).toHaveLength(1);
    expect(container.querySelector("strong")?.textContent).toBe("formatted assistant text");
  });
});
