"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { IconLoader2 } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSelector } from "@/src/store";
import { selectCurrentInstance, type Asset } from "@/src/store/slices/projectSlice";
import { backendApi } from "@/src/lib/api";

export function PropCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (prop: Asset) => void;
}) {
  const t = useTranslations("prop");
  const tc = useTranslations("common");
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const handleCreate = async () => {
    if (!name.trim() || !worldId) return;
    setCreating(true);
    try {
      const id = await backendApi.post<string>("/api/user/world/create/worldprop", {
        data: { name: name.trim(), worldId },
      });
      onOpenChange(false);
      onCreated({ id: String(id), name: name.trim() } as Asset);
    } catch (err) {
      console.error("[CreateProp] 创建失败:", err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("addProp")}</DialogTitle>
        </DialogHeader>
        <div className="p-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            maxLength={20}
            autoFocus
            placeholder={t("propNamePlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating && <IconLoader2 className="size-3.5 animate-spin" />}
            {tc("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
