"use client";

import { useCallback, useEffect, useState } from "react";
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
      const result = await backendApi.post<Asset>("/api/user/world/create/worldrole", {
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
      toast.success("角色创建成功");
      onCreated(normalizeCharacter({ ...result, name: result?.name || trimmed }));
      onOpenChange(false);
    } catch (error) {
      console.error("[QuickCreateCharacterDialog] 创建失败:", error);
      toast.error("角色创建失败");
    } finally {
      setCreating(false);
    }
  }, [creating, name, onCreated, onOpenChange, worldId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>创建角色</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel>角色名称</FieldLabel>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="请输入角色名称"
            maxLength={50}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleConfirm();
              }
            }}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={!name.trim() || creating}>
            {creating ? <IconLoader2 className="size-4 animate-spin" /> : null}
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
