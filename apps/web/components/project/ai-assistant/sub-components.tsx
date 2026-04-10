import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { AssistantAttachment } from "@/src/lib/assistant/assistant-types";

// ─── Helpers ───────────────────────────────────────────

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageMime(mimeType?: string) {
  return Boolean(mimeType?.startsWith("image/"));
}

export function getFileTypeKey(mimeType?: string, name?: string): string {
  const ext = name?.split(".").pop()?.toLowerCase();
  if (ext === "docx" || ext === "doc" || mimeType?.includes("wordprocessingml"))
    return "fileTypeWord";
  if (ext === "pdf" || mimeType === "application/pdf") return "fileTypePdf";
  if (ext === "txt" || mimeType === "text/plain") return "fileTypeText";
  if (ext === "xlsx" || mimeType?.includes("spreadsheetml")) return "fileTypeExcel";
  if (ext === "pptx" || mimeType?.includes("presentationml")) return "fileTypePpt";
  if (mimeType?.startsWith("image/")) return "fileTypeImage";
  if (mimeType?.startsWith("video/")) return "fileTypeVideo";
  if (mimeType?.startsWith("audio/")) return "fileTypeAudio";
  return "fileTypeDefault";
}

// ─── File Preview ──────────────────────────────────────

export function AssistantFilePreview({ attachment }: { attachment: AssistantAttachment }) {
  const t = useTranslations("ai");
  const href = attachment.previewUrl || attachment.url || attachment.path || "#";

  return isImageMime(attachment.mimeType) && href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-xl border border-border/70 bg-background/60"
    >
      <img src={href} alt={attachment.name} className="h-36 w-full object-cover" />
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">{attachment.name}</span>
        <span>{formatFileSize(attachment.size)}</span>
      </div>
    </a>
  ) : (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs transition-colors hover:border-primary/30 hover:bg-primary/5"
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{attachment.name}</div>
        <div className="truncate text-muted-foreground">
          {t(getFileTypeKey(attachment.mimeType, attachment.name))}
        </div>
      </div>
      <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)}</span>
    </a>
  );
}

// ─── Pipeline Thinking Indicator ───────────────────────

export function PipelineThinkingIndicator({ label, steps }: { label: string; steps: string[] }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1);
      if (steps.length > 0) {
        setStepIndex((prev) => (prev + 1) % steps.length);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [steps.length]);

  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-black/10 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <IconLoader2 className="size-3.5 animate-spin" />
        <span>{label}</span>
        <span className="text-muted-foreground/50">({elapsed}s)</span>
      </div>
      {steps.length > 0 ? (
        <div className="mt-1.5 text-xs text-muted-foreground/70 transition-opacity duration-500">
          {steps[stepIndex]}
        </div>
      ) : null}
    </div>
  );
}
