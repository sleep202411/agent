"use client";

import { IconAlertTriangle, IconLoader2, IconRefresh, IconRoute } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { ExperienceRuntimePlayer } from "@/components/experience-runtime/experience-runtime-player";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StoryFrameProfile, StoryWorkingPreview } from "@/lib/story-projects-api";

export function StoryWorkingPreviewDialog({
  open,
  onOpenChange,
  preview,
  pending,
  error,
  locale,
  frameProfile,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: StoryWorkingPreview | null;
  pending: boolean;
  error: string | null;
  locale: string;
  frameProfile: StoryFrameProfile;
  onRetry: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.workingPreview");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[28px] bg-[oklch(0.205_0_0/0.94)] p-5 text-white shadow-[0_40px_120px_rgba(0,0,0,0.72)] backdrop-blur-[60px] sm:max-w-[1080px]">
        <DialogHeader className="pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-base font-semibold tracking-[-0.015em]">
              {t("title")}
            </DialogTitle>
            {preview ? (
              <span className="rounded-full bg-white/[0.07] px-2 py-1 text-[10px] font-semibold text-white/48">
                {t("draftRevision", { revision: preview.draftRevision })}
              </span>
            ) : null}
          </div>
          <DialogDescription className="max-w-3xl text-xs leading-5 text-white/46">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <StoryWorkingPreviewContent
          preview={preview}
          pending={pending}
          error={error}
          locale={locale}
          frameProfile={frameProfile}
          onRetry={onRetry}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Reusable preview surface for the canvas dialog and the standalone playtest stage. */
export function StoryWorkingPreviewContent({
  preview,
  pending,
  error,
  locale,
  frameProfile,
  onRetry,
}: {
  preview: StoryWorkingPreview | null;
  pending: boolean;
  error: string | null;
  locale: string;
  frameProfile: StoryFrameProfile;
  onRetry: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.workingPreview");
  const pathReport = preview?.pathReport ?? null;
  const errors = preview?.diagnostics.filter((item) => item.severity === "error") ?? [];
  const warnings = preview?.diagnostics.filter((item) => item.severity === "warning") ?? [];

  if (pending) {
    return (
      <div className="grid min-h-80 place-items-center rounded-[22px] bg-black/24">
        <div className="text-center">
          <IconLoader2 className="mx-auto size-6 animate-spin text-white/58" />
          <p className="mt-3 text-xs text-white/46">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="grid min-h-72 place-items-center rounded-[22px] bg-black/24 p-8">
        <div className="max-w-lg text-center">
          <IconAlertTriangle className="mx-auto size-6 text-[#ff9b9e]" />
          <h3 className="mt-4 text-sm font-semibold text-white">{t("errorTitle")}</h3>
          <p className="mt-2 text-xs leading-5 text-white/50">{error}</p>
          <Button type="button" variant="secondary" className="mt-5" onClick={onRetry}>
            <IconRefresh className="size-3.5" />
            {t("retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (preview?.runtime) {
    return (
      <div className="space-y-3">
        <ExperienceRuntimePlayer
          runtime={preview.runtime}
          locale={locale}
          frameProfile={frameProfile}
        />
        {warnings.length > 0 ? (
          <section className="rounded-[18px] bg-white/[0.045] px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold text-white/54">
              <IconAlertTriangle className="size-3.5" />
              {t("previewWarnings", { count: warnings.length })}
            </div>
            <ul className="mt-2 space-y-1 text-[10px] leading-4 text-white/38">
              {warnings.slice(0, 4).map((warning, index) => (
                <li key={`${warning.code}:${warning.entityId ?? "project"}:${index}`}>
                  {warning.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  if (!preview) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="rounded-[22px] bg-black/24 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/58">
            <IconAlertTriangle className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{t("unavailableTitle")}</h3>
            <p className="mt-1 text-xs leading-5 text-white/46">
              {t("unavailableDescription", {
                errors: errors.length,
                warnings: warnings.length,
              })}
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {preview.diagnostics.length > 0 ? (
            preview.diagnostics.map((diagnostic, index) => (
              <article
                key={`${diagnostic.code}:${diagnostic.entityId ?? "project"}:${index}`}
                className="rounded-2xl bg-white/[0.055] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      diagnostic.severity === "error"
                        ? "text-[10px] font-semibold text-[#ff9b9e]"
                        : "text-[10px] font-semibold text-white/52"
                    }
                  >
                    {t(`severity.${diagnostic.severity}`)}
                  </span>
                  <code className="text-[10px] text-white/34">{diagnostic.code}</code>
                  {diagnostic.entityId ? (
                    <code className="text-[10px] text-white/28">{diagnostic.entityId}</code>
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs leading-5 text-white/66">{diagnostic.message}</p>
              </article>
            ))
          ) : (
            <p className="rounded-2xl bg-white/[0.055] px-4 py-3 text-xs text-white/48">
              {t("noDiagnostics")}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-[22px] bg-black/24 p-5">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/72">
          <IconRoute className="size-4" />
          {t("pathReport.title")}
        </div>
        {pathReport ? (
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <PathMetric label={t("pathReport.paths")} value={pathReport.enumeratedPathCount} />
            <PathMetric
              label={t("pathReport.endings")}
              value={pathReport.reachableEndingIds.length}
            />
            <PathMetric label={t("pathReport.ambiguous")} value={pathReport.ambiguousPathCount} />
            <PathMetric
              label={t("pathReport.unreachable")}
              value={pathReport.unreachableNodeIds.length}
            />
          </dl>
        ) : (
          <p className="mt-4 text-xs leading-5 text-white/40">{t("pathReport.unavailable")}</p>
        )}
      </section>
    </div>
  );
}

function PathMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/[0.055] px-3 py-3">
      <dt className="text-[10px] text-white/38">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-white/78">{value}</dd>
    </div>
  );
}
