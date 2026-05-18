"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
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

export function SceneCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (scene: Asset) => void;
}) {
  const t = useTranslations("scene");
  const tc = useTranslations("common");
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    if (!worldId) {
      // Previously silent-returned with no UI feedback — surface the
      // missing-worldId case so users understand why nothing happens.
      toast.error("Missing world ID");
      return;
    }
    setCreating(true);
    try {
      // Java's /create/worldscene returns the new id as a bare string in
      // `data` (matches /create/worldprop and /create/worldrole). The
      // previous `<Asset>` cast spread a string into the created-scene
      // object, leaving `id` undefined — which made the edit sheet's
      // Generate button disabled (it gates on `sceneId`).
      const id = await backendApi.post<string>("/api/user/world/create/worldscene", {
        data: { name: name.trim(), worldId },
      });
      onOpenChange(false);
      onCreated({ id: String(id), name: name.trim() } as Asset);
    } catch (err) {
      console.error("[CreateScene] 创建失败:", err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("addScene")}</DialogTitle>
        </DialogHeader>
        <div className="p-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            maxLength={20}
            autoFocus
            placeholder={t("sceneNamePlaceholder")}
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
