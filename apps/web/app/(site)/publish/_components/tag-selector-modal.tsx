"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { MAX_TAGS, type Tag } from "../_hooks/use-publish";

interface TagSelectorModalProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  tags: Tag[];
  selectedIds: number[];
  onConfirm: (ids: number[]) => void;
}

export function TagSelectorModal({
  open,
  onOpenChange,
  tags,
  selectedIds,
  onConfirm,
}: TagSelectorModalProps) {
  const t = useTranslations("publishVideo");
  const tc = useTranslations("common");
  const [draft, setDraft] = useState<number[]>(selectedIds);

  // Re-seed local draft each time the dialog opens so a cancel-and-reopen
  // restores the last confirmed selection rather than the previous draft.
  useEffect(() => {
    if (open) setDraft(selectedIds);
  }, [open, selectedIds]);

  const toggle = (id: number) => {
    setDraft((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_TAGS) {
        toast.warning(t("maxSelectTags", { max: MAX_TAGS }));
        return prev;
      }
      return [...prev, id];
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("selectTagTitle")}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{t("maxSelectTags", { max: MAX_TAGS })}</p>

        <div className="-mx-1 flex max-h-[50vh] flex-wrap gap-2 overflow-y-auto px-1 py-2">
          {tags.length === 0 ? (
            <p className="w-full py-6 text-center text-xs text-muted-foreground">
              {t("noTagsAvailable")}
            </p>
          ) : (
            tags.map((tag) => {
              const active = draft.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggle(tag.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                  )}
                >
                  {tag.name}
                </button>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            onClick={() => {
              onConfirm(draft);
              onOpenChange(false);
            }}
          >
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
