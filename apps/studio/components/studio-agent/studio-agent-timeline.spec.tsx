// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioAgentMessageView, StudioAgentTimelineItemView } from "@/lib/studio-agent";

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

import type {
  StudioAgentDocumentAnalysisMap,
  StudioAgentDocumentAnalysisView,
} from "@/lib/studio-agent";

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
              message: {
                id: "message-1",
                messageId: "message-1",
                clientMessageId: "00000000-0000-4000-8000-000000000001",
                runId: null,
                role: "user",
                delivery: "send",
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
                streaming: false,
                createdAt: "2026-07-24T12:00:00.000Z",
              },
            },
          ]}
          labels={labels}
          renderToolApproval={() => null}
        />
      );
    });

    expect(container.textContent).toContain("reference.webp");
    expect(container.textContent).toContain("image/webp");
    expect(container.textContent).toContain("4 KB");
    expect(container.textContent).toContain("Ready");
  });

  // The attachment part is frozen at the moment the prompt was sent, so a
  // "Ready" document row said nothing at all while a 46-checkpoint analysis ran
  // behind it for half an hour — and nothing when it died.
  it("keeps a sent document honest about the analysis still running behind it", async () => {
    await renderDocument(
      new Map([
        [
          DOCUMENT_ATTACHMENT_ID,
          analysisView({ phase: "mapping", progress: 13, completedUnits: 6 }),
        ],
      ])
    );

    expect(container.textContent).toContain("Analyzing the document 13%");
    expect(container.querySelector('[role="progressbar"][aria-valuenow="13"]')).not.toBeNull();
  });

  it("reports the failure the job recorded, not a generic one", async () => {
    await renderDocument(
      new Map([
        [
          DOCUMENT_ATTACHMENT_ID,
          analysisView({
            phase: "failed",
            progress: 13,
            completedUnits: 6,
            settled: true,
            error: {
              code: "AGENT_DOCUMENT_ANALYSIS_EVIDENCE_INVALID",
              message: "FizzDragon could not complete the source document analysis.",
              retryable: true,
            },
          }),
        ],
      ])
    );

    expect(container.textContent).toContain(
      "FizzDragon could not complete the source document analysis."
    );
    expect(container.textContent).not.toContain("Document analysis failed");
  });

  async function renderDocument(analysis: StudioAgentDocumentAnalysisMap) {
    await act(async () => {
      root.render(
        <StudioAgentTimeline
          items={[
            {
              kind: "message",
              id: "message-2",
              message: {
                id: "message-2",
                messageId: "message-2",
                clientMessageId: "00000000-0000-4000-8000-000000000002",
                runId: null,
                role: "user",
                delivery: "send",
                format: "plain_text",
                text: "Analyse this screenplay.",
                attachments: [
                  {
                    type: "attachment",
                    attachmentId: DOCUMENT_ATTACHMENT_ID,
                    fileName: "screenplay-test.docx",
                    mediaType:
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    sizeBytes: 159_744,
                    status: "ready",
                  },
                ],
                status: "completed",
                streaming: false,
                createdAt: "2026-07-31T12:35:00.000Z",
              },
            },
          ]}
          labels={labels}
          analysis={analysis}
          renderToolApproval={() => null}
        />
      );
    });
  }
});

const DOCUMENT_ATTACHMENT_ID = "00000000-0000-4000-8000-000000000072";

function analysisView(
  overrides: Partial<StudioAgentDocumentAnalysisView>
): StudioAgentDocumentAnalysisView {
  return {
    attachmentId: DOCUMENT_ATTACHMENT_ID,
    jobId: "00000000-0000-4000-8000-0000000000a2",
    phase: "mapping",
    progress: 0,
    completedUnits: 0,
    totalUnits: 46,
    error: null,
    settled: false,
    ...overrides,
  };
}

describe("StudioAgentTimeline in-flight assistant text", () => {
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

  async function renderReply(streaming: boolean, text: string) {
    await act(async () => {
      root.render(
        <StudioAgentTimeline
          items={[
            {
              kind: "message",
              id: "message-1",
              message: {
                id: "message-1",
                messageId: "message-1",
                clientMessageId: null,
                runId: "run-1",
                role: "assistant",
                delivery: "send",
                format: "plain_text",
                text,
                attachments: [],
                status: streaming ? "streaming" : "completed",
                streaming,
                createdAt: "2026-07-24T12:00:00.000Z",
              },
            },
          ]}
          labels={labels}
          renderToolApproval={() => null}
        />
      );
    });
    return container.querySelector<HTMLElement>('article[data-role="assistant"]');
  }

  it("marks a reply that is still arriving as busy without making the text harder to read", async () => {
    const reply = await renderReply(true, "金陵的雨");

    expect(reply?.getAttribute("data-streaming")).toBe("true");
    expect(reply?.getAttribute("aria-busy")).toBe("true");
    expect(reply?.className).not.toContain("text-white/56");
    expect(reply?.querySelector(".animate-pulse")).not.toBeNull();
    expect(reply?.textContent).toContain("金陵的雨");
  });

  it("drops every in-flight cue the moment the reply settles", async () => {
    const reply = await renderReply(false, "金陵的雨停了。");

    expect(reply?.getAttribute("data-streaming")).toBeNull();
    expect(reply?.getAttribute("aria-busy")).toBeNull();
    expect(reply?.className).not.toContain("text-white/56");
    expect(reply?.querySelector(".animate-pulse")).toBeNull();
  });
});

