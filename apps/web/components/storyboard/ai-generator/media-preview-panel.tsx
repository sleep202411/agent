import { useTranslations } from "@/src/i18n/i18n";
import { IconPhoto, IconVideo } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { FloatingToolbar, type ToolbarAction } from "@/components/ui/floating-toolbar";

interface MediaPreviewPanelProps {
  type: "image" | "video";
  previewUrl: string;
  badge?: string;
  emptyText?: string;
  emptyIcon?: React.ReactNode;
  /** Top-right toolbar actions (collect, prefer, download, delete, fullscreen, meta etc.) */
  toolbarActions?: ToolbarAction[];
  /** Bottom action bar (edit, repaint, erase, enhance etc.) */
  bottomActions?: ToolbarAction[];
  className?: string;
}

export function MediaPreviewPanel({
  type,
  previewUrl,
  badge,
  emptyText,
  emptyIcon,
  toolbarActions,
  bottomActions,
  className,
}: MediaPreviewPanelProps) {
  const t = useTranslations("storyboard");

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border border-dashed border-border/60 bg-white/[0.02]",
        className
      )}
    >
      {/* Media preview area */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {previewUrl ? (
          <>
            {badge ? (
              <div className="absolute left-3 top-3 z-10 rounded bg-primary/90 px-2 py-1 text-[11px] font-medium text-white">
                {badge}
              </div>
            ) : null}

            {type === "video" ? (
              <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2">
                <video
                  key={previewUrl}
                  src={previewUrl}
                  controls
                  playsInline
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <img
                src={previewUrl}
                alt=""
                className="max-h-full max-w-full rounded-lg object-contain p-2"
              />
            )}

            {toolbarActions && toolbarActions.length > 0 ? (
              <FloatingToolbar position="top-right" actions={toolbarActions} />
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
            {emptyIcon ??
              (type === "video" ? (
                <IconVideo className="size-10" />
              ) : (
                <IconPhoto className="size-10" />
              ))}
            <p className="text-sm">{emptyText ?? t("clickLeftPreview")}</p>
          </div>
        )}
      </div>

      {/* Bottom actions */}
      {previewUrl && bottomActions && bottomActions.length > 0 ? (
        <div className="flex justify-center p-2">
          <FloatingToolbar actions={bottomActions} className="flex-wrap gap-2" />
        </div>
      ) : null}
    </div>
  );
}
