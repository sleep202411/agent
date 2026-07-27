"use client";

import type { ReactNode } from "react";
import { IconAlertCircle, IconPhoto, IconPlayerStop } from "@tabler/icons-react";

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
  StudioAgentApprovalView,
  StudioAgentContextCompactionView,
  StudioAgentMessageView,
  StudioAgentTerminalRunView,
  StudioAgentTimelineItemView,
} from "@/lib/studio-agent";

import {
  StudioAgentActivityRow,
  type StudioAgentActivityRowLabels,
} from "./studio-agent-activity-row";

export interface StudioAgentTimelineLabels {
  log: string;
  empty: string;
  scrollToLatest: string;
  loadEarlier: string;
  loadingEarlier: string;
  messageRole: Record<"user" | "assistant", string>;
  runStatus: Record<StudioAgentTerminalRunView["status"], string>;
  attachment: {
    status: Record<StudioAgentMessageView["attachments"][number]["status"], string>;
    unknownSize: string;
    fileSize: (sizeBytes: number) => string;
  };
  activity: StudioAgentActivityRowLabels;
}

export interface StudioAgentTimelineProps {
  items: readonly StudioAgentTimelineItemView[];
  labels: StudioAgentTimelineLabels;
  busy?: boolean;
  empty?: ReactNode;
  renderMessage?: (message: StudioAgentMessageView) => ReactNode;
  renderApproval: (approval: StudioAgentApprovalView) => ReactNode;
  renderContextCompaction: (compaction: StudioAgentContextCompactionView) => ReactNode;
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
  renderApproval,
  renderContextCompaction,
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
              visibleItems.map((item, index) => (
                <MessageScrollerItem
                  key={`${item.kind}:${item.id}`}
                  // The scroller's prepend restore only anchors on elements
                  // carrying data-message-id; without it, loading earlier turns
                  // silently loses the reading position.
                  messageId={`${item.kind}:${item.id}`}
                  scrollAnchor={index === visibleItems.length - 1}
                >
                  {item.kind === "message" ? (
                    <article
                      aria-label={labels.messageRole[item.message.role]}
                      data-role={item.message.role}
                      className={cn(
                        "min-w-0 text-sm/relaxed text-white/82",
                        item.message.role === "user" &&
                          "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-white/[0.07] px-3.5 py-2.5 text-white/88"
                      )}
                    >
                      {renderMessage(item.message)}
                      {item.message.attachments.length > 0 ? (
                        <MessageAttachments
                          attachments={item.message.attachments}
                          labels={labels.attachment}
                        />
                      ) : null}
                    </article>
                  ) : item.kind === "activity" ? (
                    <StudioAgentActivityRow activity={item.activity} labels={labels.activity} />
                  ) : item.kind === "approval" ? (
                    renderApproval(item.approval)
                  ) : item.kind === "run" ? (
                    <RunOutcome run={item.run} label={labels.runStatus[item.run.status]} />
                  ) : (
                    renderContextCompaction(item.compaction)
                  )}
                </MessageScrollerItem>
              ))
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton label={labels.scrollToLatest} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function RunOutcome({ run, label }: { run: StudioAgentTerminalRunView; label: string }): ReactNode {
  const Icon = run.status === "failed" ? IconAlertCircle : IconPlayerStop;
  return (
    <div
      role={run.status === "failed" ? "alert" : "status"}
      className={cn(
        "flex min-w-0 items-start gap-2 px-1.5 text-xs/relaxed text-white/48",
        run.status === "failed" && "text-destructive/82"
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {run.summary ? (
          <span className="block break-words text-white/48">{run.summary}</span>
        ) : null}
      </span>
    </div>
  );
}

function renderPlainMessage(message: StudioAgentMessageView): ReactNode {
  return message.text ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null;
}

function MessageAttachments({
  attachments,
  labels,
}: {
  attachments: StudioAgentMessageView["attachments"];
  labels: StudioAgentTimelineLabels["attachment"];
}) {
  return (
    <div className={cn("grid gap-1.5", attachments.length > 0 && "mt-2")}>
      {attachments.map((attachment) => (
        <div
          key={attachment.attachmentId}
          className="flex min-w-0 items-center gap-2 rounded-xl bg-black/18 px-2.5 py-2"
        >
          <IconPhoto aria-hidden="true" className="size-4 shrink-0 text-white/42" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-white/76">{attachment.fileName}</p>
            <p className="mt-0.5 truncate text-[10px] text-white/36">
              {attachment.mediaType} ·{" "}
              {attachment.sizeBytes === null
                ? labels.unknownSize
                : labels.fileSize(attachment.sizeBytes)}{" "}
              · {labels.status[attachment.status]}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
