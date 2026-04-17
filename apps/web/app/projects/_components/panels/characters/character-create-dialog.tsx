"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { backendApi } from "@/src/lib/api";
import type { Asset } from "@/src/store/slices/projectSlice";
import { normalizeCharacter, type CharacterPanelItem } from "./character-utils";
import { Field, FieldLabel } from "@/components/ui/field";

export function QuickCreateCharacterDialog({
  open,
  onOpenChange,
  worldId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldId: string;
  onCreated: (character: CharacterPanelItem) => void;
}) {
  const t = useTranslations("character");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !worldId || creating) return;
    try {
      setCreating(true);
      const id = await backendApi.post<string>("/api/user/world/create/worldrole", {
        data: {
          name: trimmed,
          description: "",
          roleImgPath: [],
          otherImgPath: {},
          referenceImgPath: [],
          referenceImgDescription: [],
          worldId,
        },
      });
      toast.success(t("createSuccess"));
      onCreated(normalizeCharacter({ id: String(id ?? ""), name: trimmed } as Asset));
      onOpenChange(false);
    } catch (error) {
      console.error("[QuickCreateCharacterDialog] 创建失败:", error);
      toast.error(t("createFailed"));
    } finally {
      setCreating(false);
    }
  }, [creating, name, onCreated, onOpenChange, worldId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-105">
        <DialogHeader>
          <DialogTitle>{t("createCharacter")}</DialogTitle>
        </DialogHeader>
        <div className="p-4">
          <Field>
            <FieldLabel>{t("characterName")}</FieldLabel>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("characterNamePlaceholder")}
              maxLength={50}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleConfirm();
                }
              }}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={!name.trim() || creating}>
            {creating ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
