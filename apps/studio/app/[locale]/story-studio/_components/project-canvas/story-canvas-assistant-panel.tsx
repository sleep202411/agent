"use client";

import { useMemo, type ReactNode, type RefObject } from "react";
import { IconClockExclamation } from "@tabler/icons-react";
import type { StudioAgentPermissionMode } from "@repo/shared";
import { useTranslations } from "next-intl";

import {
  STUDIO_AGENT_ATTACHMENT_ACCEPT,
  StudioAgentChildRuns,
  StudioAgentComposer,
  StudioAgentMarkdown,
  StudioAgentPermissionMenu,
  StudioAgentSurface,
  StudioAgentTimeline,
  StudioAgentToolApproval,
  StudioAgentTurnFailure,
  formatStudioAgentFileSize,
  studioAgentTurnFailureKind,
  type StudioAgentComposerAttachmentQueue,
  type StudioAgentTurnFailureAction,
  type StudioAgentTurnFailureLabels,
} from "@/components/studio-agent";
import type {
  StudioAgentDeliveryMode,
  StudioAgentMessageView,
  StudioAgentRunStatus,
  StudioAgentTimelineItemView,
} from "@/lib/studio-agent";

import type { StoryStudioAgentSession } from "./use-story-studio-agent";

const PERMISSION_MODES: readonly StudioAgentPermissionMode[] = ["ask", "smart", "full"];

/**
 * Composer state the panel does not own.
 *
 * The draft, the delivery mode and the upload queue outlive a connect /
 * disconnect cycle — the panel is remounted when the grant resolves, and a
 * creator who was mid-sentence must not lose it.
 */
export interface StoryCanvasAssistantComposerState {
  draft: string;
  onDraftChange: (value: string) => void;
  deliveryMode: StudioAgentDeliveryMode;
  onDeliveryModeChange: (mode: StudioAgentDeliveryMode) => void;
  /** Held by the layer so the failure notice can put the caret where it acts. */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  queue: StudioAgentComposerAttachmentQueue;
}

/**
 * The StoryOS panel itself.
 *
 * Rendered identically whether the conversation is live or the grant is still
 * in flight — the only difference is the session it is handed, and a
 * disconnected session refuses every write. Keeping one component means the
 * transcript, the composer geometry and the failure surface cannot drift
 * between the two states.
 */
