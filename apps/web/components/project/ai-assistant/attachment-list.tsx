import { IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch } from "@/src/store";
import { removeAttachment, retryAttachment } from "@/src/store/slices/assistantSlice";
import type { AssistantAttachment } from "@/src/lib/assistant/assistant-types";
import { formatFileSize, isImageMime } from "./sub-components";

interface AttachmentListProps {
  projectId: string | null;
  attachments: AssistantAttachment[];
}

export function AttachmentList({ projectId, attachments }: AttachmentListProps) {
  const t = useTranslations("ai");
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();

  if (attachments.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex max-w-full items-center gap-2 rounded-2xl border border-border/70 bg-muted/30 px-2.5 py-2"
        >
          {isImageMime(attachment.mimeType) && attachment.previewUrl ? (
            <img
              src={attachment.previewUrl}
              alt={attachment.name}
              className="size-10 rounded-lg object-cover"
            />
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{attachment.name}</div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{formatFileSize(attachment.size)}</span>
              {attachment.status === "uploading" ? (
                <span className="inline-flex items-center gap-1">
                  <IconLoader2 className="size-3 animate-spin" />
                  {t("uploading")}
                </span>
              ) : attachment.status === "error" ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-destructive hover:text-destructive/80"
                  onClick={() =>
                    projectId &&
                    void dispatch(retryAttachment({ projectId, attachmentId: attachment.id }))
                  }
                >
                  <IconRefresh className="size-3" />
                  {tc("retry")}
                </button>
              ) : (
                <span>{t("uploaded")}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() =>
              projectId && dispatch(removeAttachment({ projectId, attachmentId: attachment.id }))
            }
          >
            <IconX className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