describe("StudioAgentTimeline immediate acknowledgement", () => {
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

  function message(
    role: "user" | "assistant",
    delivery: StudioAgentMessageView["delivery"] = "send"
  ): StudioAgentTimelineItemView {
    return {
      kind: "message",
      id: `${role}-message`,
      message: {
        id: `${role}-message`,
        messageId: `${role}-message`,
        clientMessageId: role === "user" ? "client-message" : null,
        runId: "run-1",
        role,
        delivery,
        format: role === "user" ? "plain_text" : "markdown",
        text: role === "user" ? "Open on the storm." : "The windows shake.",
        attachments: [],
        status: "completed",
        streaming: false,
        createdAt: "2026-07-30T20:00:00.000Z",
      },
    };
  }

  async function render(items: StudioAgentTimelineItemView[], busy = true) {
    await act(async () => {
      root.render(
        <StudioAgentTimeline
          items={items}
          busy={busy}
          labels={labels}
          renderToolApproval={() => null}
        />
      );
    });
  }

  it("acknowledges a fresh prompt immediately and yields to the first Agent output", async () => {
    await render([message("user")]);

    const thinking = container.querySelector<HTMLElement>('[data-state="thinking"]');
    expect(thinking?.textContent).toContain("Thinking");
    expect(thinking?.getAttribute("aria-busy")).toBe("true");

    await render([message("user"), message("assistant")]);
    expect(container.querySelector('[data-state="thinking"]')).toBeNull();
  });

  it("does not let an older terminal row suppress the current turn's acknowledgement", async () => {
    await render([
      message("user"),
      {
        kind: "run",
        id: "old-run",
        run: {
          id: "old-run",
          parentRunId: null,
          title: "",
          summary: "An older turn failed.",
          error: {
            code: "OLD_FAILURE",
            message: "An older turn failed.",
            retryable: false,
            details: null,
          },
          status: "failed",
          progress: 1,
          createdAt: "2026-07-29T20:00:00.000Z",
          startedAt: "2026-07-29T20:00:00.000Z",
          completedAt: "2026-07-29T20:00:01.000Z",
        },
      },
    ]);

    expect(container.querySelector('[data-state="thinking"]')).not.toBeNull();
  });

  it("does not pretend a queued or steering prompt is already being answered", async () => {
    await render([message("user", "enqueue")]);
    expect(container.querySelector('[data-state="thinking"]')).toBeNull();

    await render([message("user", "steer")]);
    expect(container.querySelector('[data-state="thinking"]')).toBeNull();
  });
});

describe("StudioAgentTimeline historical run outcomes", () => {
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

  it("keeps the upstream failure available without expanding old diagnostics by default", async () => {
    await act(async () => {
      root.render(
        <StudioAgentTimeline
          items={[
            {
              kind: "run",
              id: "failed-run",
              run: {
                id: "failed-run",
                parentRunId: null,
                title: "",
                summary: "Ably could not commit the realtime response.",
                error: {
                  code: "AGENT_ABLY_STREAM_RECOVERY_FAILED",
                  message: "Ably could not commit the realtime response.",
                  retryable: false,
                  details: null,
                },
                status: "failed",
                progress: 1,
                createdAt: "2026-07-30T20:00:00.000Z",
                startedAt: "2026-07-30T20:00:00.000Z",
                completedAt: "2026-07-30T20:00:01.000Z",
              },
            },
          ]}
          labels={labels}
          renderToolApproval={() => null}
        />
      );
    });

    const outcome = container.querySelector<HTMLDetailsElement>(
      '[data-slot="studio-agent-run-outcome"]'
    );
    expect(outcome?.open).toBe(false);
    expect(outcome?.querySelector("summary")?.textContent).toContain("Failed");
    expect(outcome?.querySelector("p")?.textContent).toBe(
      "Ably could not commit the realtime response."
    );
  });

  it("lets the host replace a chosen run row and keeps the default for the rest", async () => {
    const run = (id: string) => ({
      id,
      parentRunId: null,
      title: "",
      summary: "This turn stopped.",
      error: null,
      status: "failed" as const,
      progress: 1,
      createdAt: "2026-07-30T20:00:00.000Z",
      startedAt: "2026-07-30T20:00:00.000Z",
      completedAt: "2026-07-30T20:00:01.000Z",
    });
    await act(async () => {
      root.render(
        <StudioAgentTimeline
          items={[
            { kind: "run", id: "older-run", run: run("older-run") },
            { kind: "run", id: "newest-run", run: run("newest-run") },
          ]}
          labels={labels}
          renderToolApproval={() => null}
          // The host renders the newest failure in-flow with its retry
          // affordance; returning undefined keeps the quiet default row.
          renderRun={(item) =>
            item.id === "newest-run" ? <div data-testid="in-flow-failure" /> : undefined
          }
        />
      );
    });

    expect(container.querySelector('[data-testid="in-flow-failure"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="studio-agent-run-outcome"]')).toHaveLength(1);
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
          renderToolApproval={() => null}
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
  thinking: "Thinking…",
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
    analysis: {
      region: "Document analysis",
      queued: "Document analysis queued",
      mapping: (progress: number) => `Analyzing the document ${progress}%`,
      reducing: (progress: number) => `Synthesizing the analysis ${progress}%`,
      succeeded: "Document analysis ready",
      failed: "Document analysis failed",
      cancelled: "Document analysis cancelled",
    },
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
