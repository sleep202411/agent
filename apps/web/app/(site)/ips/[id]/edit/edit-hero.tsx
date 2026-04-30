"use client";

import { useState } from "react";
import {
  IconCheck,
  IconLoader2,
  IconSparkles,
  IconWorldUp,
  IconWorldOff,
} from "@tabler/icons-react";
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
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { ipImageUrl } from "@/app/(site)/ips/_hooks/use-ip";

interface EditHeroProps {
  /** Display-only — the hero never edits these directly. */
  title: string;
  bannerLink: string;
  /** `0` = listed/Live, `8` = unlisted/Archived. Anything else falls
   *  through to "unknown" so we don't surface a wrong status. */
  projectStatus: number | undefined;
  saving: boolean;
  saved: boolean;
  publishing: boolean;
  onSave: () => void;
  onTogglePublish: () => void;
  onSpark: () => void;
}

export function EditHero({
  title,
  bannerLink,
  projectStatus,
  saving,
  saved,
  publishing,
  onSave,
  onTogglePublish,
  onSpark,
}: EditHeroProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isLive = projectStatus === 0;
  const isDraft = projectStatus === 8;
  const statusLabel = isLive
    ? t("heroStatusLive")
    : isDraft
      ? t("heroStatusDraft")
      : t("heroStatusUnknown");
  const statusTone = isLive
    ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
    : isDraft
      ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
      : "bg-muted text-muted-foreground ring-border";

  const cover = ipImageUrl(bannerLink);

  return (
    <div className="relative overflow-hidden border-b border-border bg-card">
      {/* Background art */}
      <div className="absolute inset-0">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="size-full object-cover" />
        ) : (
          <div className="size-full bg-gradient-to-br from-violet-900/30 via-indigo-900/30 to-slate-900" />
        )}
        {/* Strong scrim so action panel + title stay legible regardless
         *  of underlying art. The right side gets an extra wash so the
         *  glassy action panel reads against bright/busy backdrops. */}
        <div className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/55 to-background/85" />
        <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-background/70 to-transparent" />
      </div>

      <div className="relative flex w-full flex-col gap-6 px-6 py-8 sm:py-10 md:flex-row md:items-end md:justify-between">
        {/* Left — eyebrow + title + status */}
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/80">
            {t("heroEyebrow")}
          </p>
          <h1 className="line-clamp-2 text-2xl font-bold text-foreground sm:text-3xl">
            {title || t("heroSubtitle")}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
                statusTone
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isLive ? "bg-emerald-400" : isDraft ? "bg-amber-400" : "bg-muted-foreground"
                )}
              />
              {statusLabel}
            </span>
            <span className="text-xs text-muted-foreground">{t("heroSubtitle")}</span>
          </div>
        </div>

        {/* Right — action panel */}
        <div className="flex shrink-0 flex-col gap-2 rounded-2xl border border-border/70 bg-card/60 p-3 backdrop-blur supports-backdrop-filter:bg-card/40 sm:flex-row sm:items-center md:flex-col md:items-stretch md:p-3">
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving}
            className="min-w-[8rem] justify-center"
          >
            {saving ? (
              <>
                <IconLoader2 className="size-3.5 animate-spin" />
                {t("heroSaving")}
              </>
            ) : saved ? (
              <>
                <IconCheck className="size-3.5" />
                {t("heroSaved")}
              </>
            ) : (
              t("heroSave")
            )}
          </Button>

          <Button
            size="sm"
            variant="outline"
            color={isLive ? "muted" : "primary"}
            disabled={publishing || projectStatus === undefined}
            onClick={() => setConfirmOpen(true)}
            className="min-w-[8rem] justify-center"
          >
            {publishing ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : isLive ? (
              <IconWorldOff className="size-3.5" />
            ) : (
              <IconWorldUp className="size-3.5" />
            )}
            {isLive ? t("heroUnpublish") : t("heroPublish")}
          </Button>

          <Button
            size="sm"
            variant="outline"
            color="muted"
            onClick={onSpark}
            className="min-w-[8rem] justify-center"
          >
            <IconSparkles className="size-3.5 text-primary" />
            {t("spark")}
          </Button>
        </div>
      </div>

      {/* Publish/unpublish confirm */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isLive ? t("unpublishConfirmTitle") : t("publishConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isLive ? t("unpublishConfirmDesc") : t("publishConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              color={isLive ? "destructive" : "primary"}
              onClick={() => {
                setConfirmOpen(false);
                onTogglePublish();
              }}
            >
              {isLive ? t("unpublishConfirmAction") : t("publishConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
