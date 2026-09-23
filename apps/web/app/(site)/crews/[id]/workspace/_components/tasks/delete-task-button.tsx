"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
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

interface DeleteTaskButtonProps {
  task: { id: string; crewId: string; version: number };
  onDeleted?: () => void;
}

export function DeleteTaskButton(props: DeleteTaskButtonProps) {
  const { user } = useCurrentUser();
  return (
    <DeleteTaskSession
      key={JSON.stringify([user?.id, props.task.crewId, props.task.id])}
      {...props}
    />
  );
}

function DeleteTaskSession({ task, onDeleted }: DeleteTaskButtonProps) {
  const t = useTranslations("crewTasks.deletion");
  const [confirmedVersion, setConfirmedVersion] = useState<number | null>(null);
  const open = confirmedVersion !== null;
  const deletion = useDeleteCrewTask(task.crewId);
  const alive = useRef(true);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const submit = async () => {
    if (!alive.current || confirmedVersion === null || pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await deletion.mutateAsync({ taskId: task.id, expectedVersion: confirmedVersion });
      if (!alive.current) return;
      setConfirmedVersion(null);
      toast.success(t("success"));
      onDeleted?.();
    } catch (error) {
      if (alive.current) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return (
    <>
      <Button variant="ghost" onClick={() => setConfirmedVersion(task.version)}>
        {t("label")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending.current) setConfirmedVersion(next ? task.version : null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <div className="space-y-3 p-4">
            <DialogTitle>{t("label")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setConfirmedVersion(null)}>
              {t("cancel")}
            </Button>
            <Button disabled={saving} onClick={() => void submit()}>
              {t("label")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
