"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { StudioAgentPermissionMode } from "@repo/shared";
import { IconFileDescription } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import {
  STUDIO_AGENT_ATTACHMENT_ACCEPT,
  STUDIO_AGENT_ATTACHMENT_MEDIA_TYPES,
  STUDIO_AGENT_DOCUMENT_MAX_SIZE_BYTES,
  STUDIO_AGENT_DOCUMENT_MEDIA_TYPES,
  STUDIO_AGENT_IMAGE_MAX_SIZE_BYTES,
  StudioAgentApprovalSurface,
  StudioAgentChildRuns,
  StudioAgentComposer,
  StudioAgentMarkdown,
  StudioAgentPermissionMenu,
  StudioAgentSurface,
  StudioAgentTimeline,
  formatStudioAgentFileSize,
  useStudioAgentComposerAttachments,
} from "@/components/studio-agent";
import {
  selectStudioAgentChildRuns,
  selectStudioAgentTimeline,
  type StudioAgentDeliveryMode,
  type StudioAgentMessageView,
  type StudioAgentRunStatus,
} from "@/lib/studio-agent";
import { cn } from "@/lib/utils";

import { useStoryStudioAgent } from "./use-story-studio-agent";

const PERMISSION_MODES: readonly StudioAgentPermissionMode[] = ["ask", "smart", "full"];

/**
 * Story Studio adapter for the product-neutral Studio Agent surface.
 *
 * The runtime session stays mounted while the panel is closed. The surface is
 * an absolute overlay, so opening StoryOS never changes React Flow's viewport
 * dimensions or canvas transform.
 */
