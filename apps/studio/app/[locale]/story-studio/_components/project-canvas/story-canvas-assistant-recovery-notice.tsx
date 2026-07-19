"use client";

import { useLocale, useTranslations } from "next-intl";
import { copilotQuotaNoticeText } from "@/components/copilot/copilot-history";
import { CopilotStatusNotice } from "@/components/copilot/copilot-status-notice";
import type { StoryCanvasAssistantSession } from "./use-story-canvas-assistant-session";

/**
 * The launcher and full assistant are two views over one conversation. Keep
 * canonical recovery state and actions here so moving between them cannot
 * change what “Retry” means.
 */
export function StoryCanvasAssistantRecoveryNotice({
  session,
  onRequestNewConversation,
}: {
  session: StoryCanvasAssistantSession;
  onRequestNewConversation: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.emptyAgent");
  const locale = useLocale();
  const conversationStatus = session.history.conversationStatus;

  if (conversationStatus === "limit_exceeded") {
    return (
      <CopilotStatusNotice
        message={t("historyLimitReached")}
        actionLabel={t("newConversation")}
        onAction={onRequestNewConversation}
      />
    );
  }

  const canRetry = conversationStatus === "failed" || conversationStatus === "aborted";
  if (!session.error && !canRetry) return null;

  // A typed 429 body renders as an honest localized notice, never as the raw
  // JSON string the AI SDK transport throws.
  const quotaNotice = session.errorQuota
    ? copilotQuotaNoticeText(session.errorQuota, (key, values) => t(key, values), locale)
    : null;

  return (
    <CopilotStatusNotice
      message={
        quotaNotice ||
        session.errorMessage ||
        (conversationStatus === "aborted" ? t("responseStopped") : t("responseFailed"))
      }
      actionLabel={canRetry ? t("retry") : undefined}
      onAction={canRetry ? () => void session.regenerate() : undefined}
    />
  );
}
