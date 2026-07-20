"use client";

import type { ReactNode } from "react";
import { isTextUIPart, type ChatStatus, type UIMessage } from "ai";
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
import { CopilotMarkdown } from "./copilot-markdown";

type MessagePart = UIMessage["parts"][number];

/**
 * Whether a part is something the transcript actually shows. Non-empty text
 * and tool parts count; a still-streaming reasoning trace or an empty text
 * shell does not, so the thinking marker stays up until real output lands.
 */
function isVisiblePart(part: MessagePart): boolean {
  if (isTextUIPart(part)) return Boolean(part.text?.trim());
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

export function CopilotTranscript({
  messages,
  status,
  assistantLabel,
  userLabel,
  thinkingLabel,
  transcriptLabel,
  scrollToLatestLabel,
  empty,
  renderNonTextPart,
}: {
  messages: UIMessage[];
  status: ChatStatus;
  assistantLabel: string;
  userLabel: string;
  thinkingLabel: string;
  transcriptLabel: string;
  scrollToLatestLabel: string;
  empty: ReactNode;
  renderNonTextPart?: (part: MessagePart, key: string) => ReactNode;
}) {
  // Keep the thinking marker up until the assistant produces something to
  // show. A reasoning model streams a long SILENT phase where status is
  // already "streaming" but no visible part has arrived — without this, the
  // panel goes blank between send and first token.
  const lastMessage = messages.at(-1);
  const assistantHasVisibleContent =
    lastMessage?.role === "assistant" && lastMessage.parts.some(isVisiblePart);
  const showThinking =
    status === "submitted" || (status === "streaming" && !assistantHasVisibleContent);
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <MessageScroller>
        <MessageScrollerViewport aria-label={transcriptLabel}>
          <MessageScrollerContent
            aria-busy={status === "submitted" || status === "streaming"}
            className="gap-4 px-4 py-4"
          >
            {messages.length === 0 ? (
              <MessageScrollerItem className="flex min-h-full items-center justify-center">
                {empty}
              </MessageScrollerItem>
            ) : (
              messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <Message align={message.role === "user" ? "end" : "start"}>
                    <MessageContent className="gap-1.5">
                      <MessageHeader>
                        {message.role === "user" ? userLabel : assistantLabel}
                      </MessageHeader>
                      {message.parts.map((part, index) => {
                        const key = `${message.id}:${index}`;
                        if (isTextUIPart(part)) {
                          if (!part.text) return null;
                          const isUser = message.role === "user";
                          return (
                            <Bubble
                              key={key}
                              variant={isUser ? "secondary" : "ghost"}
                              className={cn(isUser ? "max-w-[88%]" : "max-w-full")}
                            >
                              <BubbleContent
                                className={cn(
                                  "text-sm leading-6 text-foreground/88",
                                  isUser &&
                                    "whitespace-pre-wrap rounded-2xl bg-white/[0.08] px-3.5 py-2 text-foreground"
                                )}
                              >
                                {isUser ? (
                                  part.text
                                ) : (
                                  <CopilotMarkdown>{part.text}</CopilotMarkdown>
                                )}
                              </BubbleContent>
                            </Bubble>
                          );
                        }
                        return renderNonTextPart?.(part, key) ?? null;
                      })}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))
            )}
            {showThinking ? (
              <MessageScrollerItem>
                <Marker role="status" className="px-1">
                  <MarkerIcon>
                    <span className="block size-1.5 animate-pulse rounded-full bg-white/60" />
                  </MarkerIcon>
                  <MarkerContent>{thinkingLabel}</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end" label={scrollToLatestLabel} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
