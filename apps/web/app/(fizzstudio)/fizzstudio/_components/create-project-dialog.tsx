"use client";

import { useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateProject } from "../../_hooks/use-project";

interface CreateProjectDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (projectId: string) => void;
}

export function CreateProjectDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: CreateProjectDialogProps) {
  const t = useTranslations("fizzStudio");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useCreateProject(workspaceId);

  const canSubmit = name.trim().length > 0 && !create.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const project = await create.mutateAsync({
      name: name.trim(),
      initialSectionTitle: t("defaultSectionTitle"),
      description: description.trim() || undefined,
    });
    onOpenChange(false);
    setName("");
    setDescription("");
    onCreated?.(project.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("createProjectTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t("createProjectNameLabel")}
                <span className="ml-1 text-destructive">*</span>
              </label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("createProjectNamePlaceholder")}
                maxLength={160}
                size="lg"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t("createProjectDescLabel")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("createProjectDescPlaceholder")}
                maxLength={500}
                rows={3}
                className="w-full resize-none rounded-lg border border-input bg-input/20 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              color="muted"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit} loading={create.isPending}>
              {t("createProjectSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
