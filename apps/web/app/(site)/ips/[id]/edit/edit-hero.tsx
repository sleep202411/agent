"use client";

import { useState } from "react";
import { IconCheck, IconLoader2, IconSparkles } from "@tabler/icons-react";
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
import { ProjectStatusBadge } from "@/app/(site)/ips/_components/project-status-badge";

interface EditHeroProps {
  /** Display-only — the hero never edits these directly. */
  title: string;
  /**
   * IP lifecycle status (display-only here):
   *   0 = pending review (default after any user save)
   *   3 = rejected by admin
   *   5 = approved by admin (visible in Plaza)
   *   8 = taken down by admin (admin-only — users can't trigger this)
   * Anything else falls through to the "unknown" badge.
   */
  projectStatus: number | undefined;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onSpark: () => void;
}

/**
 * Hero strip on the IP edit page. Shows the lifecycle badge + the
 * Spark / Save actions. Save always goes through a confirm dialog
 * because any user-side save resets `projectStatus` back to 0
 * (pending review) on the backend — the user needs to know their
 * IP will temporarily disappear from the Plaza until admin re-approves.
 *
 * Users have no publish / unpublish surface here on purpose: lifecycle
 * transitions out of "pending review" (5 = approve, 3 = reject, 8 =
 * takedown) are all admin-only. The user's only knob is "save edits".
 */
export function EditHero({ title, projectStatus, saving, saved, onSave, onSpark }: EditHeroProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="relative overflow-hidden border-b border-border bg-card">
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
            <ProjectStatusBadge status={projectStatus} />
            <span className="text-xs text-muted-foreground">{t("heroSubtitle")}</span>
          </div>
        </div>

        {/* Right — action panel */}
        <div className="flex shrink-0 flex-row flex-wrap items-center gap-2">
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

          <Button
            size="sm"
            onClick={() => setConfirmOpen(true)}
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
        </div>
      </div>

      {/* Save-confirm — fires for every save attempt so the user can't
          miss the lifecycle effect (status resets to 0 / pending review,
          IP temporarily off the plaza). */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("saveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("saveConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              color="primary"
              onClick={() => {
                setConfirmOpen(false);
                onSave();
              }}
            >
              {t("saveConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
