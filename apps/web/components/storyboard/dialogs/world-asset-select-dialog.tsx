"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconHome, IconLoader2, IconMask, IconUser, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildOssImageUrl } from "@/src/lib/uploads/workspace-upload";

type AssetKind = "character" | "scene" | "prop";

export interface WorldAssetOption {
  id?: string;
  name?: string;
  roleImgPath?: string[];
  sceneImgPath?: string[];
  propImgPath?: string[];
  imagePaths?: string[];
  thumbnail?: string;
  [key: string]: unknown;
}

interface WorldAssetSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  kind: AssetKind;
  items: WorldAssetOption[];
  selectedId?: string;
  onConfirm: (item: WorldAssetOption | null) => void;
}

function getImagePath(kind: AssetKind, item: WorldAssetOption) {
  if (kind === "character") {
    return item.roleImgPath?.[0] ?? item.imagePaths?.[0] ?? item.thumbnail ?? "";
  }
  if (kind === "scene") {
    return item.sceneImgPath?.[0] ?? item.imagePaths?.[0] ?? item.thumbnail ?? "";
  }
  return item.propImgPath?.[0] ?? item.imagePaths?.[0] ?? item.thumbnail ?? "";
}

function getImageSrc(kind: AssetKind, item: WorldAssetOption) {
  const path = getImagePath(kind, item);
  if (!path) return "";
  return buildOssImageUrl(path, { width: 300, height: 300, mode: "fill" }) || "";
}

function EmptyIcon({ kind }: { kind: AssetKind }) {
  if (kind === "character") return <IconUser className="size-6" />;
  if (kind === "scene") return <IconHome className="size-6" />;
  return <IconMask className="size-6" />;
}

export function WorldAssetSelectDialog({
  open,
  onOpenChange,
  title,
  kind,
  items,
  selectedId,
  onConfirm,
}: WorldAssetSelectDialogProps) {
  const tc = useTranslations("common");
  const t = useTranslations("storyboard");
  const [selected, setSelected] = useState<WorldAssetOption | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      const prev = selectedId
        ? (items.find((item) => String(item.id) === String(selectedId)) ?? null)
        : null;
      setSelected(prev);
    }
  }

  const handleToggle = useCallback((item: WorldAssetOption) => {
    setSelected((prev) => (prev?.id === item.id ? null : item));
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(selected);
    onOpenChange(false);
  }, [selected, onConfirm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col overflow-hidden p-0"
        style={{ width: 700, maxWidth: "calc(100vw - 2rem)", height: "min(520px, 80vh)" }}
      >
        <DialogHeader className="flex flex-row items-center justify-between px-5 pt-4 pb-3">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <IconX className="size-4" />
          </button>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto px-5">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <EmptyIcon kind={kind} />
              <p className="text-sm text-muted-foreground">{t("noSelectableItems")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-3">
              {items.map((item, index) => {
                const isSelected = selected?.id === item.id;
                const src = getImageSrc(kind, item);

                return (
                  <button
                    key={String(item.id ?? item.name ?? `${kind}-${index}`)}
                    type="button"
                    onClick={() => handleToggle(item)}
                    className={cn(
                      "overflow-hidden rounded-lg border-2 bg-card transition-colors",
                      isSelected ? "border-primary" : "border-transparent hover:border-primary/30"
                    )}
                  >
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                      {src ? (
                        <img
                          src={src}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                          <EmptyIcon kind={kind} />
                        </div>
                      )}
                      {isSelected && (
                        <div className="absolute right-1 top-1 flex size-5 items-center justify-center rounded bg-primary text-white">
                          <IconCheck className="size-3" />
                        </div>
                      )}
                    </div>
                    <p className="truncate px-1.5 py-2 text-center text-xs font-medium">
                      {item.name || tc("unnamed")}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="px-5 pb-4 pt-3">
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!selected}>
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
