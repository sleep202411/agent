"use client";

import { useRef } from "react";
import { IconLoader2, IconPlus, IconSend } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch } from "@/src/store";
import { addAttachments } from "@/src/store/slices/assistantSlice";
import { MAX_ATTACHMENTS } from "./constants";

interface ChatToolbarProps {
  projectId: string | null;
  draftInput: string;
  attachmentsCount: number;
  sending: boolean;
  hasPendingTools: boolean;
  hasUploadingAttachments: boolean;
  /** When true, block sending — project-params form upstream must be filled first. */
  blocked?: boolean;
  /** Composer-owned send handler. Gates a confirmation dialog when a
   *  workflow chip is selected before dispatching sendUserMessage. */
  onSend: () => void;
}

export function ChatToolbar({
  projectId,
  draftInput,
  attachmentsCount,
  sending,
  hasPendingTools,
  hasUploadingAttachments,
  blocked,
  onSend,
}: ChatToolbarProps) {
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (projectId && files.length > 0) {
            void dispatch(addAttachments({ projectId, files, t: tc }));
          }
          event.currentTarget.value = "";
        }}
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          color="muted"
          size="icon-xs"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || !projectId || attachmentsCount >= MAX_ATTACHMENTS}
        >
          <IconPlus className="size-4" />
        </Button>

        <Button
          size="icon-sm"
          onClick={() => {
            if (projectId && !hasPendingTools && !blocked) onSend();
          }}
          disabled={
            sending ||
            hasPendingTools ||
            hasUploadingAttachments ||
            !projectId ||
            !draftInput.trim() ||
            Boolean(blocked)
          }
        >
          {sending ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconSend className="size-4" />
          )}
        </Button>
      </div>
    </>
  );
}
