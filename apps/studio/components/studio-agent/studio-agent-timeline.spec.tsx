// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/message-scroller", () => ({
  MessageScrollerProvider: ({ children }: { children: ReactNode }) => children,
  MessageScroller: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageScrollerViewport: ({ children, ...props }: { children: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  // Keeps the real component's slot marker so a test can assert what does and
  // does not live inside the scroller's item list.
  MessageScrollerContent: ({ children, ...props }: { children: ReactNode }) => (
    <div data-slot="message-scroller-content" {...props}>
      {children}
    </div>
  ),
  MessageScrollerItem: ({ children, messageId }: { children: ReactNode; messageId?: string }) => (
    <div data-message-id={messageId}>{children}</div>
  ),
  MessageScrollerButton: ({ label }: { label: string }) => <button>{label}</button>,
}));

import { StudioAgentTimeline } from "./studio-agent-timeline";

describe("StudioAgentTimeline attachment metadata", () => {
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

  it("renders persisted attachment-only user messages", async () => {
    await act(async () => {
      root.render(
        <StudioAgentTimeline
          items={[
            {
              kind: "message",
              id: "message-1",
              sequence: 1,
              message: {
                id: "message-1",
                messageId: "message-1",
                clientMessageId: "00000000-0000-4000-8000-000000000001",
                runId: null,
                role: "user",
                format: "plain_text",
                text: "",
                attachments: [
                  {
                    type: "attachment",
                    attachmentId: "00000000-0000-4000-8000-000000000071",
                    fileName: "reference.webp",
                    mediaType: "image/webp",
                    sizeBytes: 4_096,
                    status: "ready",
                  },
                ],
                status: "completed",
                createdAt: "2026-07-24T12:00:00.000Z",
                sequence: 1,
              },
            },
          ]}
          labels={labels}
          renderApproval={() => null}
          renderContextCompaction={() => null}
        />
      );
    });

    expect(container.textContent).toContain("reference.webp");
    expect(container.textContent).toContain("image/webp");
    expect(container.textContent).toContain("4 KB");
    expect(container.textContent).toContain("Ready");
  });
});

describe("StudioAgentTimeline earlier-turn control", () => {
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

  async function renderWith(earlier?: { hasMore: boolean; loading: boolean; onLoad: () => void }) {
    await act(async () => {
      root.render(
        <StudioAgentTimeline
          items={[]}
          labels={labels}
          earlier={earlier}
          renderApproval={() => null}
          renderContextCompaction={() => null}
        />
      );
    });
  }

  // The scroll-to-latest affordance is also a button, so the control has to be
  // identified by its label rather than by tag.
  function earlierButton(scope: ParentNode = container) {
    return [...scope.querySelectorAll("button")].find((node) =>
      [labels.loadEarlier, labels.loadingEarlier].includes(node.textContent ?? "")
    );
  }

  it("renders the control only while earlier turns exist and disables it while loading", async () => {
    await renderWith({ hasMore: false, loading: false, onLoad: () => {} });
    expect(earlierButton()).toBeUndefined();

    const onLoad = vi.fn();
    await renderWith({ hasMore: true, loading: false, onLoad });
    const button = earlierButton();
    expect(button?.textContent).toBe("Load earlier turns");
    expect(button?.hasAttribute("disabled")).toBe(false);
    await act(async () => button?.click());
    expect(onLoad).toHaveBeenCalledTimes(1);

    await renderWith({ hasMore: true, loading: true, onLoad });
    const busy = earlierButton();
    expect(busy?.textContent).toBe("Loading earlier turns…");
    expect(busy?.hasAttribute("disabled")).toBe(true);
  });

  it("keeps the control out of the scroller item list", async () => {
    await renderWith({ hasMore: true, loading: false, onLoad: () => {} });

    // The scroller detects a prepend by comparing Content's children. A control
    // living in that list is always the first child, so every prepend would
    // read as an append and teleport the reader to the newest turn.
    const content = container.querySelector('[data-slot="message-scroller-content"]');
    expect(content).not.toBeNull();
    expect(earlierButton(content!)).toBeUndefined();
    expect(earlierButton()).toBeDefined();
  });
});

const labels = {
  log: "Conversation",
  empty: "No messages",
  scrollToLatest: "Latest",
  loadEarlier: "Load earlier turns",
  loadingEarlier: "Loading earlier turns…",
  messageRole: {
    user: "You",
    assistant: "Agent",
  },
  runStatus: {
    failed: "Failed",
    cancelled: "Cancelled",
  },
  attachment: {
    status: {
      processing: "Processing",
      ready: "Ready",
      failed: "Failed",
    },
    unknownSize: "Size unavailable",
    fileSize: (bytes: number) => `${bytes / 1024} KB`,
  },
  activity: {
    expand: "Expand",
    collapse: "Collapse",
    semantic: {
      "studio_agent.activity.generating_response": "Generating response",
    },
    status: {
      running: "Running",
      succeeded: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    },
  },
};
