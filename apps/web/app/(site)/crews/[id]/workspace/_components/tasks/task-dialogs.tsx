"use client";

import { isCrewCursorError } from "@/app/(site)/crews/_hooks/api";
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

function slotKeyFor(type: string): string {
  const mapping: Record<string, string> = {
    document_or_link: "slot_document_or_link",
    image: "slot_image",
    music_asset: "slot_music_asset",
    music_final: "slot_music_final",
    video_with_subtitle: "slot_video_with_subtitle",
    video_without_subtitle: "slot_video_without_subtitle",
    audio_track: "slot_audio_track",
    raw_image_assets: "slot_raw_image_assets",
    raw_video_assets: "slot_raw_video_assets",
    final_video: "slot_final_video",
    cost_sheet: "slot_cost_sheet",
    review_sheet: "slot_review_sheet",
    client_signoff: "slot_client_signoff",
    prompt_or_script: "slot_prompt_or_script",
  };
  return mapping[type] ?? type;
}

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
  const deliveryFields = task?.deliveryFields ?? [];
  const [assetSlots, setAssetSlots] = useState<Record<string, string>>({});
  const assetQuery = useCrewAssets(
    crewId,
    { source: "recent", sort: "modified", kind: "file" },
    open
  );
  const assets = assetQuery.data?.items ?? [];
  const missingRequiredFields =
    template.data?.definition.fields.filter((field) => {
      if (!field.required) return false;
      const answer = answers[field.key];
      return field.type === "text"
        ? typeof answer !== "string" || !answer.trim()
        : !Array.isArray(answer) || !answer.some((id) => assetIds.includes(id));
    }) ?? [];

  const humanizeSlot = (type: string) => {
    const key = slotKeyFor(type);
    try {
      return t(key as any);
    } catch {
      return type;
    }
  };

  const missingRequiredSlots =
    deliveryFields.length > 0 && assetIds.length > 0
      ? deliveryFields
          .filter((f) => f.required)
          .filter((f) => !Object.values(assetSlots).includes(f.type))
      : [];

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
    setAssetSlots({});
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
      setAssetSlots({});
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
      template.isError ||
      missingRequiredFields.length > 0 ||
      missingRequiredSlots.length > 0
    )
      return;
    const requestGeneration = generation.current;
    pendingGeneration.current = requestGeneration;
    setSaving(true);
    try {
      const filteredAssetSlots = Object.fromEntries(
        Object.entries(assetSlots).filter(([id, slot]) => assetIds.includes(id) && Boolean(slot))
      );
      await submitTask.mutateAsync({
        taskId: task.id,
        note,
        assetNodeIds: assetIds,
        ...(Object.keys(filteredAssetSlots).length > 0 ? { assetSlots: filteredAssetSlots } : {}),
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
                    onClick={() =>
                      void (assetQuery.isFetchNextPageError &&
                      !isCrewCursorError(assetQuery.error, "CREW_ASSET_CURSOR_INVALID")
                        ? assetQuery.fetchNextPage({ cancelRefetch: false })
                        : assetQuery.refetch())
                    }
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
                assets.map((asset) => {
                  const isChecked = assetIds.includes(asset.id);
                  return (
                    <div
                      key={asset.id}
                      className="flex flex-col gap-1.5 rounded px-2 py-2 text-xs hover:bg-muted/50"
                    >
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          disabled={saving}
                          checked={isChecked}
                          onCheckedChange={() => {
                            setAssetIds((current) => {
                              const exists = current.includes(asset.id);
                              if (exists) {
                                setAssetSlots((prev) => {
                                  const next = { ...prev };
                                  delete next[asset.id];
                                  return next;
                                });
                                return current.filter((id) => id !== asset.id);
                              }
                              return [...current, asset.id];
                            });
                          }}
                        />
                        <IconFile className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate font-medium">{asset.name}</span>
                      </label>
                      {deliveryFields.length > 0 && isChecked ? (
                        <div className="pl-6 pt-1">
                          <NativeSelect
                            size="sm"
                            aria-label={t("slotLabel")}
                            disabled={saving}
                            value={assetSlots[asset.id] ?? ""}
                            onChange={(val) =>
                              setAssetSlots((prev) => {
                                const next = { ...prev };
                                if (val) {
                                  next[asset.id] = val;
                                } else {
                                  delete next[asset.id];
                                }
                                return next;
                              })
                            }
                          >
                            <NativeSelectOption value="">{t("slotNone")}</NativeSelectOption>
                            {deliveryFields.map((field) => (
                              <NativeSelectOption key={field.type} value={field.type}>
                                {humanizeSlot(field.type)}
                                {field.required ? " *" : ""}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          {assetQuery.hasNextPage && !assetQuery.isFetchNextPageError && (
            <Button
              variant="outline"
              color="muted"
              size="sm"
              disabled={saving || assetQuery.isFetching}
              onClick={() => void assetQuery.fetchNextPage({ cancelRefetch: false })}
            >
              {assetQuery.isFetchingNextPage ? common("loading") : common("loadMore")}
            </Button>
          )}
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
          {missingRequiredFields.length > 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {deliveryT("missingRequiredFields", {
                fields: missingRequiredFields.map((field) => field.label).join(", "),
              })}
            </p>
          ) : null}
          {missingRequiredSlots.length > 0 ? (
            <p role="status" className="text-sm text-destructive">
              {t("slotRequiredMissing", {
                slots: missingRequiredSlots.map((f) => humanizeSlot(f.type)).join(", "),
              })}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={
              saving ||
              template.isPending ||
              template.isError ||
              missingRequiredFields.length > 0 ||
              missingRequiredSlots.length > 0
            }
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
