"use client";

import { useMemo, useState } from "react";
import { IconSparkles } from "@tabler/icons-react";
import {
  COPILOT_DOCUMENT_PART_TYPE,
  CopilotDocumentRefSchema,
} from "@repo/shared/copilot-documents";
import { getToolName, isToolUIPart } from "ai";
import { useTranslations } from "next-intl";
import { CopilotSidePanel } from "@/components/copilot/copilot-side-panel";
import { CopilotStatusNotice } from "@/components/copilot/copilot-status-notice";
import { CopilotTranscript } from "@/components/copilot/copilot-transcript";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StoryCanvasAssistantComposer } from "./story-canvas-assistant-composer";
import {
  StoryAgentRunCard,
  StoryAgentRunSummaryCard,
  storyAgentRunFromToolPart,
} from "./story-agent-run-card";
import { StoryCanvasAssistantRecoveryNotice } from "./story-canvas-assistant-recovery-notice";
import { StoryCanvasDocumentChip } from "./story-canvas-document-chip";
import type { StoryAgentRunController } from "./use-story-agent-run";
import type { StoryCanvasAssistantSession } from "./use-story-canvas-assistant-session";

export function StoryCanvasAssistantPanel({
  open,
  onClose,
  session,
  agentRunController,
  canManageAgentRuns = false,
}: {
  open: boolean;
  onClose: () => void;
  session: StoryCanvasAssistantSession;
  agentRunController: StoryAgentRunController;
  /** Fail closed until the active project capability has been resolved. */
  canManageAgentRuns?: boolean;
}) {
  const t = useTranslations("storyStudio.canvas.emptyAgent");
  const [resetOpen, setResetOpen] = useState(false);
  const transcriptRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (!isToolUIPart(part) || getToolName(part) !== "propose_story_patch") continue;
        const run = storyAgentRunFromToolPart(part);
        if (run) ids.add(run.id);
      }
    }
    return ids;
  }, [session.messages]);
  const pinnedActiveRun =
    agentRunController.run && !transcriptRunIds.has(agentRunController.run.id)
      ? agentRunController.run
      : null;
  const pinnedUndoableRun =
    agentRunController.undoableRun &&
    agentRunController.undoableRun.id !== agentRunController.run?.id &&
    !transcriptRunIds.has(agentRunController.undoableRun.id)
      ? agentRunController.undoableRun
      : null;
  return (
    <CopilotSidePanel
      open={open}
      title={t("assistantTitle")}
      closeLabel={t("close")}
      onClose={onClose}
      variant="docked"
      footer={
        <div className="space-y-2">
          {pinnedActiveRun ? (
            <StoryAgentRunSummaryCard
              run={pinnedActiveRun}
              controller={agentRunController}
              canManageAgentRuns={canManageAgentRuns}
            />
          ) : null}
          {pinnedUndoableRun ? (
            <StoryAgentRunSummaryCard
              run={pinnedUndoableRun}
              controller={agentRunController}
              canManageAgentRuns={canManageAgentRuns}
            />
          ) : null}
          {session.recoveryStorageError ? (
            <CopilotStatusNotice message={t("recoveryStorageError")} />
          ) : null}
          <StoryCanvasAssistantRecoveryNotice
            session={session}
            onRequestNewConversation={() => setResetOpen(true)}
          />
          {session.recoveredMessage ? (
            <CopilotStatusNotice
              message={t("messagePreserved")}
              dismissLabel={t("discardPreservedMessage")}
              onDismiss={() => session.discardRecoveredMessage()}
              actionLabel={
                session.history.conversationStatus === "ready" ||
                session.history.conversationStatus === "failed" ||
                session.history.conversationStatus === "aborted"
                  ? t("retryPreservedMessage")
                  : undefined
              }
              onAction={
                session.history.conversationStatus === "ready" ||
                session.history.conversationStatus === "failed" ||
                session.history.conversationStatus === "aborted"
                  ? () => void session.retryRecoveredMessage()
                  : undefined
              }
            />
          ) : null}
          {session.history.status !== "ready" ? (
            <CopilotStatusNotice
              message={
                session.history.status === "loading"
                  ? t("historyLoading")
                  : session.history.error?.message || t("historyError")
              }
              actionLabel={session.history.status === "error" ? t("retryHistory") : undefined}
              onAction={
                session.history.status === "error" ? () => void session.history.retry() : undefined
              }
            />
          ) : null}
          <StoryCanvasAssistantComposer
            session={session}
            onSubmit={() => void session.submit()}
            placeholder={t("panelPlaceholder")}
            autoFocus
            disabled={agentRunController.applying}
          />
          <Dialog open={resetOpen} onOpenChange={setResetOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto flex text-xs text-muted-foreground"
                disabled={session.busy || session.history.resetting}
              >
                {t("newConversation")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("newConversationTitle")}</DialogTitle>
                <DialogDescription>{t("newConversationDescription")}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    {t("cancelNewConversation")}
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={session.history.resetting}
                  onClick={async () => {
                    if (await session.startNewConversation()) setResetOpen(false);
                  }}
                >
                  {t("confirmNewConversation")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      <CopilotTranscript
        messages={session.messages}
        status={session.status}
        assistantLabel="FizzDragon"
        userLabel={t("you")}
        thinkingLabel={t("thinking")}
        transcriptLabel={t("transcriptLabel")}
        scrollToLatestLabel={t("scrollToLatest")}
        renderNonTextPart={(part, key) => {
          if (isToolUIPart(part) && getToolName(part) === "propose_story_patch") {
            return (
              <StoryAgentRunCard
                key={key}
                part={part}
                controller={agentRunController}
                canManageAgentRuns={canManageAgentRuns}
              />
            );
          }
          if (part.type === COPILOT_DOCUMENT_PART_TYPE && "data" in part) {
            const reference = CopilotDocumentRefSchema.safeParse(part.data);
            if (reference.success) {
              return (
                <div key={key} className="flex max-w-[88%] justify-end">
                  <StoryCanvasDocumentChip
                    name={reference.data.name}
                    sizeBytes={reference.data.sizeBytes}
                    ariaLabel={t("attachedDocument")}
                  />
                </div>
              );
            }
          }
          return null;
        }}
        empty={
          <div className="flex max-w-[17rem] flex-col items-center gap-2 text-center">
            <IconSparkles className="size-7 text-white/24" stroke={1.5} />
            <p className="text-sm leading-6 text-muted-foreground">{t("panelEmpty")}</p>
          </div>
        }
      />
    </CopilotSidePanel>
  );
}
