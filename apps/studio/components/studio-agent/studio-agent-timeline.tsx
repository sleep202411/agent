"use client";

import type { ReactNode } from "react";
import { IconAlertCircle, IconChevronDown, IconPhoto, IconPlayerStop } from "@tabler/icons-react";

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";
import type {
  StudioAgentDocumentAnalysisMap,
  StudioAgentMessageView,
  StudioAgentTerminalRunView,
  StudioAgentTimelineItemView,
  StudioAgentToolApprovalView,
} from "@/lib/studio-agent";

import {
  StudioAgentActivityRow,
  type StudioAgentActivityRowLabels,
} from "./studio-agent-activity-row";
import {
  StudioAgentAttachmentAnalysis,
  type StudioAgentDocumentAnalysisLabels,
} from "./studio-agent-attachment-analysis";

export interface StudioAgentTimelineLabels {
  log: string;
  empty: string;
  scrollToLatest: string;
  loadEarlier: string;
  loadingEarlier: string;
  thinking: string;
  messageRole: Record<"user" | "assistant", string>;
  runStatus: Record<StudioAgentTerminalRunView["status"], string>;
  attachment: {
    status: Record<StudioAgentMessageView["attachments"][number]["status"], string>;
    unknownSize: string;
    fileSize: (sizeBytes: number) => string;
    analysis: StudioAgentDocumentAnalysisLabels;
  };
  activity: StudioAgentActivityRowLabels;
}

export interface StudioAgentTimelineProps {
  items: readonly StudioAgentTimelineItemView[];
  labels: StudioAgentTimelineLabels;
  busy?: boolean;
  empty?: ReactNode;
  renderMessage?: (message: StudioAgentMessageView) => ReactNode;
  /** The library's suspended tool call. See `StudioAgentToolApproval`. */
  renderToolApproval: (approval: StudioAgentToolApprovalView) => ReactNode;
  /**
   * Custom renderer for one terminal run's outcome row. Return `undefined` to
   * fall back to the default collapsed outcome row — the host uses this to give
   * the newest failed turn its in-flow failure row with the retry affordance,
   * while older terminals keep the quiet default.
   */
  renderRun?: (run: StudioAgentTerminalRunView) => ReactNode | undefined;
  /**
   * Live document-analysis state by attachment id.
   *
   * The attachment part in a persisted message is frozen at the moment it was
   * sent, so the minutes-long job behind it can only be told from here.
   */
  analysis?: StudioAgentDocumentAnalysisMap;
  /** Earlier-turn pagination. Absent when the surface loads whole threads. */
  earlier?: { hasMore: boolean; loading: boolean; onLoad: () => void };
  className?: string;
}

