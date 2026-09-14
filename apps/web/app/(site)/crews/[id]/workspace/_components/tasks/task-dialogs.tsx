"use client";
import { useTaskDeliveryTemplate, TaskDeliveryFields } from "./task-delivery-template";

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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useCrewAssetFolders, useCrewAssets } from "../../_hooks/use-crew-assets";

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
  const deliveryT = useTranslations("crewDeliveryTemplate");
  const template = useTaskDeliveryTemplate(task?.id, open);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const answerKey = `${template.accountId}:${task?.id}:${template.data?.categoryId}:${template.data?.version}`;
  const [answerScope, setAnswerScope] = useState(answerKey);
  if (answerScope !== answerKey) {
    setAnswerScope(answerKey);
    setAnswers({});
  }
  const common = useTranslations("common");
  const submitTask = useSubmitCrewTask(crewId);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [deliveryFolderId, setDeliveryFolderId] = useState("");
  const folders = useCrewAssetFolders(crewId, open);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const assetQuery = useCrewAssets(
    crewId,
    { source: "recent", sort: "modified", kind: "file" },
    open
  );
  const assets = assetQuery.data?.items ?? [];

  const [context, setContext] = useState({
    open,
    crewId,
    taskId: task?.id,
    accountId: template.accountId,
  });
  if (
    context.open !== open ||
    context.crewId !== crewId ||
    context.taskId !== task?.id ||
    context.accountId !== template.accountId
  ) {
    setContext({ open, crewId, taskId: task?.id, accountId: template.accountId });
    setSaving(false);
    setNote("");
    setAssetIds([]);
    setAnswers({});
    setDeliveryFolderId("");
  }
  const generation = useRef(0);
  const pendingGeneration = useRef<number | null>(null);
  useEffect(() => {
    generation.current += 1;
    pendingGeneration.current = null;
    return () => {
      generation.current += 1;
    };
  }, [open, crewId, task?.id, template.accountId]);

  const close = (next: boolean) => {
    if (!next) {
      generation.current += 1;
      setNote("");
      setAssetIds([]);
      setAnswers({});
      setDeliveryFolderId("");
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (
      !open ||
      !task ||
      pendingGeneration.current !== null ||
      template.isPending ||
      template.isError
    )
      return;
    const requestGeneration = generation.current;
    pendingGeneration.current = requestGeneration;
    setSaving(true);
    try {
      await submitTask.mutateAsync({
        taskId: task.id,
        note,
        assetNodeIds: assetIds,
        ...(template.data
          ? {
              professionalDelivery: {
                categoryId: template.data.categoryId,
                version: template.data.version,
                answers: Object.fromEntries(
                  Object.entries(answers).map(([key, value]) => [
                    key,
                    Array.isArray(value) ? value.filter((id) => assetIds.includes(id)) : value,
                  ])
                ),
              },
            }
          : {}),
        ...(deliveryFolderId ? { deliveryFolderId } : {}),
      });
      if (generation.current !== requestGeneration) return;
      toast.success(t("submitted"));
      onSubmitted(task.id);
      close(false);
    } catch (error) {
      if (generation.current === requestGeneration) {
        toast.error(error instanceof Error ? error.message : t("submitFailed"));
      }
    } finally {
      if (
        generation.current === requestGeneration &&
        pendingGeneration.current === requestGeneration
      ) {
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
          <label className="block space-y-2 text-sm">
            {t("deliveryFolder")}
            <NativeSelect
              aria-label={t("deliveryFolder")}
              disabled={saving || folders.isLoading}
              value={deliveryFolderId}
              onChange={setDeliveryFolderId}
            >
              <NativeSelectOption value="">{t("automaticDeliveryFolder")}</NativeSelectOption>
              {(folders.data ?? [])
                .filter((folder) =>
                  ["upload", "edit", "manage"].includes(folder.effectivePermission ?? "")
                )
                .map((folder) => (
                  <NativeSelectOption key={folder.id} value={folder.id}>
                    {folder.name}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </label>
          {folders.error ? (
            <div role="alert" className="text-xs">
              <p>{folders.error instanceof Error ? folders.error.message : common("loadFailed")}</p>
              <Button
                variant="outline"
                disabled={saving || folders.isFetching}
                onClick={() => void folders.refetch()}
              >
                {common("retry")}
              </Button>
            </div>
          ) : null}

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
              {assetQuery.isLoading ? (
                <p
                  role="status"
                  className="px-2 py-4 text-center text-[11px] text-muted-foreground"
                >
                  {common("loading")}
                </p>
              ) : null}
              {assetQuery.error ? (
                <div role="alert" className="space-y-2 px-2 py-3 text-xs">
                  <p>
                    {assetQuery.error instanceof Error
                      ? assetQuery.error.message
                      : common("loadFailed")}
                  </p>
                  <Button
                    variant="outline"
                    color="muted"
                    size="sm"
                    disabled={saving || assetQuery.isFetching}
                    onClick={() => void assetQuery.refetch()}
                  >
                    {common("retry")}
                  </Button>
                </div>
              ) : null}
              {assets.length === 0 && !assetQuery.isLoading && !assetQuery.error ? (
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
          {template.isPending ? <p role="status">{deliveryT("loading")}</p> : null}
          {template.error ? (
            <div role="alert">
              {template.error.message}
              <Button
                disabled={saving || template.isFetching}
                onClick={() => void template.refetch()}
              >
                {deliveryT("retry")}
              </Button>
            </div>
          ) : null}
          {template.data ? (
            <TaskDeliveryFields
              template={template.data}
              answers={answers}
              onChange={setAnswers}
              disabled={saving}
              assets={assets.filter((asset) => assetIds.includes(asset.id))}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={saving || template.isPending || template.isError}
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
