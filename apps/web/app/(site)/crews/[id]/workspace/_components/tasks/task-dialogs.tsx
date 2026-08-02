"use client";

import { useState } from "react";
import {
  IconCircleCheck,
  IconFile,
  IconGitBranch,
  IconLoader2,
  IconSend,
} from "@tabler/icons-react";
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
import {
  useCrewSettlements,
  useSettleCrewItem,
  useSubmitCrewTask,
  type CrewTaskDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
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
  const [note, setNote] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const assets =
    useCrewAssets(crewId, { source: "recent", sort: "modified", kind: "file" }, open).data?.items ??
    [];

  const close = (next: boolean) => {
    if (!next) {
      setNote("");
      setAssetIds([]);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!task) return;
    try {
      await submitTask.mutateAsync({ taskId: task.id, note, assetNodeIds: assetIds });
      toast.success(t("submitted"));
      onSubmitted(task.id);
      close(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("submitFailed"));
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
            disabled={submitTask.isPending}
            loading={submitTask.isPending}
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

export function SettlementsDialog({
  open,
  onOpenChange,
  crewId,
  enabled,
  displays,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  enabled: boolean;
  displays: ReturnType<typeof useUserDisplays>;
}) {
  const t = useTranslations("crewTasks");
  const tc = useTranslations("common");
  const [filter, setFilter] = useState<"all" | "pending" | "settled">("all");
  const query = useCrewSettlements(crewId, enabled && open, filter === "all" ? undefined : filter);
  const settle = useSettleCrewItem(crewId);

  const markSettled = async (itemId: string) => {
    try {
      await settle.mutateAsync({ itemId });
      toast.success(t("settled"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("settlements")}</DialogTitle>
          <DialogDescription>{t("settlementsDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="mb-3 flex items-center gap-1 rounded-lg bg-secondary/40 p-1">
            {(["all", "pending", "settled"] as const).map((value) => {
              const count =
                value === "all" ? (query.summary?.total ?? 0) : (query.summary?.[value] ?? 0);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={
                    filter === value
                      ? "flex-1 rounded-md bg-background px-2 py-1.5 text-[11px] font-semibold text-foreground shadow-sm"
                      : "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {t(
                    value === "all"
                      ? "settlementFilterAll"
                      : value === "pending"
                        ? "settlementFilterPending"
                        : "settlementFilterSettled"
                  )}{" "}
                  <span className="font-mono text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="max-h-[55vh] divide-y divide-border overflow-y-auto">
            {query.data.map((item) => (
              <div key={item.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{item.taskTitle}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {displayNameOf(item.userId, displays)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs">
                    {formatPoints(item.pointsAmount)} {t("pointsUnit")}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {item.status === "settled" &&
                    item.payoutAmountMinor != null &&
                    item.payoutCurrency
                      ? formatMoney(item.payoutAmountMinor, item.payoutCurrency)
                      : t("usdCashOutEstimate", {
                          amount: formatMoney(item.pointsAmount, "USD"),
                        })}
                  </p>
                </div>
                {item.status === "settled" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                    <IconCircleCheck className="size-4" />
                    {t("settled")}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    color="muted"
                    disabled={settle.isPending}
                    onClick={() => void markSettled(item.id)}
                  >
                    {t("markSettled")}
                  </Button>
                )}
              </div>
            ))}
            {query.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" />
                {tc("loading")}
              </div>
            ) : query.isError ? (
              <p className="py-10 text-center text-xs text-destructive">
                {query.error instanceof Error ? query.error.message : t("actionFailed")}
              </p>
            ) : query.data.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">
                {t("noSettlements")}
              </p>
            ) : null}
            {query.hasNextPage ? (
              <div className="flex justify-center py-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  color="muted"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : null}
                  {tc("loadMore")}
                </Button>
              </div>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

function formatPoints(points: number) {
  return new Intl.NumberFormat().format(points);
}
