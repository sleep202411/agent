"use client";

import { useState } from "react";
import { IconClock, IconLoader2, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useDeleteMerchandise,
  useIpMerchandise,
  useToggleMerchandiseStatus,
  type MerchandiseSku,
} from "@/app/(site)/ips/_hooks/use-merchandise";
import { SkuCard } from "./sku-card";
import { SkuDialog } from "./sku-dialog";

interface MerchandiseTabProps {
  ipId: string;
}

/**
 * Merchandise tab orchestrator. Top banner explicitly marks the
 * surface as preview-only — owner can play with the CRUD here so
 * backend / colleagues can see exactly what schema needs to land,
 * but the data is mock-only and resets on full page reload.
 */
export function MerchandiseTab({ ipId }: MerchandiseTabProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const { data: skus = [], isLoading } = useIpMerchandise(ipId);
  const deleteMutation = useDeleteMerchandise(ipId);
  const toggleStatus = useToggleMerchandiseStatus(ipId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MerchandiseSku | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MerchandiseSku | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (sku: MerchandiseSku) => {
    setEditing(sku);
    setDialogOpen(true);
  };
  const confirmDelete = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteMutation.mutate(target.id, {
      onSuccess: () => {
        toast.success(t("merchDeleteSuccess", { name: target.name }));
        setPendingDelete(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t("merchDeleteFailed")),
    });
  };

  return (
    <div className="space-y-4">
      {/* Coming-soon banner — high-visibility preview-mode notice */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
            <IconClock className="size-3.5" />
          </span>
          <div>
            <div className="text-sm font-semibold text-amber-200">{t("merchBannerTitle")}</div>
            <div className="mt-0.5 text-xs text-amber-100/80">{t("merchBannerDesc")}</div>
          </div>
        </div>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200 ring-1 ring-amber-500/30">
          {tc("comingSoon")}
        </span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground">{t("merchTabTitle")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("merchTabSubtitle", { count: skus.length })}
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
          <IconPlus className="size-3.5" />
          {t("merchAddSku")}
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <IconLoader2 className="size-5 animate-spin" />
        </div>
      ) : skus.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          {t("merchEmpty")}
        </div>
      ) : (
        <div className="space-y-3">
          {skus.map((sku) => (
            <SkuCard
              key={sku.id}
              sku={sku}
              onEdit={() => openEdit(sku)}
              onDelete={() => setPendingDelete(sku)}
              onToggleStatus={(next) =>
                toggleStatus.mutate(
                  { id: sku.id, status: next },
                  {
                    onError: (err) =>
                      toast.error(err instanceof Error ? err.message : t("merchToggleFailed")),
                  }
                )
              }
            />
          ))}
        </div>
      )}

      <SkuDialog open={dialogOpen} onOpenChange={setDialogOpen} ipId={ipId} initial={editing} />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(v) => {
          if (!v) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("merchDeleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? t("merchDeleteConfirmDesc", { name: pendingDelete.name }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {tc("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              color="destructive"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {deleteMutation.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
