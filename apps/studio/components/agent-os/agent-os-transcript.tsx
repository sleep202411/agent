"use client";

import type { ReactNode } from "react";
import { IconAlertTriangle, IconClockPause, IconLoader2 } from "@tabler/icons-react";
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
import type { AgentOsActivityStatus } from "./agent-os-activity";
import { SmoothStreamMarkdown } from "./smooth-stream-markdown";
import type { AgentOsChatMessage, AgentOsSessionStatus } from "./use-agent-os-run";

interface TranscriptLabels {
  transcript: string;
  scrollToLatest: string;
  user: string;
  assistant: string;
  thinking: string;
  waitingForInput: string;
  waitingForApproval: string;
  approved: string;
  rejected: string;
}

/**
 * Durable transcript projection:
 * - only real user messages and Assistant UI turns are rows;
 * - all messageId segments in one turnId share one Assistant visual group;
 * - the sole ephemeral activity lives at the active turn's tail;
 * - Question / Approval / Draft operation cards are composer-only.
 */
export function AgentOsTranscript({
  messages,
  status,
  error,
  busy,
  activityStatus,
  empty,
  labels,
}: {
  messages: AgentOsChatMessage[];
  status: AgentOsSessionStatus;
  error: string | null;
  busy: boolean;
  empty: ReactNode;
  activityStatus?: AgentOsActivityStatus | null;
  labels: TranscriptLabels;
}) {
  const lastTimelineItem = messages.at(-1);
  const activeTurnId = lastTimelineItem?.turnId ?? null;
  const explicitActivityMatchesTurn =
    activityStatus?.turnId != null &&
    (activeTurnId === null || activityStatus.turnId === activeTurnId);
  const effectiveActivityStatus = explicitActivityMatchesTurn ? activityStatus : null;
  const activityTurnId = effectiveActivityStatus?.turnId ?? activeTurnId;
  const activeAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.turnId === activityTurnId);
  const lastSegment = activeAssistant?.segments?.at(-1);
  const assistantIsStreaming =
    activeAssistant?.meta?.kind === "streaming" &&
    Boolean(lastSegment?.content.trim() || activeAssistant.content.trim());

  const statusKeepsTurnOpen =
    status === "running" ||
    status === "waiting_for_input" ||
    status === "waiting_for_approval" ||
    status === "waiting_for_external";
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  const explicitActivityVisible =
    !terminal &&
    effectiveActivityStatus != null &&
    (!assistantIsStreaming || status === "waiting_for_external");
  const showActivity =
    explicitActivityVisible ||
    (!terminal &&
      (status === "waiting_for_input" ||
        status === "waiting_for_approval" ||
        ((status === "running" || status === "waiting_for_external" || busy) &&
          !assistantIsStreaming)));
  const activityLabel =
    status === "waiting_for_input"
      ? labels.waitingForInput
      : status === "waiting_for_approval"
        ? labels.waitingForApproval
        : (effectiveActivityStatus?.label ?? labels.thinking);
  const activityAssistantId = showActivity ? activeAssistant?.id : undefined;
  const standaloneActivity = showActivity && !activityAssistantId;
  const waitingActivity =
    status === "waiting_for_input" ||
    status === "waiting_for_approval" ||
    effectiveActivityStatus?.mode === "waiting";

  const visibleMessages = messages.filter(
    (message) =>
      message.role === "user" ||
      message.content.trim().length > 0 ||
      message.id === activityAssistantId
  );
  const lastVisible = visibleMessages.at(-1);
  const isEmpty = visibleMessages.length === 0 && status === "idle" && !error;
  const tailId = error
    ? "timeline-error"
    : standaloneActivity
      ? "timeline-activity"
      : (activityAssistantId ?? lastVisible?.id ?? null);

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label={labels.transcript}>
          <MessageScrollerContent
            aria-busy={
              !waitingActivity &&
              ((effectiveActivityStatus != null && effectiveActivityStatus.mode !== "waiting") ||
                (!terminal && (status === "running" || status === "waiting_for_external" || busy)))
            }
            className="gap-4 px-4 py-3 pb-6"
            spacerClassName="!max-h-0"
          >
            {isEmpty ? (
              <MessageScrollerItem
                messageId="timeline-empty"
                className="flex min-h-48 flex-1 items-center justify-center px-6 text-center"
              >
                {empty}
              </MessageScrollerItem>
            ) : (
              visibleMessages.map((message) => {
                const showTurnActivity = message.id === activityAssistantId;
                return (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    className="[contain-intrinsic-size:auto_1.5rem]"
                    scrollAnchor={message.id === tailId}
                  >
                    <AgentOsMessageRow
                      message={message}
                      streamActive={
                        statusKeepsTurnOpen &&
                        message.id === activeAssistant?.id &&
                        assistantIsStreaming
                      }
                      activityLabel={showTurnActivity ? activityLabel : null}
                      activityWaiting={showTurnActivity && waitingActivity}
                      labels={labels}
                    />
                  </MessageScrollerItem>
                );
              })
            )}

            {standaloneActivity ? (
              <MessageScrollerItem
                key="timeline-activity"
                messageId="timeline-activity"
                className="[contain-intrinsic-size:auto_1.5rem]"
                scrollAnchor
              >
                <Message align="start" data-turn-id={activityTurnId ?? undefined}>
                  <MessageContent>
                    <MessageHeader className="sr-only">
                      <span>{labels.assistant}</span>
                    </MessageHeader>
                    <AgentOsActivityIndicator label={activityLabel} waiting={waitingActivity} />
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ) : null}

            {error ? (
              <MessageScrollerItem key="timeline-error" messageId="timeline-error" scrollAnchor>
                <div
                  role="alert"
                  className="flex items-start gap-2 px-1 py-1 text-xs/relaxed text-destructive/90"
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
  streamActive,
  activityLabel,
  activityWaiting,
  labels,
}: {
  message: AgentOsChatMessage;
  streamActive: boolean;
  activityLabel: string | null;
  activityWaiting: boolean;
  labels: Pick<TranscriptLabels, "user" | "assistant" | "approved" | "rejected">;
}) {
  if (message.role === "user") {
    // Current approval writers persist the exact localized display copy the
    // creator submitted. Keep the generic label only as a replay fallback for
    // old journals that projected an empty approval response.
    const content =
      message.content.trim() ||
      (message.meta?.kind === "approval_response"
        ? message.meta?.decision === "reject"
          ? labels.rejected
          : labels.approved
        : "");
    const names = Array.isArray(message.meta?.attachmentNames)
      ? (message.meta.attachmentNames as string[])
      : [];
    return (
      <Message align="end">
        <MessageContent className="gap-1.5">
          <MessageHeader className="sr-only">
            <span>{labels.user}</span>
          </MessageHeader>
          <Bubble variant="secondary" className="max-w-[88%]">
            <BubbleContent className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-white/[0.09] px-3.5 py-2.5 text-sm/relaxed text-white">
              {content || null}
              {names.length > 0 ? (
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {names.map((name, index) => (
                    <span
                      key={`${name}:${index}`}
                      className="rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] text-white/72"
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

  const segments = message.segments?.filter((segment) => segment.content.trim()) ?? [];
  return (
    <Message align="start" data-turn-id={message.turnId}>
      <MessageContent className="gap-3">
        <MessageHeader className="sr-only">
          <span>{labels.assistant}</span>
        </MessageHeader>
        {segments.length > 0 ? (
          segments.map((segment, index) => {
            const streamingSegment =
              streamActive && index === segments.length - 1 && !segment.completed;
            return (
              <Bubble key={segment.id} variant="ghost" className="max-w-full min-w-0">
                <BubbleContent className="min-w-0 max-w-full overflow-x-hidden px-0.5 text-sm/relaxed text-white">
                  <SmoothStreamMarkdown
                    target={segment.content}
                    active={streamingSegment}
                    caret={streamingSegment}
                  />
                </BubbleContent>
              </Bubble>
            );
          })
        ) : message.content.trim() ? (
          <Bubble variant="ghost" className="max-w-full min-w-0">
            <BubbleContent className="min-w-0 max-w-full overflow-x-hidden px-0.5 text-sm/relaxed text-white">
              <SmoothStreamMarkdown
                target={message.content}
                active={streamActive}
                caret={streamActive}
              />
            </BubbleContent>
          </Bubble>
        ) : null}
        {activityLabel ? (
          <AgentOsActivityIndicator label={activityLabel} waiting={activityWaiting} />
        ) : null}
      </MessageContent>
    </Message>
  );
}

/** Single ephemeral turn status. Waiting states are static because no work is executing. */
export function AgentOsActivityIndicator({
  label,
  waiting = false,
}: {
  label: string;
  waiting?: boolean;
}) {
  return (
    <Marker
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-activity-mode={waiting ? "waiting" : "working"}
      className="px-1 text-white/92"
    >
      <MarkerIcon>
        {waiting ? (
          <IconClockPause aria-hidden="true" className="size-3.5 text-white/78" stroke={1.8} />
        ) : (
          <IconLoader2
            aria-hidden="true"
            className="size-3.5 animate-spin text-white/88 motion-reduce:animate-none"
            stroke={1.8}
          />
        )}
      </MarkerIcon>
      <MarkerContent className="min-w-0 flex-1 truncate">{label}</MarkerContent>
    </Marker>
  );
}