export function StoryCanvasAssistantLayer({
  projectId,
  chapterId,
  workspaceId,
  open,
  onOpenChange,
  suspended = false,
  children,
}: {
  projectId: string;
  chapterId: string | null;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keeps this canvas mounted while a deeper authoring canvas is active. */
  suspended?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations("storyStudio.canvas.studioAgent");
  const session = useStoryStudioAgent({ projectId, chapterId, workspaceId });
  const [draft, setDraft] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<StudioAgentDeliveryMode>("send");
  const attachmentQueue = useStudioAgentComposerAttachments({
    upload: (file, context) => session.uploadAttachment(file, context),
    uploadFailedMessage: t("composer.attachments.failed"),
    validateFile(file) {
      if (file.size === 0) return t("composer.attachments.emptyFile");
      if (!STUDIO_AGENT_ATTACHMENT_MEDIA_TYPES.some((mediaType) => mediaType === file.type)) {
        return t("composer.attachments.unsupportedType");
      }
      const maximum = STUDIO_AGENT_DOCUMENT_MEDIA_TYPES.some((mediaType) => mediaType === file.type)
        ? STUDIO_AGENT_DOCUMENT_MAX_SIZE_BYTES
        : STUDIO_AGENT_IMAGE_MAX_SIZE_BYTES;
      if (file.size > maximum) {
        return t("composer.attachments.tooLarge", {
          maxSize: formatStudioAgentFileSize(maximum),
        });
      }
      if (!file.name.trim() || file.name.length > 255) {
        return t("composer.attachments.fileNameTooLong");
      }
      return null;
    },
  });
  const clearAttachments = attachmentQueue.clear;

  useEffect(() => {
    clearAttachments();
  }, [chapterId, clearAttachments, projectId, workspaceId]);
  const timeline = useMemo(
    () => selectStudioAgentTimeline(session.eventState),
    [session.eventState]
  );
  const childRuns = useMemo(
    () =>
      session.activeRun ? selectStudioAgentChildRuns(session.eventState, session.activeRun.id) : [],
    [session.activeRun, session.eventState]
  );
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

  return (
    <div
      aria-hidden={suspended ? true : undefined}
      inert={suspended ? true : undefined}
      className={cn(
        "relative h-full w-full origin-center transition-[opacity,transform] duration-300 ease-out",
        suspended && "pointer-events-none scale-[0.985] opacity-0"
      )}
    >
      {children}
      <StudioAgentSurface
        open={open && !suspended}
        title={t("title")}
        labels={{
          surface: t("surface"),
          close: t("close"),
        }}
        busy={session.status === "loading" || session.isRunning}
        onOpenChange={onOpenChange}
        composer={
          <div className="space-y-2">
            {session.commandError || (session.streamStatus === "closed" && session.streamError) ? (
              <div
                role="alert"
                className="flex items-start gap-2 px-2 text-[11px]/relaxed text-destructive/86"
              >
                <span className="min-w-0 flex-1">
                  {session.commandError?.message ?? session.streamError?.message}
                </span>
                {session.streamStatus === "closed" && session.streamError ? (
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
              value={draft}
              deliveryMode={deliveryMode}
              isRunning={session.isRunning}
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
              disabled={
                session.status !== "ready" ||
                !session.thread ||
                (session.streamStatus === "closed" && session.streamError !== null)
              }
              labels={{
                input: t("composer.input"),
                placeholder: t("composer.placeholder"),
                stop: t("composer.stop"),
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
                items: attachmentQueue.items,
                accept: STUDIO_AGENT_ATTACHMENT_ACCEPT,
                onAddFiles: attachmentQueue.addFiles,
                onRetry: attachmentQueue.retry,
                onRemove: attachmentQueue.remove,
              }}
              chips={
                childRuns.length > 0 ? (
                  <StudioAgentChildRuns
                    runs={childRuns}
                    labels={{
                      group: t("childRuns.group"),
                      status: runStatusLabels,
                    }}
                  />
                ) : null
              }
              onDeliveryModeChange={setDeliveryMode}
              onValueChange={setDraft}
              onStop={() => runCommand(session.cancelActiveRun(t("composer.cancelReason")))}
              onSubmit={async (text, selectedMode, attachments) => {
                try {
                  await attachmentQueue.deliver(attachments, () =>
                    session.submit(text, selectedMode, attachments).then((submitted) => {
                      if (!submitted) {
                        throw new Error("The Studio Agent submission was not accepted.");
                      }
                    })
                  );
                  setDraft("");
                } catch {
                  // The session keeps the draft and exposes the upstream error
                  // inline. Swallow here so the form never creates an
                  // unhandled rejected promise.
                }
              }}
            />
          </div>
        }
      >
        <StudioAgentTimeline
          items={timeline}
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
              semantic: {
                "studio_agent.activity.generating_response": t(
                  "activity.labels.generatingResponse"
                ),
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
          renderContextCompaction={(compaction) => (
            <div
              title={`${compaction.coveredMessageCount} → ${compaction.retainedMessageCount}`}
              className="flex min-h-7 items-center gap-2 px-1.5 text-xs text-white/48"
            >
              <IconFileDescription aria-hidden="true" className="size-3.5 shrink-0" />
              <span>{t("timeline.contextCompacted")}</span>
            </div>
          )}
          renderApproval={(approval) => (
            <StudioAgentApprovalSurface
              approval={approval}
              resolving={session.resolvingApprovalIds.has(approval.id)}
              allowPersistentApproval={approval.capabilityVersion !== null}
              labels={{
                capability: t("approval.capability"),
                approveOnce: t("approval.approveOnce"),
                approveAlways: t("approval.approveAlways"),
                reject: t("approval.reject"),
                status: {
                  pending: t("approval.status.pending"),
                  approved: t("approval.status.approved"),
                  denied: t("approval.status.denied"),
                  expired: t("approval.status.expired"),
                  cancelled: t("approval.status.cancelled"),
                },
                risk: {
                  low: t("approval.risk.low"),
                  medium: t("approval.risk.medium"),
                  high: t("approval.risk.high"),
                  critical: t("approval.risk.critical"),
                },
              }}
              onApprove={(scope) =>
                runCommand(session.resolveApproval(approval.id, "approved", scope === "always"))
              }
              onReject={() => runCommand(session.resolveApproval(approval.id, "denied", false))}
            />
          )}
        />
      </StudioAgentSurface>
    </div>
  );
}

function renderMessage(message: StudioAgentMessageView): ReactNode {
  if (!message.text) return null;
  if (message.format === "markdown") {
    return <StudioAgentMarkdown>{message.text}</StudioAgentMarkdown>;
  }
  return <p className="whitespace-pre-wrap break-words">{message.text}</p>;
}
