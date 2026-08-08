"use client";

import type { ReactNode } from "react";
import { IconAlertTriangle, IconLoader2, IconTool } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";
import { ApprovalPayload, type ApprovalPayloadLabels } from "./approval-payload";
import { SmoothStreamMarkdown } from "./smooth-stream-markdown";
import type { AgentOsChatMessage } from "./use-agent-os-run";

/** Clock label for timeline debug — local wall time next to every row. */
function formatMessageClock(iso: string): { label: string; title: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { label: "—", title: iso || "invalid time" };
  }
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const clock = `${hh}:${mm}:${ss}`;
  if (sameDay) {
    return { label: clock, title: d.toISOString() };
  }
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return {
    label: `${mo}-${day} ${clock}`,
    title: d.toISOString(),
  };
}

function MessageMetaClock({
  message,
  className,
}: {
  message: AgentOsChatMessage;
  className?: string;
}) {
  const { label, title } = formatMessageClock(message.createdAt);
  const seq = typeof message.meta?.eventSequence === "number" ? message.meta.eventSequence : null;
  const runHint = message.runId ? message.runId.slice(0, 8) : null;
  const tip = [
    title,
    runHint ? `run ${runHint}` : null,
    seq != null ? `seq ${seq}` : null,
    message.id,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <time
      dateTime={message.createdAt}
      title={tip}
      className={cn(
        "shrink-0 font-mono text-[10px] tabular-nums tracking-tight text-white/30",
        className
      )}
    >
      {label}
      {seq != null ? <span className="text-white/20">{` · #${seq}`}</span> : null}
    </time>
  );
}

/**
 * Agent OS transcript on shadcn MessageScroller + Message + Bubble.
 * Same chat shell as Canvas Copilot; data comes from AgentOsChatMessage[], not AI SDK UIMessage.
 */