export function StudioAgentTimeline({
  items,
  labels,
  busy = false,
  empty,
  renderMessage = renderPlainMessage,
  renderToolApproval,
  renderRun,
  analysis,
  earlier,
  className,
}: StudioAgentTimelineProps) {
  // Drop messages with nothing to render — a purely structural assistant turn
  // (e.g. one that only carried a tool-call/delegation, or a reply that has not
  // streamed any text yet) would otherwise leave an empty bubble. The work it
  // represents is shown by its activity rows instead.
  const visibleItems = items.filter(
    (item) =>
      item.kind !== "message" || item.message.text.length > 0 || item.message.attachments.length > 0
  );
  const newestMessageIndex = findNewestMessageIndex(visibleItems);
  const newestMessage =
    newestMessageIndex < 0
      ? null
      : (visibleItems[newestMessageIndex] as Extract<
          StudioAgentTimelineItemView,
          { kind: "message" }
        >);
  const currentRunHasAgentSignal =
    newestMessage?.message.runId !== null
      ? visibleItems.some((item) => isAgentSignalForRun(item, newestMessage?.message.runId ?? null))
      : visibleItems
          .slice(newestMessageIndex + 1)
          .some(
            (item) =>
              (item.kind === "message" && item.message.role === "assistant") ||
              item.kind === "activity" ||
              item.kind === "toolApproval"
          );
  const showThinking =
    busy &&
    newestMessage?.message.role === "user" &&
    newestMessage.message.delivery !== "enqueue" &&
    newestMessage.message.delivery !== "steer" &&
    !currentRunHasAgentSignal;

  return (
    <MessageScrollerProvider>
      <MessageScroller className={className}>
        <MessageScrollerViewport aria-label={labels.log} aria-busy={busy} className="px-4 py-3">
          {/*
            Sibling of Content, never a child: the scroller enumerates Content's
            children to detect a prepend, so a control living in that list would
            always be the first element and every prepend would be mistaken for
            an append — teleporting the reader to the newest turn.
          */}
          {earlier?.hasMore ? (
            <div className="flex justify-center pb-4">
              <button
                type="button"
                disabled={earlier.loading}
                onClick={earlier.onLoad}
                className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] text-white/54 transition-colors hover:bg-white/[0.09] hover:text-white disabled:pointer-events-none disabled:opacity-50"
              >
                {earlier.loading ? labels.loadingEarlier : labels.loadEarlier}
              </button>
            </div>
          ) : null}
          <MessageScrollerContent
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            className="gap-4 pb-6"
            // The scroller reserves a trailing spacer so the newest turn can
            // scroll to the top; for this compact panel that leaves a jarring
            // near-viewport gap after sending. Cap it so the conversation grows
            // naturally from the bottom instead.
            spacerClassName="!max-h-0"
          >
            {visibleItems.length === 0 ? (
              <div className="flex min-h-48 flex-1 items-center justify-center px-6 text-center text-xs/relaxed text-white/36">
                {empty ?? labels.empty}
              </div>
            ) : (
              <>
                {visibleItems.map((item, index) => (
                  <MessageScrollerItem
                    key={`${item.kind}:${item.id}`}
                    // The scroller's prepend restore only anchors on elements
                    // carrying data-message-id; without it, loading earlier turns
                    // silently loses the reading position.
                    messageId={`${item.kind}:${item.id}`}
                    scrollAnchor={index === visibleItems.length - 1 && !showThinking}
                  >
                    {item.kind === "message" ? (
                      <article
                        aria-label={labels.messageRole[item.message.role]}
                        // Text that is still arriving is announced as busy and
                        // carries an inline pulse. It remains fully legible;
                        // status must not make the creator squint at the answer.
                        aria-busy={item.message.streaming || undefined}
                        data-role={item.message.role}
                        data-streaming={item.message.streaming ? "true" : undefined}
                        className={cn(
                          "min-w-0 text-sm/relaxed text-white/82",
                          item.message.role === "user" &&
                            "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-white/[0.07] px-3.5 py-2.5 text-white/88"
                        )}
                      >
                        {renderMessage(item.message)}
                        {item.message.streaming ? <StreamingPulse /> : null}
                        {item.message.attachments.length > 0 ? (
                          <MessageAttachments
                            attachments={item.message.attachments}
                            labels={labels.attachment}
                            analysis={analysis}
                          />
                        ) : null}
                      </article>
                    ) : item.kind === "activity" ? (
                      <StudioAgentActivityRow activity={item.activity} labels={labels.activity} />
                    ) : item.kind === "toolApproval" ? (
                      renderToolApproval(item.toolApproval)
                    ) : (
                      (renderRun?.(item.run) ?? (
                        <RunOutcome run={item.run} label={labels.runStatus[item.run.status]} />
                      ))
                    )}
                  </MessageScrollerItem>
                ))}
                {showThinking ? (
                  <MessageScrollerItem
                    key="assistant:thinking"
                    messageId="assistant:thinking"
                    scrollAnchor
                  >
                    <ThinkingIndicator
                      label={labels.thinking}
                      assistantLabel={labels.messageRole.assistant}
                    />
                  </MessageScrollerItem>
                ) : null}
              </>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton label={labels.scrollToLatest} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function findNewestMessageIndex(items: readonly StudioAgentTimelineItemView[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === "message") return index;
  }
  return -1;
}

function isAgentSignalForRun(item: StudioAgentTimelineItemView, runId: string | null): boolean {
  if (runId === null) return false;
  if (item.kind === "message") {
    return item.message.role === "assistant" && item.message.runId === runId;
  }
  if (item.kind === "activity") return item.activity.runId === runId;
  if (item.kind === "toolApproval") return item.toolApproval.runId === runId;
  return item.run.id === runId;
}

/**
 * Immediate acknowledgement after a creator starts a fresh turn.
 *
 * This is intentionally local and ephemeral: durable activities replace it as
 * soon as the Agent publishes real progress, and the first text part replaces
 * it with the answer. It confirms receipt without inventing a backend step.
 */
function ThinkingIndicator({
  label,
  assistantLabel,
}: {
  label: string;
  assistantLabel: string;
}): ReactNode {
  return (
    <article
      aria-label={assistantLabel}
      aria-busy="true"
      data-role="assistant"
      data-state="thinking"
      className="flex min-w-0 items-center gap-2 text-sm/relaxed text-white/46"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="size-1 animate-pulse rounded-full bg-white/38" />
        <span className="size-1 animate-pulse rounded-full bg-white/38 [animation-delay:180ms]" />
        <span className="size-1 animate-pulse rounded-full bg-white/38 [animation-delay:360ms]" />
      </span>
    </article>
  );
}

function RunOutcome({ run, label }: { run: StudioAgentTerminalRunView; label: string }): ReactNode {
  const Icon = run.status === "failed" ? IconAlertCircle : IconPlayerStop;
  return (
    <details
      data-slot="studio-agent-run-outcome"
      data-status={run.status}
      className={cn(
        "group min-w-0 px-1.5 text-xs/relaxed text-white/48",
        run.status === "failed" && "text-destructive/82"
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-0.5 outline-none transition-colors hover:text-white/72 focus-visible:ring-1 focus-visible:ring-white/24 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 font-medium">{label}</span>
        {run.summary ? (
          <IconChevronDown
            aria-hidden="true"
            className="size-3.5 shrink-0 text-white/28 transition-transform group-open:rotate-180"
          />
        ) : null}
      </summary>
      {run.summary ? (
        <p className="ml-5.5 mt-1 break-words pr-4 text-white/48">{run.summary}</p>
      ) : null}
    </details>
  );
}

/**
 * The in-flight marker for a reply that is still arriving.
 *
 * Monochrome and tiny by design (DESIGN.md rules 2 and 4): it encodes state, so
 * it is a tone step and a motion cue, never a color or an outline. `aria-hidden`
 * because the `aria-busy` on the message already carries this to assistive
 * technology.
 */
function StreamingPulse(): ReactNode {
  return (
    <span aria-hidden="true" className="ml-1.5 inline-flex translate-y-[-1px] items-center gap-1">
      <span className="size-1 animate-pulse rounded-full bg-white/40" />
      <span className="size-1 animate-pulse rounded-full bg-white/40 [animation-delay:180ms]" />
      <span className="size-1 animate-pulse rounded-full bg-white/40 [animation-delay:360ms]" />
    </span>
  );
}

function renderPlainMessage(message: StudioAgentMessageView): ReactNode {
  return message.text ? (
    <span className="whitespace-pre-wrap break-words">{message.text}</span>
  ) : null;
}

function MessageAttachments({
  attachments,
  labels,
  analysis,
}: {
  attachments: StudioAgentMessageView["attachments"];
  labels: StudioAgentTimelineLabels["attachment"];
  analysis: StudioAgentDocumentAnalysisMap | undefined;
}) {
  return (
    <div className={cn("grid gap-1.5", attachments.length > 0 && "mt-2")}>
      {attachments.map((attachment) => {
        const documentAnalysis = analysis?.get(attachment.attachmentId) ?? null;
        return (
          <div key={attachment.attachmentId} className="min-w-0 rounded-xl bg-black/18 px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <IconPhoto aria-hidden="true" className="size-4 shrink-0 text-white/42" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-white/76">
                  {attachment.fileName}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-white/36">
                  {attachment.mediaType} ·{" "}
                  {attachment.sizeBytes === null
                    ? labels.unknownSize
                    : labels.fileSize(attachment.sizeBytes)}{" "}
                  · {labels.status[attachment.status]}
                </p>
              </div>
            </div>
            {documentAnalysis ? (
              <StudioAgentAttachmentAnalysis analysis={documentAnalysis} labels={labels.analysis} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
