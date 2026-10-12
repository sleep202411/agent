"use client";

import { TaskDeliveryUpload } from "./task-delivery-upload";
import { TaskDeliveryProgress } from "./task-delivery-progress";
import { isCrewCursorError } from "@/app/(site)/crews/_hooks/api";
import { useTaskDeliveryTemplate, TaskDeliveryFields } from "./task-delivery-template";

import { useEffect, useId, useRef, useState } from "react";
import { IconFile, IconGitBranch, IconSend } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
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
  inline = false,
  readOnly = false,
}: {
  inline?: boolean;
  readOnly?: boolean;
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
  const answerKey = `${crewId}:${template.accountId}:${task?.id}:${template.data?.categoryId}:${template.data?.version}`;
  const [answerScope, setAnswerScope] = useState(answerKey);

  const common = useTranslations("common");
  const submitTask = useSubmitCrewTask(crewId);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [deliveryLink, setDeliveryLink] = useState("");
  const deliveryErrorId = useId();
  const [slotAssets, setSlotAssets] = useState<Record<string, Array<{ id: string; name: string }>>>(
    {}
  );
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const needsDeliveryLink = !template.data && !template.isPending && !template.isError;
  const hasAlternativeDelivery = assetIds.length > 0 || Boolean(task?.canvasHref);
  const validDeliveryLink = (() => {
    try {
      const url = new URL(deliveryLink.trim());
      return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname);
    } catch {
      return false;
    }
  })();
  const deliveryLinkError =
    needsDeliveryLink &&
    !validDeliveryLink &&
    (Boolean(deliveryLink.trim()) || !hasAlternativeDelivery)
      ? t(deliveryLink.trim() ? "deliveryLinkInvalid" : "deliveryLinkRequired")
      : null;
  const noteTooLong = [deliveryLink.trim(), note].filter(Boolean).join("\n\n").length > 5000;
  const deliveryFolderId = task?.deliveryFolder?.id ?? null;
  const [uploadedAssets, setUploadedAssets] = useState<Array<{ id: string; name: string }>>([]);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const uploadingRef = useRef<Record<string, boolean>>({});
  if (answerScope !== answerKey) {
    setAnswerScope(answerKey);
    setAnswers({});
    setUploading({});
  }
  const hasUploads = Object.values(uploading).some(Boolean);
  const assetQuery = useCrewAssets(
    crewId,
    { source: "recent", sort: "modified", kind: "file" },
    open
  );
  const assets = [
    ...new Map(
      [...(assetQuery.data?.items ?? []), ...uploadedAssets].map((asset) => [asset.id, asset])
    ).values(),
  ];
  const missingRequiredFields =
    template.data?.definition.fields.filter((field) => {
      if (!field.required) return false;
      const answer = answers[field.key];
      return field.type === "text"
        ? typeof answer !== "string" || !answer.trim()
        : !Array.isArray(answer) || !answer.some((id) => assetIds.includes(id));
    }) ?? [];

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
    setDeliveryLink("");
    setAssetIds([]);
    setAnswers({});
    setUploadedAssets([]);
    setSlotAssets({});
    setUploading({});
  }
  const generation = useRef(0);
  const pendingGeneration = useRef<number | null>(null);
  useEffect(() => {
    generation.current += 1;
    uploadingRef.current = {};
    pendingGeneration.current = null;
    return () => {
      generation.current += 1;
    };
  }, [open, crewId, task?.id, template.accountId, answerKey]);

  const close = (next: boolean) => {
    if (!next) {
      generation.current += 1;
      setNote("");
      setDeliveryLink("");
      setAssetIds([]);
      setAnswers({});
      setUploadedAssets([]);
      setSlotAssets({});
      setUploading({});
      uploadingRef.current = {};
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (
      readOnly ||
      !open ||
      !task ||
      Object.values(uploadingRef.current).some(Boolean) ||
      pendingGeneration.current !== null ||
      template.isPending ||
      template.isError ||
      missingRequiredFields.length > 0 ||
      noteTooLong ||
      Boolean(deliveryLinkError)
    )
      return;
    const requestGeneration = generation.current;
    pendingGeneration.current = requestGeneration;
    setSaving(true);
    try {
      await submitTask.mutateAsync({
        taskId: task.id,
        note: [deliveryLink.trim(), note].filter(Boolean).join("\n\n"),
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

  const content = (
    <>
      {inline ? (
        <header className="shrink-0 space-y-2">
          <h2 className="text-base font-semibold">{t("submitTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("submitDescription")}</p>
        </header>
      ) : (
        <DialogHeader>
          <DialogTitle>{t("submitTitle")}</DialogTitle>
          <DialogDescription>{t("submitDescription")}</DialogDescription>
        </DialogHeader>
      )}
      {!inline && task ? <TaskDeliveryProgress status={task.status} /> : null}
      <DialogBody className={inline ? "min-w-0 space-y-4 p-0" : "space-y-4"}>
        <fieldset disabled={readOnly} className="min-w-0 space-y-4">
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
              disabled={saving || readOnly}
              assets={assets.filter((asset) => assetIds.includes(asset.id))}
              renderUpload={(field) =>
                open ? (
                  <TaskDeliveryUpload
                    key={`${answerKey}:${field.key}`}
                    crewId={crewId}
                    taskId={task?.id ?? ""}
                    parentId={deliveryFolderId || null}
                    label={field.label}
                    disabled={saving || readOnly}
                    onBusyChange={(busy) => {
                      uploadingRef.current = { ...uploadingRef.current, [field.key]: busy };
                      setUploading(uploadingRef.current);
                    }}
                    onUploaded={(asset) => {
                      setUploadedAssets((current) => [
                        ...current.filter((item) => item.id !== asset.id),
                        asset,
                      ]);
                      setAssetIds((current) => [...new Set([...current, asset.id])]);
                      setAnswers((current) => ({
                        ...current,
                        [field.key]: [
                          ...new Set([
                            ...(Array.isArray(current[field.key])
                              ? (current[field.key] as string[])
                              : []),
                            asset.id,
                          ]),
                        ],
                      }));
                    }}
                  />
                ) : null
              }
            />
          ) : null}
          {!template.data && !template.isPending && !template.isError && (
            <>
              <label className="block space-y-2 rounded-lg border border-border p-4 text-sm">
                <span>
                  {t("deliveryLink")}
                  {!hasAlternativeDelivery && (
                    <span aria-hidden="true" className="text-destructive">
                      {" "}
                      *
                    </span>
                  )}
                </span>
                <Input
                  type="url"
                  required={!hasAlternativeDelivery}
                  aria-invalid={Boolean(deliveryLink.trim() && deliveryLinkError)}
                  aria-describedby={deliveryErrorId}
                  aria-label={t("deliveryLink")}
                  placeholder="https://…"
                  value={deliveryLink}
                  disabled={saving || readOnly}
                  maxLength={1500}
                  onChange={(event) => setDeliveryLink(event.target.value)}
                />
                <p id={deliveryErrorId} className="text-xs text-muted-foreground">
                  {deliveryLinkError ?? t("deliveryLinkHint")}
                </p>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["subtitledVideo", "cleanVideo", "subtitleFile", "sourceFiles"] as const).map(
                  (slot) => (
                    <div
                      key={slot}
                      className="space-y-3 rounded-lg border border-dashed border-border bg-white/[0.025] p-4"
                    >
                      <p className="text-sm font-medium">{t(slot)}</p>
                      <TaskDeliveryUpload
                        key={`${answerKey}:${slot}`}
                        crewId={crewId}
                        taskId={task?.id ?? ""}
                        parentId={deliveryFolderId || null}
                        label={t(slot)}
                        disabled={saving || readOnly}
                        onBusyChange={(busy) => {
                          uploadingRef.current = { ...uploadingRef.current, [slot]: busy };
                          setUploading(uploadingRef.current);
                        }}
                        onUploaded={(asset) => {
                          setUploadedAssets((current) => [
                            ...current.filter((item) => item.id !== asset.id),
                            asset,
                          ]);
                          setAssetIds((current) => [...new Set([...current, asset.id])]);
                          setSlotAssets((current) => ({
                            ...current,
                            [slot]: [
                              ...(current[slot] ?? []).filter((item) => item.id !== asset.id),
                              asset,
                            ],
                          }));
                        }}
                      />
                      {(slotAssets[slot] ?? [])
                        .filter((asset) => assetIds.includes(asset.id))
                        .map((asset) => (
                          <div key={asset.id} className="flex min-w-0 items-center gap-2 text-xs">
                            <IconFile className="size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 break-all">{asset.name}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              color="muted"
                              disabled={saving || hasUploads}
                              aria-label={t("removeDeliveryFile", { name: asset.name })}
                              onClick={() => {
                                setSlotAssets((current) => ({
                                  ...current,
                                  [slot]: (current[slot] ?? []).filter(
                                    (item) => item.id !== asset.id
                                  ),
                                }));
                                setAssetIds((current) => current.filter((id) => id !== asset.id));
                              }}
                            >
                              {common("remove")}
                            </Button>
                          </div>
                        ))}
                    </div>
                  )
                )}
              </div>
            </>
          )}
          {missingRequiredFields.length > 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {deliveryT("missingRequiredFields", {
                fields: missingRequiredFields.map((field) => field.label).join(", "),
              })}
            </p>
          ) : null}
          <div className="space-y-1 text-sm">
            <p className="font-medium">{t("deliveryFolder")}</p>
            <p className="break-words text-muted-foreground">
              {task?.deliveryFolder?.name ?? t("automaticDeliveryFolder")}
            </p>
          </div>

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
            aria-label={t("submitNotePlaceholder")}
            disabled={saving || readOnly}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("submitNotePlaceholder")}
            maxLength={5000}
            className="min-h-24"
          />
          <section aria-label={t("attachAssets")}>
            <h3 className="py-2 text-sm text-muted-foreground">{t("attachAssets")}</h3>
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
                          disabled={saving || readOnly}
                          checked={isChecked}
                          onCheckedChange={() => {
                            setAssetIds((current) =>
                              current.includes(asset.id)
                                ? current.filter((id) => id !== asset.id)
                                : [...current, asset.id]
                            );
                          }}
                        />
                        <IconFile className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate font-medium">{asset.name}</span>
                      </label>
                    </div>
                  );
                })
              )}
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
          </section>
        </fieldset>
      </DialogBody>
      {hasUploads ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("deliveryUploadPending")}
        </p>
      ) : null}
      {noteTooLong ? (
        <p role="alert" className="text-xs text-destructive">
          {t("deliveryNoteTooLong")}
        </p>
      ) : null}
      <DialogFooter className="shrink-0">
        <Button variant="outline" color="muted" onClick={() => close(false)}>
          {t("cancel")}
        </Button>
        <Button
          disabled={
            readOnly ||
            saving ||
            hasUploads ||
            template.isPending ||
            template.isError ||
            missingRequiredFields.length > 0 ||
            noteTooLong ||
            Boolean(deliveryLinkError)
          }
          loading={saving}
          onClick={() => void submit()}
          icon={<IconSend />}
        >
          {t("submit")}
        </Button>
      </DialogFooter>
    </>
  );
  if (inline)
    return open ? (
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden"
        aria-label={t("submitTitle")}
      >
        {content}
      </section>
    ) : null;
  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="w-full sm:max-w-3xl">
        {content}
      </SheetContent>
    </Sheet>
  );
}