export function AgentOsTranscript({
  messages,
  status,
  error,
  busy,
  pendingApprovalActive,
  onApprove,
  empty,
  labels,
}: {
  messages: AgentOsChatMessage[];
  status: "idle" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  error: string | null;
  busy: boolean;
  /** Whether the latest approval card should show action buttons. */
  pendingApprovalActive: boolean;
  onApprove: (decision: "approve" | "reject") => void;
  empty: ReactNode;
  labels: {
    transcript: string;
    scrollToLatest: string;
    user: string;
    assistant: string;
    system: string;
    tool: string;
    thinking: string;
    approve: string;
    reject: string;
    scriptAttached: (chars: number) => string;
    plan: string;
    payload: ApprovalPayloadLabels;
  };
}) {
  /**
   * Chat timeline rules (chronological):
   *   user → (optional tools/plan) → Working… → assistant stream → …
   * Working is a real timeline row while the agent is busy, except when the
   * *last* row is already a live streaming assistant bubble (progress shows
   * as the caret inside that bubble — still the same timeline position).
   */
  const last = messages.at(-1);
  const lastIsLiveAssistantStream =
    last?.role === "assistant" && last.meta?.kind === "streaming" && last.content.trim().length > 0;
  // Never show Working during HITL — the approval card is the action.
  const showWorkingOnTimeline =
    status !== "waiting_for_approval" &&
    (status === "running" || busy) &&
    !lastIsLiveAssistantStream;
  const isEmpty = messages.length === 0 && status === "idle" && !error;

  // Stick-to-bottom chat (side panel).
  //
  // shadcn MessageScroller's `defaultScrollPosition="last-anchor"` pins the
  // last `scrollAnchor` item to the *top* of the viewport (start of a turn).
  // We previously marked every user+assistant as an anchor, so each send /
  // full rebuild scrolled that anchor to the top → felt like "jump to top".
  //
  // Correct pattern for this panel:
  // - autoScroll + defaultScrollPosition="end" → follow the bottom
  // - only the *latest* row is a scrollAnchor (streaming / Working tail)
  // - spacer collapsed so we don't reintroduce a blank half-panel
  // The failure banner belongs at the BOTTOM: this panel follows the tail, so a
  // banner above the thread is off-screen the moment the conversation is longer
  // than the viewport — which is exactly when a turn dies unexplained.
  const tailId = error
    ? "timeline-error"
    : showWorkingOnTimeline
      ? "timeline-working"
      : (last?.id ?? null);

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label={labels.transcript}>
          <MessageScrollerContent
            aria-busy={status === "running" || busy}
            className="gap-3 px-3 py-3"
            spacerClassName="!max-h-0"
          >
            {isEmpty ? (
              <MessageScrollerItem
                messageId="timeline-empty"
                className="flex min-h-[12rem] items-start"
              >
                {empty}
              </MessageScrollerItem>
            ) : (
              messages.map((message) => {
                const streamingThis =
                  status === "running" &&
                  message.role === "assistant" &&
                  message.meta?.kind === "streaming";
                const isTail = !showWorkingOnTimeline && message.id === tailId;
                return (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    // Default Item uses contain-intrinsic-size ~10rem which
                    // invents empty height for short tool/assistant rows.
                    className="[contain-intrinsic-size:auto_1.5rem]"
                    scrollAnchor={isTail}
                  >
                    <AgentOsMessageRow
                      message={message}
                      busy={busy}
                      isStreaming={streamingThis}
                      showApprovalActions={message.role === "approval" && pendingApprovalActive}
                      onApprove={onApprove}
                      labels={labels}
                    />
                  </MessageScrollerItem>
                );
              })
            )}

            {/* Timeline tail: Working… after the last event while the turn is open. */}
            {showWorkingOnTimeline ? (
              <MessageScrollerItem
                key="timeline-working"
                messageId="timeline-working"
                className="[contain-intrinsic-size:auto_1.5rem]"
                scrollAnchor
              >
                <Marker role="status" className="px-1">
                  <MarkerIcon>
                    <IconLoader2 className="size-3.5 animate-spin text-white/55" stroke={1.8} />
                  </MarkerIcon>
                  <MarkerContent>{labels.thinking}</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : null}

            {error ? (
              <MessageScrollerItem key="timeline-error" messageId="timeline-error" scrollAnchor>
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200"
                >
                  <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" stroke={1.8} />
                  <span>{error}</span>
                </div>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end" label={labels.scrollToLatest} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function AgentOsMessageRow({
  message,
  busy,
  isStreaming = false,
  showApprovalActions,
  onApprove,
  labels,
}: {
  message: AgentOsChatMessage;
  busy: boolean;
  /** Live token stream — show caret, not a separate Working row under the bubble. */
  isStreaming?: boolean;
  showApprovalActions: boolean;
  onApprove: (decision: "approve" | "reject") => void;
  labels: {
    user: string;
    assistant: string;
    system: string;
    tool: string;
    approve: string;
    reject: string;
    scriptAttached: (chars: number) => string;
    plan: string;
    payload: ApprovalPayloadLabels;
  };
}) {
  if (message.role === "user") {
    // HITL decisions are timeline markers, not chat bubbles — keeps the
    // chronological stream readable next to tool/assistant rows.
    if (message.meta?.kind === "approval_decision") {
      return (
        <Marker className="px-1">
          <MarkerContent className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/45">
            <span>{message.content}</span>
            <MessageMetaClock message={message} />
          </MarkerContent>
        </Marker>
      );
    }
    const names = Array.isArray(message.meta?.attachmentNames)
      ? (message.meta!.attachmentNames as string[])
      : [];
    return (
      <Message align="end">
        <MessageContent className="gap-1">
          <MessageHeader className="flex items-center justify-end gap-2">
            <MessageMetaClock message={message} />
            <span>{labels.user}</span>
          </MessageHeader>
          <Bubble variant="secondary" className="max-w-[92%]">
            <BubbleContent className="whitespace-pre-wrap rounded-2xl bg-white/[0.1] px-3.5 py-2 text-sm leading-6 text-foreground">
              {message.content}
              {names.length > 0 ? (
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {names.map((name) => (
                    <span
                      key={name}
                      className="rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] text-white/55"
                    >
                      {name}
                    </span>
                  ))}
                </span>
              ) : null}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  if (message.role === "assistant") {
    // Live GFM while streaming (throttled parse) + rAF catch-up for chunky
    // poll/Ably jumps. Settled turns pass active=false and snap to full text.
    return (
      <Message align="start">
        <MessageContent className="gap-1">
          <MessageHeader className="flex items-center gap-2">
            <span>{labels.assistant}</span>
            <MessageMetaClock message={message} />
          </MessageHeader>
          <Bubble variant="ghost" className="max-w-full min-w-0">
            <BubbleContent className="min-w-0 max-w-full overflow-x-hidden px-0.5 text-sm leading-6 text-foreground/88">
              <SmoothStreamMarkdown
                target={message.content}
                active={isStreaming}
                caret={isStreaming}
              />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  if (message.role === "approval") {
    return (
      <Message align="start">
        <MessageContent className="gap-1">
          <MessageHeader className="flex items-center gap-2">
            <span className="text-amber-100/80">{labels.assistant}</span>
            <MessageMetaClock message={message} />
          </MessageHeader>
          <div className="w-full max-w-[96%] rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3">
            <p className="text-xs font-medium text-amber-100/90">{message.content}</p>
            {typeof message.meta?.description === "string" ? (
              <p className="mt-1 text-[11px] text-white/50">{message.meta.description}</p>
            ) : null}
            <p className="mt-1 font-mono text-[10px] text-white/40">
              {String(message.meta?.toolId ?? "")}
            </p>
            {/* What the write actually does — the whole point of the gate. */}
            <ApprovalPayload
              toolId={String(message.meta?.toolId ?? "")}
              args={message.meta?.arguments}
              labels={labels.payload}
            />
            {showApprovalActions ? (
              <div className="mt-2.5 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => onApprove("approve")}
                >
                  {labels.approve}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onApprove("reject")}
                >
                  {labels.reject}
                </Button>
              </div>
            ) : null}
          </div>
        </MessageContent>
      </Message>
    );
  }

  if (message.role === "tool") {
    const phase = String(message.meta?.phase ?? "");
    const isPlan = message.meta?.kind === "plan";
    const done = phase === "completed" || phase === "failed";
    return (
      <Marker className="px-1">
        <MarkerIcon>
          {phase === "started" || phase === "proposed" ? (
            <IconLoader2 className="size-3.5 animate-spin text-white/40" stroke={1.8} />
          ) : (
            <IconTool
              className={cn(
                "size-3.5 text-white/40",
                phase === "failed" && "text-red-300/70",
                phase === "completed" && "text-white/50"
              )}
              stroke={1.8}
            />
          )}
        </MarkerIcon>
        <MarkerContent
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-white/45",
            done && "text-white/40"
          )}
        >
          <span>
            {isPlan ? labels.plan : message.content}
            {!isPlan && phase ? ` · ${phase}` : ""}
          </span>
          <MessageMetaClock message={message} />
        </MarkerContent>
      </Marker>
    );
  }

  // system / error lines
  return (
    <Marker variant="separator" className="px-1">
      <MarkerContent className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/40">
        <span>{message.content}</span>
        <MessageMetaClock message={message} />
      </MarkerContent>
    </Marker>
  );
}
