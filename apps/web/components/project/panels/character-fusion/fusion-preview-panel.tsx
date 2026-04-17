"use client";

import {
  IconArrowsMaximize,
  IconDownload,
  IconLoader2,
  IconPhoto,
  IconReplace,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import type { FusionQueueItem } from "./use-fusion-queue";

interface FusionPreviewPanelProps {
  previewItem: FusionQueueItem | null;
  roleName: string;
  onRoleNameChange: (name: string) => void;
  onSetReference: (item: FusionQueueItem) => void;
  onDelete: (item: FusionQueueItem) => void;
  onSave: () => void;
  onFullPreview: (url: string) => void;
  saving: boolean;
  otherImgList: Array<{ name: string; path: string }>;
  onPreviewVariant: (name: string, path: string) => void;
  onSetVariantAsBase: (url: string) => void;
}

function downloadUrl(url: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
}

function IconButton({
  onClick,
  icon,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded text-white transition-colors hover:bg-white/10"
      title={title}
    >
      {icon}
    </button>
  );
}

export function FusionPreviewPanel({
  previewItem,
  roleName,
  onRoleNameChange,
  onSetReference,
  onDelete,
  onSave,
  onFullPreview,
  saving,
  otherImgList,
  onPreviewVariant,
  onSetVariantAsBase,
}: FusionPreviewPanelProps) {
  const t = useTranslations("character");
  const tc = useTranslations("common");

  return (
    <div className="flex flex-[6] overflow-hidden rounded-lg border border-dashed border-border/60">
      <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-black">
        {previewItem?.url ? (
          <>
            <img
              src={previewItem.url}
              alt=""
              className="max-h-full max-w-full rounded-lg object-contain p-3"
            />
            <div className="absolute right-3 top-3 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2 backdrop-blur-sm">
              <IconButton
                onClick={() => onSetReference(previewItem)}
                title={t("setAsBaseImageTitle")}
                icon={<IconReplace className="size-4" />}
              />
              <IconButton
                onClick={() =>
                  previewItem.url && downloadUrl(previewItem.url, "character-fusion.png")
                }
                title={tc("download")}
                icon={<IconDownload className="size-4" />}
              />
              {previewItem.fromHistory || previewItem.fromQueue ? (
                <IconButton
                  onClick={() => void onDelete(previewItem)}
                  title={tc("delete")}
                  icon={<IconTrash className="size-4" />}
                />
              ) : null}
              <IconButton
                onClick={() => onFullPreview(previewItem.url || "")}
                title={tc("viewFullImage")}
                icon={<IconArrowsMaximize className="size-4" />}
              />
            </div>

            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/70 px-4 py-3 backdrop-blur-sm">
              <Input
                value={roleName}
                onChange={(event) => onRoleNameChange(event.target.value)}
                placeholder={t("imageNamePlaceholder")}
                className="h-9 border-white/10 bg-white/5"
              />
              <Button onClick={onSave} disabled={!previewItem || saving}>
                {saving ? <IconLoader2 className="size-4 animate-spin" /> : null}
                {t("saveImage")}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/60">
            <IconPhoto className="size-8" />
            <div className="text-sm">{t("clickToPreview")}</div>
          </div>
        )}
      </div>

      {otherImgList.length > 0 ? (
        <div className="flex w-[128px] shrink-0 flex-col border-l border-border/60">
          <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
            {t("otherVariants")}
          </div>
          <div className="flex-1 overflow-auto p-2">
            <div className="space-y-2">
              {otherImgList.map((item) => (
                <div
                  key={item.name}
                  className="group overflow-hidden rounded-lg border border-border/70 bg-muted/20"
                >
                  <button
                    type="button"
                    onClick={() => onPreviewVariant(item.name, item.path)}
                    className="block w-full"
                  >
                    <div className="relative aspect-square overflow-hidden">
                      <img
                        src={buildOssUrl(item.path)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          const nextUrl = buildOssUrl(item.path);
                          if (!nextUrl) return;
                          onSetVariantAsBase(nextUrl);
                          toast.success(t("setAsBaseImage"));
                        }}
                        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-primary group-hover:opacity-100"
                        title={t("setAsBaseImageTitle")}
                      >
                        <IconReplace className="size-3.5" />
                      </button>
                    </div>
                    <div className="truncate px-2 py-1.5 text-center text-[11px] text-muted-foreground">
                      {item.name}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