export function StoryCanvasAssistantPanel({
  session,
  open,
  onOpenChange,
  composer,
}: {
  session: StoryStudioAgentSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  composer: StoryCanvasAssistantComposerState;
}) {
  const t = useTranslations("storyStudio.canvas.studioAgent");

  const turnFailure = session.turnFailure;
  const failedTurnPrompt = useMemo(
    () => (turnFailure ? selectFailedPrompt(session.timeline, turnFailure.id) : null),
    [session.timeline, turnFailure]
  );

  const turnFailureLabels: StudioAgentTurnFailureLabels = {
    region: t("turnFailure.region"),
    code: t("turnFailure.code"),
    issues: t("turnFailure.issues"),
    title: {
      inputRejected: t("turnFailure.title.inputRejected"),
      notRecorded: t("turnFailure.title.notRecorded"),
      failed: t("turnFailure.title.failed"),
    },
    explanation: {
      inputRejected: t("turnFailure.explanation.inputRejected"),
      notRecorded: t("turnFailure.explanation.notRecorded"),
      failed: t("turnFailure.explanation.failed"),
    },
  };
  const runStatusLabels: Record<StudioAgentRunStatus, string> = {
    queued: t("runStatus.queued"),
    running: t("runStatus.running"),
    waiting_for_approval: t("runStatus.waiting_for_approval"),
    waiting_for_input: t("runStatus.waiting_for_input"),
    cancelling: t("runStatus.cancelling"),
    succeeded: t("runStatus.succeeded"),
    failed: t("runStatus.failed"),
    cancelled: t("runStatus.cancelled"),
  };

  const runCommand = (command: Promise<void>) => {
    void command.catch(() => undefined);
  };

  // What the creator should actually do next, which is not the same move for
  // every terminal failure. An input rejection is the assistant's mistake and
  // the identical request deserves another attempt. A result the server could
  // not record is marked non-retryable by the code that produced it, so
  // re-sending the same wording is the one thing that cannot help: the request
  // goes back into the composer to be edited instead of fired again.
  const failureAction: StudioAgentTurnFailureAction | undefined =
    !turnFailure || !failedTurnPrompt
      ? undefined
      : studioAgentTurnFailureKind(turnFailure) === "notRecorded"
        ? {
            label: t("turnFailure.reword"),
            disabled: session.status !== "ready",
            onClick: () => {
              composer.onDraftChange(failedTurnPrompt.text);
              const input = composer.inputRef.current;
              if (!input) return;
              input.focus();
              input.setSelectionRange(input.value.length, input.value.length);
            },
          }
        : failedTurnPrompt.reproducible
          ? {
              label: t("turnFailure.retry"),
              disabled: session.submitting || session.status !== "ready",
              onClick: () =>
                runCommand(
                  session
                    .submit(failedTurnPrompt.text, "send", failedTurnPrompt.attachments)
                    .then(() => undefined)
                ),
            }
          : undefined;

  const streamClosed = session.streamStatus === "closed" && session.streamError !== null;

  return (
    <StudioAgentSurface
      open={open}
      title={t("title")}
      labels={{
        surface: t("surface"),
        close: t("close"),
        newConversation: t("newConversation"),
      }}
      onNewConversation={session.thread ? () => void session.startNewConversation() : undefined}
      busy={session.status === "loading" || session.isRunning}
      onOpenChange={onOpenChange}
      composer={
        <div className="space-y-2">
          {turnFailure ? (
            <StudioAgentTurnFailure
              failure={turnFailure}
              labels={turnFailureLabels}
              action={failureAction}
            />
          ) : null}
          {/*
            THE SPINNER IS NOT AN ANSWER.
            Every other unstick depends on someone publishing something; a worker
            that dies publishes nothing, and until this notice existed the panel
            span until reload. It is deliberately NOT a failure row: the turn may
            still be alive, so this states the fact and offers the one action
            that helps, rather than declaring a terminal nobody recorded.
          */}
          {session.stalled ? (
            <div
              role="status"
              aria-label={t("stall.region")}
              className="flex items-start gap-2 rounded-2xl bg-white/[0.035] px-3 py-2.5 text-[11px]/relaxed text-white/62"
            >
              <IconClockExclamation
                aria-hidden="true"
                className="mt-px size-3.5 shrink-0 text-white/44"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-white/86">{t("stall.title")}</span>
                {t("stall.explanation")}
              </span>
              {session.isRunning && !session.cancelling ? (
                <button
                  type="button"
                  onClick={() => runCommand(session.cancelActiveRun())}
                  className="shrink-0 font-medium text-white/60 transition-colors hover:text-white/90"
                >
                  {t("stall.stop")}
                </button>
              ) : null}
            </div>
          ) : null}
          {session.commandError || streamClosed ? (
            <div
              role="alert"
              className="flex items-start gap-2 px-2 text-[11px]/relaxed text-destructive/86"
            >
              <span className="min-w-0 flex-1">
                {session.commandError?.message ?? session.streamError?.message}
              </span>
              {streamClosed ? (
                // A closed stream disables the composer, so the only escape is
                // to rebuild the session — offer it inline instead of leaving
                // the user stuck with a locked composer until a full reload.
                <button
                  type="button"
                  onClick={session.retry}
                  className="shrink-0 font-medium text-white/60 transition-colors hover:text-white/90"
                >
                  {t("retry")}
                </button>
              ) : session.commandError ? (
                <button
                  type="button"
                  onClick={session.clearCommandError}
                  className="shrink-0 text-white/40 transition-colors hover:text-white/76"
                >
                  {t("dismissError")}
                </button>
              ) : null}
            </div>
          ) : null}
          <StudioAgentComposer
            value={composer.draft}
            inputRef={composer.inputRef}
            deliveryMode={composer.deliveryMode}
            isRunning={session.isRunning}
            isCancelling={session.cancelling}
            isSubmitting={session.submitting}
            queuedCount={session.queuedCount}
            permission={
              session.thread ? (
                <StudioAgentPermissionMenu
                  value={session.thread.permissionPolicy.mode}
                  disabled={session.policyUpdating}
                  labels={{ menu: t("permission.menu") }}
                  options={PERMISSION_MODES.map((value) => ({
                    value,
                    label: t(`permission.options.${value}.label`),
                    description: t(`permission.options.${value}.description`),
                  }))}
                  onValueChange={(value) => runCommand(session.updatePermissionMode(value))}
                />
              ) : null
            }
            disabled={session.status !== "ready" || !session.thread || streamClosed}
            labels={{
              input: t("composer.input"),
              placeholder: t("composer.placeholder"),
              stop: t("composer.stop"),
              stopping: t("composer.stopping"),
              queued: (count) => t("composer.queued", { count }),
              deliveryModeMenu: t("composer.deliveryModeMenu"),
              deliveryMode: {
                send: {
                  label: t("composer.delivery.send.label"),
                  description: t("composer.delivery.send.description"),
                },
                steer: {
                  label: t("composer.delivery.steer.label"),
                  description: t("composer.delivery.steer.description"),
                },
                enqueue: {
                  label: t("composer.delivery.enqueue.label"),
                  description: t("composer.delivery.enqueue.description"),
                },
                stop_and_send: {
                  label: t("composer.delivery.stopAndSend.label"),
                  description: t("composer.delivery.stopAndSend.description"),
                },
              },
              attachments: {
                add: t("composer.attachments.add"),
                drop: t("composer.attachments.drop"),
                remove: (fileName) => t("composer.attachments.remove", { fileName }),
                retry: (fileName) => t("composer.attachments.retry", { fileName }),
                uploading: (progress) => t("composer.attachments.uploading", { progress }),
                processing: t("composer.attachments.processing"),
                ready: t("composer.attachments.ready"),
                failed: t("composer.attachments.failed"),
                fileSize: formatStudioAgentFileSize,
              },
            }}
            attachments={{
              items: composer.queue.items,
              accept: STUDIO_AGENT_ATTACHMENT_ACCEPT,
              onAddFiles: composer.queue.addFiles,
              onRetry: composer.queue.retry,
              onRemove: composer.queue.remove,
            }}
            chips={
              session.childRuns.length > 0 ? (
                <StudioAgentChildRuns
                  runs={session.childRuns}
                  labels={{
                    group: t("childRuns.group"),
                    status: runStatusLabels,
                  }}
                />
              ) : null
            }
            onDeliveryModeChange={composer.onDeliveryModeChange}
            onValueChange={composer.onDraftChange}
            onStop={() => runCommand(session.cancelActiveRun())}
            onSubmit={async (text, selectedMode, attachments) => {
              // Cleared BEFORE the await, and put back only if the send is
              // refused. `session.submit` awaits `sendMessage`, which the AI SDK
              // does not settle until the WHOLE reply has finished streaming —
              // so clearing afterwards left the creator's prompt sitting in the
              // box for the entire turn, beside its own echo in the transcript.
              composer.onDraftChange("");
              try {
                await composer.queue.deliver(attachments, () =>
                  session.submit(text, selectedMode, attachments).then((submitted) => {
                    if (!submitted) {
                      throw new Error("The Studio Agent submission was not accepted.");
                    }
                  })
                );
              } catch {
                // Nothing was sent, so nothing may be lost: hand the text back.
                // The session exposes the upstream error inline; swallowing here
                // is what keeps the form from creating an unhandled rejection.
                composer.onDraftChange(text);
              }
            }}
          />
        </div>
      }
    >
      <StudioAgentTimeline
        items={session.timeline}
        busy={session.status === "loading" || session.isRunning}
        earlier={{
          hasMore: session.hasEarlierTurns,
          loading: session.loadingEarlierTurns,
          onLoad: () => runCommand(session.loadEarlierTurns()),
        }}
        labels={{
          log: t("timeline.log"),
          empty: t("timeline.empty"),
          scrollToLatest: t("timeline.scrollToLatest"),
          loadEarlier: t("timeline.loadEarlier"),
          loadingEarlier: t("timeline.loadingEarlier"),
          messageRole: {
            user: t("timeline.roles.user"),
            assistant: t("timeline.roles.assistant"),
          },
          runStatus: {
            failed: runStatusLabels.failed,
            cancelled: runStatusLabels.cancelled,
          },
          attachment: {
            status: {
              processing: t("timeline.attachments.status.processing"),
              ready: t("timeline.attachments.status.ready"),
              failed: t("timeline.attachments.status.failed"),
            },
            unknownSize: t("timeline.attachments.unknownSize"),
            fileSize: formatStudioAgentFileSize,
          },
          activity: {
            expand: t("activity.expand"),
            collapse: t("activity.collapse"),
            // Semantic keys only. An activity whose label is already a
            // sentence (a snapshot row the worker localized at execution time)
            // falls through and renders verbatim.
            semantic: {
              "studio_agent.activity.generating_response": t("activity.labels.generatingResponse"),
            },
            status: {
              running: t("activity.status.running"),
              succeeded: t("activity.status.succeeded"),
              failed: t("activity.status.failed"),
              cancelled: t("activity.status.cancelled"),
            },
          },
        }}
        empty={
          session.status === "error" && session.error ? (
            <div role="alert" className="max-w-72">
              <p>{session.error.message}</p>
              <button
                type="button"
                onClick={session.retry}
                className="mt-3 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-white/72 transition-colors hover:bg-white/[0.11] hover:text-white"
              >
                {t("retry")}
              </button>
            </div>
          ) : session.status === "loading" ? (
            t("timeline.loading")
          ) : (
            t("timeline.empty")
          )
        }
        renderMessage={renderMessage}
        renderToolApproval={(approval) => (
          <StudioAgentToolApproval
            approval={approval}
            disabled={session.status !== "ready" || streamClosed}
            labels={{
              title: (toolName) => t("toolApproval.title", { toolName }),
              approve: t("toolApproval.approve"),
              deny: t("toolApproval.deny"),
              showInput: t("toolApproval.showInput"),
              hideInput: t("toolApproval.hideInput"),
              resuming: t("toolApproval.resuming"),
              decision: {
                approved: t("toolApproval.decision.approved"),
                denied: t("toolApproval.decision.denied"),
              },
            }}
            onRespond={(approved) =>
              runCommand(session.respondToToolApproval(approval.id, approved))
            }
          />
        )}
      />
    </StudioAgentSurface>
  );
}

