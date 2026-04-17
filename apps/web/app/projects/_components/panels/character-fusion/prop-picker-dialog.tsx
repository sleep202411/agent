"use client";

import { useMemo, useState } from "react";
import { IconCheck, IconPhoto } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";

export type PropOption = {
  id: string;
  name: string;
  image: string;
};

interface PropPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PropOption[];
  value: PropOption[];
  onConfirm: (items: PropOption[]) => void;
}

export function PropPickerDialog({
  open,
  onOpenChange,
  items,
  value,
  onConfirm,
}: PropPickerDialogProps) {
  const t = useTranslations("character");
  const tc = useTranslations("common");
  const tp = useTranslations("prop");
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const visibleItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return items;
    return items.filter((item) => item.name.toLowerCase().includes(normalizedKeyword));
  }, [items, keyword]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-full sm:max-w-2xl"
        onOpenAutoFocus={() => {
          setKeyword("");
          setSelectedIds(value.map((item) => item.id));
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("selectPropTitle")}</DialogTitle>
          <DialogDescription>{t("selectPropDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4">
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t("searchPropName")}
          />

          <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
            {visibleItems.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 lg:grid-cols-4">
                {visibleItems.map((item) => {
                  const active = selectedIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setSelectedIds((current) =>
                          current.includes(item.id)
                            ? current.filter((value) => value !== item.id)
                            : [...current, item.id]
                        )
                      }
                      className={`overflow-hidden rounded-xl border-2 bg-muted/20 text-left transition-colors ${
                        active ? "border-primary" : "border-transparent hover:border-primary/30"
                      }`}
                    >
                      <div className="relative aspect-square overflow-hidden bg-muted">
                        {item.image ? (
                          <img
                            src={buildOssUrl(item.image)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground/40">
                            <IconPhoto className="size-6" />
                          </div>
                        )}
                        {active ? (
                          <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-white">
                            <IconCheck className="size-3.5" />
                          </div>
                        ) : null}
                      </div>
                      <div className="truncate px-2 py-2 text-center text-sm">
                        {item.name || tp("unnamedProp")}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                {t("noProps")}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={() => {
                onConfirm(items.filter((item) => selectedIds.includes(item.id)));
                onOpenChange(false);
              }}
            >
              {tc("confirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
