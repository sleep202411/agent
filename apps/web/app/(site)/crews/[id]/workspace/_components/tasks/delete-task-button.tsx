"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useDeleteCrewTask } from "@/app/(site)/crews/_hooks/use-tasks";

export function DeleteTaskButton({
  task,
  onDeleted,
}: {
  task: { id: string; crewId: string; version: number };
  onDeleted?: () => void;
}) {
  const t = useTranslations("crewTasks.deletion");
  const [open, setOpen] = useState(false);
  const deletion = useDeleteCrewTask(task.crewId);
  const submit = async () => {
    try {
      await deletion.mutateAsync({ taskId: task.id, expectedVersion: task.version });
      setOpen(false);
      toast.success(t("success"));
      onDeleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {t("label")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!deletion.isPending) setOpen(next);
        }}
      >
        <DialogContent showCloseButton={false}>
          <div className="space-y-3 p-4">
            <DialogTitle>{t("label")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={deletion.isPending} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={deletion.isPending} onClick={() => void submit()}>
              {t("label")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
