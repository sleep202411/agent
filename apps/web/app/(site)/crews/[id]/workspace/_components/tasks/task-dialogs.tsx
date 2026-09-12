"use client";

import { useEffect, useRef, useState } from "react";
import { IconFile, IconGitBranch, IconSend } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useSubmitCrewTask, type CrewTaskDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { useTranslations } from "@/src/i18n/i18n";
import { useCrewAssets } from "../../_hooks/use-crew-assets";

export function SubmitTaskDialog({
  open,
  onOpenChange,
  crewId,
  task,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  task: CrewTaskDTO | null;
  onSubmitted: (taskId: string) => void;
}) {
  const t = useTranslations("crewTasks");
  const submitTask = useSubmitCrewTask(crewId);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const assets =
    useCrewAssets(crewId, { source: "recent", sort: "modified", kind: "file" }, open).data?.items ??
    [];

  const [context, setContext] = useState({ open, crewId, taskId: task?.id });
  if (context.open !== open || context.crewId !== crewId || context.taskId !== task?.id) {
    setContext({ open, crewId, taskId: task?.id });
    setSaving(false);
    setNote("");
    setAssetIds([]);
  }
  const generation = useRef(0);
  const pendingGeneration = useRef<number | null>(null);
  useEffect(() => {
    generation.current += 1;
    pendingGeneration.current = null;
    return () => {
      generation.current += 1;
    };
  }, [open, crewId, task?.id]);

  const close = (next: boolean) => {
    if (!next) {
      generation.current += 1;
      setNote("");
      setAssetIds([]);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!open || !task || pendingGeneration.current !== null) return;
    const requestGeneration = generation.current;
    pendingGeneration.current = requestGeneration;
    setSaving(true);
    try {
      await submitTask.mutateAsync({ taskId: task.id, note, assetNodeIds: assetIds });
      if (generation.current !== requestGeneration) return;
      toast.success(t("submitted"));
      onSubmitted(task.id);
      close(false);
    } catch (error) {
      if (generation.current === requestGeneration) {
        toast.error(error instanceof Error ? error.message : t("submitFailed"));
      }
    } finally {
      if (generation.current === requestGeneration && pendingGeneration.current === requestGeneration) {
        pendingGeneration.current = null;
        setSaving(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("submitTitle")}</DialogTitle>
          <DialogDescription>{t("submitDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {task?.canvasHref ? (
            <div className="rounded-lg border border-border bg-muted/25 p-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <IconGitBranch className="size-4 text-primary" />
                {t("canvasIncluded")}
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {t("canvasIncludedHint")}
              </p>
            </div>
          ) : null}
          <Textarea
            disabled={saving}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("submitNotePlaceholder")}
            maxLength={5000}
            className="min-h-24"
          />
          <div>
            <p className="mb-2 text-[11px] text-muted-foreground">{t("attachAssets")}</p>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {assets.length === 0 ? (
                <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                  {t("noRecentAssets")}
                </p>
              ) : (
                assets.map((asset) => (
                  <label
                    key={asset.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs hover:bg-muted/50"
                  >
                    <Checkbox
                      disabled={saving}
                      checked={assetIds.includes(asset.id)}
                      onCheckedChange={() =>
                        setAssetIds((current) =>
                          current.includes(asset.id)
                            ? current.filter((id) => id !== asset.id)
                            : [...current, asset.id]
                        )
                      }
                    />
                    <IconFile className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{asset.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={saving}
            loading={saving}
            onClick={() => void submit()}
            icon={<IconSend />}
          >
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