/**
 * The message a failed turn was asked to carry out.
 *
 * A turn's own trigger message carries its `runId`; a turn started from a
 * queued input does not, so the newest creator message is the fallback. The
 * timeline is already in conversation order, so "newest" is the last one — no
 * timestamp sort, and none available: a message that streamed in has only the
 * position the transport gave it.
 *
 * `reproducible` is the stricter half: re-sending is only offered when the
 * request can be reproduced exactly, because a prompt whose attachments are no
 * longer `ready` would resend as a different request. Handing the text back for
 * the creator to edit has no such requirement — they see and own whatever they
 * send next.
 */
export function selectFailedPrompt(
  timeline: readonly StudioAgentTimelineItemView[],
  failedRunId: string
): {
  text: string;
  attachments: StudioAgentMessageView["attachments"];
  reproducible: boolean;
} | null {
  const prompts = timeline.flatMap((item) =>
    item.kind === "message" && item.message.role === "user" ? [item.message] : []
  );
  const prompt =
    [...prompts].reverse().find((message) => message.runId === failedRunId) ?? prompts.at(-1);
  if (!prompt) return null;
  if (!prompt.text.trim() && prompt.attachments.length === 0) return null;
  return {
    text: prompt.text,
    attachments: prompt.attachments,
    reproducible: prompt.attachments.every((attachment) => attachment.status === "ready"),
  };
}

function renderMessage(message: StudioAgentMessageView): ReactNode {
  if (!message.text) return null;
  if (message.format === "markdown") {
    return <StudioAgentMarkdown>{message.text}</StudioAgentMarkdown>;
  }
  return <p className="whitespace-pre-wrap break-words">{message.text}</p>;
}
