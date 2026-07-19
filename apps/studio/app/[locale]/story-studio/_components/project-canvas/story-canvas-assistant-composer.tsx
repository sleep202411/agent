"use client";

import { useRef } from "react";
import { IconPaperclip, IconSparkles, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { COPILOT_DOCUMENT_EXTENSIONS } from "@repo/shared/copilot-documents";
import { CopilotComposer } from "@/components/copilot/copilot-composer";
import { STORY_CANVAS_DIRECTING_SKILLS } from "./story-canvas-skill-catalog";
import { StoryCanvasDocumentChip } from "./story-canvas-document-chip";
import type { StoryCanvasAssistantSession } from "./use-story-canvas-assistant-session";

const ACCEPTED_EXTENSIONS = COPILOT_DOCUMENT_EXTENSIONS.join(",");

export function StoryCanvasAssistantComposer({
  session,
  placeholder,
  onSubmit,
  autoFocus = false,
  className,
  disabled = false,
}: {
  session: StoryCanvasAssistantSession;
  placeholder: string;
  onSubmit: () => void;
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("storyStudio.canvas.emptyAgent");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedSkill = STORY_CANVAS_DIRECTING_SKILLS.find(
    (skill) => skill.key === session.selectedSkillKey
  );
  const selectedSkillName = selectedSkill ? t(`skills.${selectedSkill.copyKey}.title`) : null;
  const historyReady =
    session.recoveryReady &&
    session.history.status === "ready" &&
    session.history.conversationStatus === "ready";

  const attachmentErrorMessage = session.attachmentError
    ? {
        unsupported: t("attachmentUnsupported"),
        tooLarge: t("attachmentTooLarge"),
        uploadFailed: t("attachmentUploadFailed"),
      }[session.attachmentError]
    : null;

  return (
    <CopilotComposer
      value={session.draft}
      onChange={session.setDraft}
      onSubmit={onSubmit}
      onStop={session.stop}
      busy={session.busy}
      sendDisabled={disabled || !historyReady || session.attachmentUploading}
      canSendWithoutText={session.attachment !== null}
      placeholder={placeholder}
      inputLabel={t("inputLabel")}
      sendLabel={t("send")}
      stopLabel={t("stop")}
      autoFocus={autoFocus}
      className={className}
      attachmentBar={
        session.attachment || attachmentErrorMessage ? (
          <div className="flex min-w-0 flex-col gap-1">
            {session.attachment ? (
              <div className="flex min-w-0">
                <StoryCanvasDocumentChip
                  name={session.attachment.name}
                  sizeBytes={session.attachment.size}
                  uploading={session.attachmentUploading}
                  onRemove={session.removeAttachment}
                  removeLabel={t("removeAttachment")}
                  ariaLabel={t("attachedDocument")}
                />
              </div>
            ) : null}
            {attachmentErrorMessage ? (
              <p role="alert" className="text-xs leading-4 text-destructive">
                {attachmentErrorMessage}
              </p>
            ) : null}
          </div>
        ) : null
      }
      leadingAction={
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            data-testid="story-canvas-document-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) session.attachDocument(file);
              // Allow re-selecting the same file after removal.
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || session.busy || session.attachmentUploading}
            aria-label={t("attachDocument")}
            className="grid size-10 shrink-0 place-items-center rounded-2xl text-white/45 transition hover:bg-white/[0.06] hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-40"
          >
            <IconPaperclip className="size-4.5" stroke={1.8} />
          </button>
        </>
      }
      inlineTokens={
        selectedSkill && selectedSkillName ? (
          <span className="inline-flex max-w-full shrink-0 items-center gap-1 text-[11px] font-medium text-[#5b9dff]">
            <IconSparkles className="size-3.5 shrink-0" stroke={1.8} aria-hidden="true" />
            <span className="max-w-48 truncate text-[#5b9dff]/85">
              {t("activeSkill", { name: selectedSkillName })}
            </span>
            <button
              type="button"
              onClick={() => session.setSelectedSkillKey(null)}
              aria-label={t("removeSkill", { name: selectedSkillName })}
              className="grid size-4.5 shrink-0 place-items-center text-[#5b9dff]/55 transition-colors hover:text-[#5b9dff] focus-visible:ring-2 focus-visible:ring-[#5b9dff]/45 focus-visible:outline-none"
            >
              <IconX className="size-3" stroke={1.8} />
            </button>
          </span>
        ) : null
      }
    />
  );
}
